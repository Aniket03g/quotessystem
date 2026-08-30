/**
 * Build warranty-expiry reminder rows from "AMC data KDDI (2).xlsx", sheet
 * "KDDI YEALINK AMC" (sheet 2). Everything on that sheet is a Yealink warranty;
 * the other three sheets are deliberately out of scope.
 *
 * Sheet shape: a parent row carries the invoice (Sr no, Customer, Invoice no,
 * Invoice Date, Basic Value) and is itself the first asset line; the rows below
 * it, with no Sr no, are the remaining asset lines — one serial number each.
 *
 * Two non-obvious rules, both established by checking the data:
 *
 * 1. The sheet's "Warranty Expires" column is NEVER read. It is a hand-typed
 *    invoice + 2 years, and 3 of its 15 values are typing errors (two day/month
 *    flips and a month typo). We recompute it instead, which fixes those three
 *    and fills the two invoices that have no expiry at all. Every disagreement
 *    between the sheet and the computed value is written to the review CSV.
 *
 * 2. "warranty a/c yealink ams" wins when present. Yealink cover starts at AMS
 *    registration, not at invoice, so it legitimately runs 88-194 days later
 *    than the computed date. It is filled on only 5 of 17 invoices; the rest
 *    fall back to the computed date and are marked as such, because the gap
 *    varies too much to estimate.
 *
 * An AMS date may sit on a *child* row rather than the parent — one invoice can
 * hold assets that expire on different days. Such a block is split into more
 * than one reminder row.
 *
 * Usage:
 *   node import-warranty-reminders.mjs --audit    # no writes; print the plan
 *   node import-warranty-reminders.mjs --import   # create the reminder rows
 *
 * Env: PROXY_URL (default http://localhost:8082), JWT_TOKEN (required for --import)
 */
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const XLSX = createRequire(import.meta.url)('xlsx');

const PROXY_URL = process.env.PROXY_URL || 'http://localhost:8082';
const JWT_TOKEN = process.env.JWT_TOKEN || '';

const args = process.argv.slice(2);
const MODE_AUDIT = args.includes('--audit');
const MODE_IMPORT = args.includes('--import');
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=').replace(/^"|"$/g, '') : fallback;
};

const FILE = arg('file', 'AMC data KDDI (2).xlsx');
const SHEET = arg('sheet', 'KDDI YEALINK AMC');
const TABLE = arg('table', 'warranty_reminders');
const WARRANTY_YEARS = Number(arg('years', 2));
const TODAY = arg('today', null) ? new Date(arg('today')) : new Date();

// --direct writes to NocoDB's own data API with an xc-token instead of going
// through the proxy. Useful for the one-off backfill, which would otherwise be
// blocked on restarting the proxy with the new table registered in proxy.yaml.
const MODE_DIRECT = args.includes('--direct');
const NOCODB_HOST = arg('host', process.env.NOCODB_HOST || '');
const NOCODB_TABLE_ID = arg('table-id', process.env.NOCODB_TABLE_ID || '');
const TOKEN_FILE = arg('token-file', process.env.NOCODB_TOKEN_FILE || '');

if (!MODE_AUDIT && !MODE_IMPORT) {
  console.log('Usage: node import-warranty-reminders.mjs --audit | --import [--file=x.xlsx] [--years=2]');
  console.log('       --import --direct --host=http://host:8090 --table-id=xxx --token-file=path');
  process.exit(1);
}
if (MODE_IMPORT && MODE_DIRECT && !(NOCODB_HOST && NOCODB_TABLE_ID && TOKEN_FILE)) {
  console.error('--direct needs --host, --table-id and --token-file.');
  process.exit(1);
}
if (MODE_IMPORT && !MODE_DIRECT && !JWT_TOKEN) {
  console.error('JWT_TOKEN env var required for --import (or use --direct).');
  process.exit(1);
}

const filePath = new URL(`./${FILE}`, import.meta.url).pathname
  .replace(/^\/([A-Z]:)/, '$1')
  .replace(/%20/g, ' ');

// Column positions on sheet 2. Header text is inconsistent across the workbook's
// sheets, so index by position rather than by header name.
const C = {
  SR: 0, PARTNER: 1, CUSTOMER: 2, LOCATION: 3, INVOICE: 4, INVOICE_DATE: 5,
  VALUE: 6, MODEL: 7, SERIAL: 8, QTY: 9, PRICE: 10, SHEET_EXPIRY: 11, AMS: 12,
};

// --- dates -----------------------------------------------------------------

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const fromSerial = (n) => new Date(EXCEL_EPOCH + Math.round(n) * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
const addYears = (d, y) =>
  new Date(Date.UTC(d.getUTCFullYear() + y, d.getUTCMonth(), d.getUTCDate()));
const daysFrom = (d, from) => Math.round((d - from) / 86400000);

/**
 * Parse a cell that is meant to hold a date. Excel stores real dates as numbers,
 * so `native` records which form it arrived in — a native date cannot be checked
 * for day/month transposition, because the text the user typed is already gone.
 */
function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return { date: new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())), native: true };
  const s = String(v).trim();
  if (/^[\d.]+(e[-+]?\d+)?$/i.test(s)) {
    const n = parseFloat(s);
    return n > 40000 && n < 60000 ? { date: fromSerial(n), native: true } : null;
  }
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(date.getTime()) ? null : { date, native: false };
}

/** Day and month swapped, or null when the swap is not a real date. */
function transpose(d) {
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  if (day > 12) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), day - 1, month));
}

// --- read ------------------------------------------------------------------

const wb = XLSX.readFile(filePath);
if (!wb.Sheets[SHEET]) {
  console.error(`Sheet "${SHEET}" not found. Available: ${wb.SheetNames.join(', ')}`);
  process.exit(1);
}
const grid = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], {
  header: 1, defval: '', blankrows: false, raw: true,
});

const cell = (row, i) => String(row?.[i] ?? '').trim();
const isAssetLine = (row) => cell(row, C.MODEL) !== '' || cell(row, C.SERIAL) !== '';

// Group into invoice blocks: a row with a Sr no starts a new one.
const blocks = [];
for (const row of grid.slice(1)) {
  if (cell(row, C.SR) !== '') blocks.push({ parent: row, children: [], excelRow: blocks.length });
  else if (blocks.length) blocks[blocks.length - 1].children.push(row);
}

// --- plan ------------------------------------------------------------------

const review = [];
const flag = (invoice, customer, reason, detail) =>
  review.push({ invoice, customer, reason, detail });

/** One asset line -> "MODEL serial". Serials are missing on a few lines. */
const describe = (row) => {
  const model = cell(row, C.MODEL) || '(unnamed)';
  const serial = cell(row, C.SERIAL);
  return serial ? `${model} ${serial}` : model;
};

function buildRow(block, lines, amsCell, label) {
  const p = block.parent;
  const customer = cell(p, C.CUSTOMER);
  const invoice = cell(p, C.INVOICE).replace(/\.0$/, '');
  const invoiceDate = parseDate(p[C.INVOICE_DATE]);

  if (!invoiceDate) {
    flag(invoice, customer, 'unreadable invoice date', String(p[C.INVOICE_DATE]));
    return null;
  }

  const computed = addYears(invoiceDate.date, WARRANTY_YEARS);
  const ams = parseDate(amsCell);

  // The sheet's own expiry is only ever compared, never trusted.
  const stated = parseDate(p[C.SHEET_EXPIRY]);
  if (stated && iso(stated.date) !== iso(computed)) {
    const swapped = transpose(stated.date);
    const reason = swapped && iso(swapped) === iso(computed)
      ? 'sheet expiry is day/month transposed'
      : 'sheet expiry disagrees with invoice + ' + WARRANTY_YEARS + 'y';
    flag(invoice, customer, reason, `sheet=${iso(stated.date)} computed=${iso(computed)}`);
  }

  // A native-format AMS date cannot be verified, and two such cells in this
  // workbook are provably transposed. Import it, but surface it for checking.
  if (ams && ams.native) {
    flag(invoice, customer, 'AMS date stored as a native Excel date — verify against the portal',
      `${iso(ams.date)} (transposed reading: ${transpose(ams.date) ? iso(transpose(ams.date)) : 'n/a'})`);
  }
  if (!ams) {
    flag(invoice, customer, 'no AMS date — expiry is computed and may be months early',
      `computed=${iso(computed)}`);
  }

  const expiry = ams ? ams.date : computed;
  const assets = lines.map(describe);
  const primary = cell(lines[0], C.MODEL) || label || 'warranty';
  const extra = assets.length > 1 ? ` +${assets.length - 1} more` : '';
  const value = Number(String(p[C.VALUE]).replace(/[^\d.]/g, '')) || null;

  return {
    srNo: cell(p, C.SR).replace(/\.0$/, ''),
    fields: {
      'Title': `${customer || 'Unknown customer'} — ${primary}${extra}`,
      'Customer Name': customer,
      'Location': cell(p, C.LOCATION),
      'Invoice No': invoice,
      'Invoice Date': iso(invoiceDate.date),
      'Expiry Date': iso(expiry),
      'Expiry Source': ams ? 'ams' : 'computed',
      'Value': value,
      'Asset Count': assets.length,
      'Assets': assets.join('; '),
      'Status': 'Active',
    },
  };
}

const plan = [];
for (const block of blocks) {
  const lines = [block.parent, ...block.children].filter(isAssetLine);

  // A child row carrying its own AMS date describes assets that expire on a
  // different day from the rest of the invoice, so it becomes its own reminder.
  // The dated line is followed by the undated lines of the same model, which
  // share its date — collect those into the group before splitting them out, or
  // they would be counted twice.
  const dated = block.children.filter((r) => cell(r, C.AMS) !== '');
  const datedSet = new Set(dated);
  const groups = dated.map((child) => {
    const group = [child];
    for (let i = block.children.indexOf(child) + 1; i < block.children.length; i++) {
      const next = block.children[i];
      if (!isAssetLine(next) || datedSet.has(next)) break;
      if (cell(next, C.MODEL) && cell(next, C.MODEL) !== cell(child, C.MODEL)) break;
      group.push(next);
    }
    return { child, group };
  });

  const claimed = new Set(groups.flatMap(({ group }) => group));
  const main = lines.filter((r) => !claimed.has(r));

  if (main.length) {
    const row = buildRow(block, main, block.parent[C.AMS], null);
    if (row) plan.push(row);
  }
  for (const { child, group } of groups) {
    const row = buildRow(block, group, child[C.AMS], cell(child, C.MODEL));
    if (row) plan.push(row);
  }
}

// --- report ----------------------------------------------------------------

plan.sort((a, b) => a.fields['Expiry Date'].localeCompare(b.fields['Expiry Date']));

console.log(`File   : ${FILE} (sheet "${SHEET}")`);
console.log(`Blocks : ${blocks.length} invoices -> ${plan.length} reminder rows`);
console.log(`Serials: ${plan.reduce((n, r) => n + r.fields['Asset Count'], 0)}`);
console.log(`Mode   : ${MODE_IMPORT ? 'IMPORT (writes)' : 'AUDIT (no writes)'}`);
console.log(`Today  : ${iso(TODAY)}\n`);

const pad = (s, n) => String(s).slice(0, n).padEnd(n);
for (const { srNo, fields } of plan) {
  const d = daysFrom(new Date(fields['Expiry Date']), TODAY);
  const when = d < 0 ? `LAPSED ${-d}d` : `in ${d}d`;
  console.log(
    `  sr${pad(srNo, 3)} ${pad(fields['Customer Name'], 32)} ${pad(fields['Asset Count'] + ' sn', 6)}` +
    ` ${fields['Expiry Date']}  ${pad(when, 13)} ${fields['Expiry Source']}`
  );
}

const bySource = plan.reduce((acc, r) => {
  acc[r.fields['Expiry Source']] = (acc[r.fields['Expiry Source']] || 0) + 1;
  return acc;
}, {});
console.log(`\n  ams=${bySource.ams || 0}  computed=${bySource.computed || 0}`);

const soon = plan.filter((r) => {
  const d = daysFrom(new Date(r.fields['Expiry Date']), TODAY);
  return d >= 0 && d <= 30;
});
const lapsed = plan.filter((r) => daysFrom(new Date(r.fields['Expiry Date']), TODAY) < 0);
console.log(`  expiring within 30 days: ${soon.length}   already lapsed: ${lapsed.length}`);

if (review.length) {
  const csv = ['invoice,customer,reason,detail']
    .concat(review.map((r) => [r.invoice, r.customer, r.reason, r.detail]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')))
    .join('\n');
  const out = new URL('./_warranty_import_review.csv', import.meta.url).pathname
    .replace(/^\/([A-Z]:)/, '$1').replace(/%20/g, ' ');
  writeFileSync(out, csv);
  console.log(`\n  ${review.length} row(s) need a human look -> _warranty_import_review.csv`);
  for (const r of review) console.log(`    ${pad(r.invoice, 12)} ${pad(r.customer, 26)} ${r.reason}`);
}

if (!MODE_IMPORT) {
  console.log('\nAudit only — nothing written. Re-run with --import to create the rows.');
  process.exit(0);
}

// --- write -----------------------------------------------------------------

const xcToken = MODE_DIRECT
  ? (await import('fs')).readFileSync(TOKEN_FILE, 'utf8').trim()
  : null;

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(MODE_DIRECT ? { 'xc-token': xcToken } : { Authorization: `Bearer ${JWT_TOKEN}` }),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

// NocoDB's v2 data API rejects a `fields` list containing Id, so the direct
// read asks for whole records — the table is small enough that it costs nothing.
const listUrl = MODE_DIRECT
  ? `${NOCODB_HOST}/api/v2/tables/${NOCODB_TABLE_ID}/records?limit=1000`
  : `${PROXY_URL}/proxy/${TABLE}/records?fields=Id,Invoice No,Expiry Date&limit=1000`;
const createUrl = MODE_DIRECT
  ? `${NOCODB_HOST}/api/v2/tables/${NOCODB_TABLE_ID}/records`
  : `${PROXY_URL}/proxy/${TABLE}/records`;

// The two APIs disagree on envelopes: NocoDB takes a bare record object, the
// proxy expects it wrapped in { fields }.
const payload = (fields) => JSON.stringify(MODE_DIRECT ? fields : { fields });

// Re-running must not duplicate: match on Invoice No + Expiry Date, since one
// invoice can legitimately produce two rows with different expiry dates.
const existing = await request(listUrl);
const list = existing?.list || existing?.records || existing || [];
const seen = new Set(list.map((r) => `${r['Invoice No']}|${r['Expiry Date']}`));

console.log(`\nExisting rows: ${list.length}`);
let created = 0, skipped = 0;
const failed = [];
for (const { fields } of plan) {
  const key = `${fields['Invoice No']}|${fields['Expiry Date']}`;
  if (seen.has(key)) {
    console.log(`  SKIP ${fields['Title']} (already present)`);
    skipped++;
    continue;
  }
  try {
    const res = await request(createUrl, { method: 'POST', body: payload(fields) });
    const id = res?.id ?? res?.Id ?? res?.records?.[0]?.id ?? '?';
    console.log(`  OK   ${fields['Title']} (Id ${id})`);
    created++;
  } catch (err) {
    console.error(`  ERR  ${fields['Title']}: ${err.message}`);
    failed.push({ title: fields['Title'], error: err.message });
  }
}

console.log(`\nCreated ${created}, skipped ${skipped}, failed ${failed.length}.`);
if (failed.length) process.exitCode = 1;
