/**
 * Move warranty assets out of the parent row's free-text "Assets" string and
 * into their own table, one row per serial.
 *
 * WHY: a warranty row carries a single "Expiry Date" for the whole invoice, so
 * an invoice that mixes 1/3/5-year terms cannot be represented. The original
 * import worked around this by splitting such an invoice into several parent
 * rows (invoice 24250580 is in the table twice for exactly this reason). Once a
 * serial owns its own start/term/end, the invoice can be one row again.
 *
 * The source "Assets" string is lossy — "MODEL SERIAL" joined by "; ", with the
 * serial simply absent on lines that never had one, and model names that may
 * themselves contain spaces. splitAsset() below is the SAME heuristic the detail
 * page uses today; migrating just freezes its current guess into real fields, so
 * a wrong split becomes something a human can correct in the UI instead of
 * something the parser re-guesses on every render. Lines it cannot split are
 * listed in the audit.
 *
 * Term is an INPUT, End Date is the AUTHORITY:
 *   - "computed" parents: the expiry literally is invoice + 2 years, so the
 *     migrated asset gets Term Years = 2 and the same end date.
 *   - "ams" parents: the end date came from the Yealink portal and is not a
 *     round number of years from the invoice, so Term Years is left EMPTY.
 *     Filling it with a rounded guess would silently move the expiry the next
 *     time anything recomputed it.
 * Reminders always read End Date, never the term.
 *
 * Usage:
 *   node migrate-warranty-assets.mjs --audit        --host=http://h:8090 --parent-table-id=xxx --token-file=path
 *   node migrate-warranty-assets.mjs --create-table --host=http://h:8090 --base-id=xxx           --token-file=path
 *   node migrate-warranty-assets.mjs --apply        --host=http://h:8090 --parent-table-id=xxx --asset-table-id=yyy --token-file=path
 *
 * --apply is idempotent: it skips any parent that already has asset rows, so a
 * re-run after a partial failure resumes rather than duplicating.
 */
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=').replace(/^"|"$/g, '') : fallback;
};

const MODE_AUDIT = has('audit');
const MODE_CREATE = has('create-table');
const MODE_APPLY = has('apply');

const HOST = arg('host', process.env.NOCODB_HOST || '').replace(/\/$/, '');
const BASE_ID = arg('base-id', process.env.NOCODB_BASE_ID || 'pd0tf8xobxcryk6');
const PARENT_TABLE = arg('parent-table-id', process.env.NOCODB_TABLE_ID || '');
const ASSET_TABLE = arg('asset-table-id', process.env.NOCODB_ASSET_TABLE_ID || '');
const TOKEN_FILE = arg('token-file', process.env.NOCODB_TOKEN_FILE || '');

if (!MODE_AUDIT && !MODE_CREATE && !MODE_APPLY) {
  console.log('Usage: node migrate-warranty-assets.mjs --audit | --create-table | --apply');
  console.log('       --host=http://host:8090 --token-file=path');
  console.log('       --audit/--apply need --parent-table-id, --apply also needs --asset-table-id');
  console.log('       --create-table needs --base-id (default pd0tf8xobxcryk6)');
  process.exit(1);
}
if (!(HOST && TOKEN_FILE)) {
  console.error('--host and --token-file are required.');
  process.exit(1);
}
if ((MODE_AUDIT || MODE_APPLY) && !PARENT_TABLE) {
  console.error('--parent-table-id is required for --audit and --apply.');
  process.exit(1);
}
if (MODE_APPLY && !ASSET_TABLE) {
  console.error('--asset-table-id is required for --apply (run --create-table first).');
  process.exit(1);
}

const token = readFileSync(TOKEN_FILE, 'utf8').trim();
const headers = { 'xc-token': token, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// --- asset string parsing --------------------------------------------------

/**
 * "MODEL serial" -> {model, serial}. Mirrors splitAsset() in warranty-detail.astro
 * exactly; do not "improve" one without the other until the migration has run,
 * or the two will disagree about what the existing data means.
 */
function splitAsset(text) {
  const t = text.trim().replace(/,$/, '');
  const cut = t.lastIndexOf(' ');
  if (cut < 0) return { model: t, serial: '' };
  const tail = t.slice(cut + 1);
  if (tail.length >= 5 && /\d/.test(tail) && /^[A-Za-z0-9._/-]+$/.test(tail)) {
    return { model: t.slice(0, cut).replace(/,$/, '').trim(), serial: tail };
  }
  return { model: t, serial: '' };
}

const parseAssets = (s) =>
  String(s || '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(splitAsset);

// --- dates -----------------------------------------------------------------

const iso = (d) => d.toISOString().slice(0, 10);
const asDate = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00Z`) : null);
const addYears = (d, y) =>
  new Date(Date.UTC(d.getUTCFullYear() + y, d.getUTCMonth(), d.getUTCDate()));

/**
 * A term is only recorded when the end date really is that many whole years
 * after the start. Anything else (every "ams" row) keeps its end date and no
 * term, so nothing downstream can recompute the expiry and move it.
 */
function deriveTerm(start, end) {
  if (!start || !end) return null;
  for (const y of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    if (iso(addYears(start, y)) === iso(end)) return y;
  }
  return null;
}

// --- table creation --------------------------------------------------------

const ASSET_COLUMNS = [
  // The Id column has to be declared by hand. Passing an explicit `columns` list
  // suppresses the one NocoDB would otherwise add, and a table with no primary
  // key cannot be PATCHed by row.
  { title: 'Id', column_name: 'id', uidt: 'ID', pk: true, ai: true, rqd: true },
  { title: 'Title', column_name: 'Title', uidt: 'SingleLineText', pv: true },
  { title: 'Warranty Id', column_name: 'Warranty_Id', uidt: 'Number' },
  { title: 'Invoice No', column_name: 'Invoice_No', uidt: 'SingleLineText' },
  { title: 'Customer Name', column_name: 'Customer_Name', uidt: 'SingleLineText' },
  { title: 'Model', column_name: 'Model', uidt: 'SingleLineText' },
  { title: 'Serial Number', column_name: 'Serial_Number', uidt: 'SingleLineText' },
  { title: 'HSN/SAC', column_name: 'HSN_SAC', uidt: 'SingleLineText' },
  { title: 'Start Date', column_name: 'Start_Date', uidt: 'Date' },
  { title: 'Term Years', column_name: 'Term_Years', uidt: 'Decimal' },
  { title: 'End Date', column_name: 'End_Date', uidt: 'Date' },
  { title: 'Expiry Source', column_name: 'Expiry_Source', uidt: 'SingleSelect', dtxp: "'ams','computed','manual'" },
  { title: 'Status', column_name: 'Status', uidt: 'SingleSelect', dtxp: "'Active','Renewal Quoted','Renewed','Lapsed','Replaced'" },
  { title: 'Last Reminded', column_name: 'Last_Reminded', uidt: 'Date' },
  { title: 'Assigned To', column_name: 'Assigned_To', uidt: 'Email' },
  { title: 'Notes', column_name: 'Notes', uidt: 'LongText' },
];

async function createTable() {
  // NocoDB gives a table created without an explicit `columns` list no primary
  // key, so the full list is always sent.
  const created = await api('POST', `/api/v2/meta/bases/${BASE_ID}/tables`, {
    title: 'Warranty Assets',
    table_name: 'Warranty Assets',
    columns: ASSET_COLUMNS,
  });
  console.log(`Created table "Warranty Assets" id=${created.id}`);
  console.log(`\nNext: node migrate-warranty-assets.mjs --audit --host=${HOST} --parent-table-id=${PARENT_TABLE || '<parent>'} --token-file=...`);
  console.log(`Then: --apply ... --asset-table-id=${created.id}`);
  return created.id;
}

// --- records ---------------------------------------------------------------

async function fetchAll(tableId, fields) {
  const out = [];
  for (let offset = 0; ; offset += 200) {
    const q = `limit=200&offset=${offset}` + (fields ? `&fields=${encodeURIComponent(fields)}` : '');
    const page = await api('GET', `/api/v2/tables/${tableId}/records?${q}`);
    const list = page.list || [];
    out.push(...list);
    if (list.length < 200 || page.pageInfo?.isLastPage) break;
  }
  return out;
}

/** Every asset row the migration would write, in parent order. */
function plan(parents) {
  const rows = [];
  const problems = [];

  for (const p of parents) {
    const start = asDate(p['Invoice Date']);
    const end = asDate(p['Expiry Date']);
    const source = p['Expiry Source'] || 'computed';
    const lines = parseAssets(p['Assets']);

    if (!end) problems.push(`#${p.Id} ${p['Customer Name']}: parent has no Expiry Date`);
    if (lines.length !== (p['Asset Count'] ?? lines.length)) {
      problems.push(`#${p.Id} ${p['Customer Name']}: Asset Count says ${p['Asset Count']} but the string holds ${lines.length}`);
    }

    for (const { model, serial } of lines) {
      if (!serial) problems.push(`#${p.Id} ${p['Customer Name']}: "${model}" has no serial`);
      // "ams" end dates are portal dates, never a whole number of years from the
      // invoice, so deriveTerm correctly returns null for them.
      const term = source === 'ams' ? null : deriveTerm(start, end);
      rows.push({
        parentId: p.Id,
        fields: {
          'Title': [model, serial].filter(Boolean).join(' ') || '(unnamed asset)',
          'Warranty Id': p.Id,
          'Invoice No': p['Invoice No'] || '',
          'Customer Name': p['Customer Name'] || '',
          'Model': model || '',
          'Serial Number': serial || '',
          'Start Date': start ? iso(start) : null,
          'Term Years': term,
          'End Date': end ? iso(end) : null,
          'Expiry Source': source,
          'Status': p['Status'] || 'Active',
          'Assigned To': p['Assigned To'] || null,
        },
      });
    }
  }
  return { rows, problems };
}

// --- main ------------------------------------------------------------------

if (MODE_CREATE) {
  await createTable();
  process.exit(0);
}

const parents = await fetchAll(PARENT_TABLE);
const { rows, problems } = plan(parents);

console.log(`Parents: ${parents.length}`);
console.log(`Asset rows to write: ${rows.length}`);

const withTerm = rows.filter((r) => r.fields['Term Years']).length;
const noSerial = rows.filter((r) => !r.fields['Serial Number']).length;
console.log(`  with a derived term: ${withTerm}`);
console.log(`  term left empty (ams / non-whole-year): ${rows.length - withTerm}`);
console.log(`  no serial number: ${noSerial}`);

// An invoice appearing under more than one parent is the split the new model
// removes; report it, but merging parents is a separate, destructive step.
const byInvoice = new Map();
for (const p of parents) {
  const k = p['Invoice No'] || `(none) #${p.Id}`;
  if (!byInvoice.has(k)) byInvoice.set(k, []);
  byInvoice.get(k).push(p);
}
const dupes = [...byInvoice.entries()].filter(([, v]) => v.length > 1);
if (dupes.length) {
  console.log(`\nInvoices split across several parent rows (${dupes.length}):`);
  for (const [inv, ps] of dupes) {
    console.log(`  ${inv}: rows ${ps.map((p) => `#${p.Id} (${p['Expiry Date']}, ${p['Expiry Source']})`).join(' + ')}`);
  }
  console.log('  These merge into one invoice once assets own their dates — separate step, not done here.');
}

if (problems.length) {
  console.log(`\nThings to look at after migrating (${problems.length}):`);
  for (const p of problems) console.log(`  ${p}`);
}

if (MODE_AUDIT) {
  console.log('\nAudit only — nothing written.');
  process.exit(0);
}

// --apply
// NocoDB v2 rejects a `fields` list that names Id, but returns it regardless.
const existing = await fetchAll(ASSET_TABLE, 'Warranty Id');
const alreadyDone = new Set(existing.map((r) => r['Warranty Id']));
if (alreadyDone.size) {
  console.log(`\n${existing.length} asset rows already present for ${alreadyDone.size} parents — those are skipped.`);
}

const todo = rows.filter((r) => !alreadyDone.has(r.parentId));
if (!todo.length) {
  console.log('Nothing left to write.');
  process.exit(0);
}

console.log(`\nWriting ${todo.length} asset rows...`);
for (let i = 0; i < todo.length; i += 25) {
  const batch = todo.slice(i, i + 25).map((r) => r.fields);
  await api('POST', `/api/v2/tables/${ASSET_TABLE}/records`, batch);
  console.log(`  ${Math.min(i + 25, todo.length)}/${todo.length}`);
}
console.log('Done.');
