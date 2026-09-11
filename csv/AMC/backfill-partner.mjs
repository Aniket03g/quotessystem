/**
 * Fill the "Partner" column on Warranty Reminders rows that were imported before
 * that column existed.
 *
 * The partner sits in column B of the source sheet and was simply not carried
 * across by the original import. It is a per-invoice value, so this matches on
 * "Invoice No" and PATCHes in place — re-running the importer instead would
 * create a second copy of every row, because its dedup key is
 * Invoice No + Expiry Date and neither changes here.
 *
 * Only rows whose Partner is currently empty are touched, so the script is
 * idempotent and cannot overwrite a value someone edited by hand.
 *
 * Usage:
 *   node backfill-partner.mjs --audit  --host=http://host:8090 --table-id=xxx --token-file=path
 *   node backfill-partner.mjs --apply  --host=http://host:8090 --table-id=xxx --token-file=path
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const XLSX = createRequire(import.meta.url)('xlsx');

const args = process.argv.slice(2);
const MODE_AUDIT = args.includes('--audit');
const MODE_APPLY = args.includes('--apply');
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=').replace(/^"|"$/g, '') : fallback;
};

const FILE = arg('file', 'AMC data KDDI (2).xlsx');
const SHEET = arg('sheet', 'KDDI YEALINK AMC');
const HOST = arg('host', process.env.NOCODB_HOST || '');
const TABLE_ID = arg('table-id', process.env.NOCODB_TABLE_ID || '');
const TOKEN_FILE = arg('token-file', process.env.NOCODB_TOKEN_FILE || '');

if (!MODE_AUDIT && !MODE_APPLY) {
  console.log('Usage: node backfill-partner.mjs --audit | --apply --host=... --table-id=... --token-file=...');
  process.exit(1);
}
if (!(HOST && TABLE_ID && TOKEN_FILE)) {
  console.error('--host, --table-id and --token-file are all required.');
  process.exit(1);
}

const token = readFileSync(TOKEN_FILE, 'utf8').trim();
const headers = { 'xc-token': token, 'Content-Type': 'application/json' };

// Same positional indexing as the importer: the workbook's header text is
// inconsistent between sheets, so columns are read by position.
const C = { SR: 0, PARTNER: 1, INVOICE: 4 };

const filePath = new URL(`./${FILE}`, import.meta.url).pathname
  .replace(/^\/([A-Z]:)/, '$1')
  .replace(/%20/g, ' ');

const wb = XLSX.readFile(filePath);
if (!wb.Sheets[SHEET]) {
  console.error(`Sheet "${SHEET}" not found. Available: ${wb.SheetNames.join(', ')}`);
  process.exit(1);
}
const grid = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], {
  header: 1, defval: '', blankrows: false, raw: true,
});
const cell = (row, i) => String(row?.[i] ?? '').trim();

// Only parent rows carry an Sr no, and only they carry invoice and partner.
const partnerByInvoice = new Map();
for (const row of grid.slice(1)) {
  if (cell(row, C.SR) === '') continue;
  const invoice = cell(row, C.INVOICE).replace(/\.0$/, '');
  const partner = cell(row, C.PARTNER);
  if (invoice && partner) partnerByInvoice.set(invoice, partner);
}
console.log(`Sheet: ${partnerByInvoice.size} invoice(s) with a partner name.`);

const res = await fetch(
  `${HOST}/api/v2/tables/${TABLE_ID}/records?limit=1000&fields=Id,Invoice No,Customer Name,Partner`,
  { headers },
);
if (!res.ok) {
  console.error(`Failed to read rows: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = (await res.json()).list || [];
console.log(`Table: ${rows.length} row(s).`);

const updates = [];
const skipped = [];
for (const row of rows) {
  const invoice = String(row['Invoice No'] ?? '').trim();
  const partner = partnerByInvoice.get(invoice);
  if (String(row['Partner'] ?? '').trim()) { skipped.push(`${invoice} already set`); continue; }
  if (!partner) { skipped.push(`${invoice} no partner in sheet`); continue; }
  updates.push({ Id: row.Id, Partner: partner });
  console.log(`  ${invoice}  ${row['Customer Name']}  ->  ${partner}`);
}

if (skipped.length) console.log(`Skipping ${skipped.length}: ${skipped.join(', ')}`);

if (!updates.length) {
  console.log('Nothing to do.');
  process.exit(0);
}
if (MODE_AUDIT) {
  console.log(`\nAudit only. ${updates.length} row(s) would be updated. Re-run with --apply.`);
  process.exit(0);
}

const patch = await fetch(`${HOST}/api/v2/tables/${TABLE_ID}/records`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify(updates),
});
if (!patch.ok) {
  console.error(`PATCH failed: HTTP ${patch.status} ${await patch.text()}`);
  process.exit(1);
}
console.log(`Updated ${updates.length} row(s).`);
