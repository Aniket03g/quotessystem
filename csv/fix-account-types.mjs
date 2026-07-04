/**
 * Audit + fix missing Account Type values in NocoDB.
 *
 * Fetches all accounts, cross-references with the Excel file (by GST No,
 * falling back to company name), then reports and optionally patches.
 *
 * Usage:
 *   node fix-account-types.mjs --audit          # show accounts with missing type
 *   node fix-account-types.mjs --fix            # audit + PATCH the missing ones
 *
 * Env vars:
 *   PROXY_URL   (default: http://localhost:8082)
 *   JWT_TOKEN   your JWT from browser devtools → Application → localStorage → jwt_token
 */

import { createRequire } from 'module';
const XLSX = createRequire(import.meta.url)('xlsx');

const PROXY_URL = process.env.PROXY_URL || 'http://localhost:8082';
const JWT_TOKEN = process.env.JWT_TOKEN || '';

const args = process.argv.slice(2);
const MODE_AUDIT = args.includes('--audit');
const MODE_FIX   = args.includes('--fix');

if (!MODE_AUDIT && !MODE_FIX) {
  console.log('Usage: node fix-account-types.mjs --audit | --fix');
  process.exit(1);
}

if (!JWT_TOKEN) {
  console.error('JWT_TOKEN env var is not set.\nGet it from browser devtools → Application → localStorage → jwt_token');
  process.exit(1);
}

// ─── Build GST → AccountType + Name → AccountType maps from Excel ─────────────

const FILE_PATH = new URL('./dealer and customer list for CRM.xlsx', import.meta.url)
  .pathname.replace(/^\/([A-Z]:)/, '$1').replace(/%20/g, ' ');

const wb = XLSX.readFile(FILE_PATH);

const gstToType  = new Map(); // GST No → 'Dealer' | 'Customer'
const nameToType = new Map(); // Company Name (lowercase) → 'Dealer' | 'Customer'

for (const [sheet, type] of [['dealer', 'Dealer'], ['customer', 'Customer']]) {
  const ws = wb.Sheets[sheet];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0] || '').trim();
    const gst  = String(rows[i][11] || '').trim();
    if (gst)  gstToType.set(gst, type);
    if (name) nameToType.set(name.toLowerCase(), type);
  }
}

console.log(`Excel: ${gstToType.size} GST entries, ${nameToType.size} name entries loaded`);

// ─── Fetch all accounts from NocoDB (paginated) ───────────────────────────────

async function apiFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${JWT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${PROXY_URL}${path}`, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function fetchAllAccounts() {
  // The Go proxy auto-paginates and returns all records in one response
  const data = await apiFetch(`/proxy/accounts_duplicate/records?limit=10000`);
  return data?.list ?? data?.records ?? [];
}

console.log('Fetching all accounts from NocoDB...');
const accounts = await fetchAllAccounts();
console.log(`Fetched ${accounts.length} accounts\n`);

// ─── Audit: find accounts with missing Account Type ───────────────────────────

const missing = [];
const unknown = [];

for (const acc of accounts) {
  const f    = acc.fields ?? acc;
  const type = f['Account Type'];
  if (type && type.trim()) continue; // already has a value

  const id   = acc.id ?? f['Id'];
  const name = (f['Account Name'] || f['Company Name'] || '').trim();
  const gst  = (f['GST No'] || '').trim();

  // Resolve correct type: GST first, then name
  const resolved = gstToType.get(gst) ?? nameToType.get(name.toLowerCase()) ?? null;

  if (resolved) {
    missing.push({ id, name, gst, resolved });
  } else {
    unknown.push({ id, name, gst });
  }
}

console.log(`Accounts missing Account Type : ${missing.length + unknown.length}`);
console.log(`  → Resolvable from Excel      : ${missing.length}`);
console.log(`  → Cannot resolve (not in XLS): ${unknown.length}\n`);

if (missing.length > 0) {
  console.log('─'.repeat(90));
  console.log('ID'.padEnd(8) + 'Resolved Type'.padEnd(12) + 'GST'.padEnd(20) + 'Company');
  console.log('─'.repeat(90));
  for (const r of missing) {
    console.log(
      String(r.id).padEnd(8) +
      r.resolved.padEnd(12) +
      (r.gst || '(no GST)').padEnd(20) +
      r.name.slice(0, 48)
    );
  }
  console.log('─'.repeat(90));
}

if (unknown.length > 0) {
  console.log('\nCannot resolve (no match in Excel):');
  for (const r of unknown) {
    console.log(`  [${r.id}] ${r.name} | GST: ${r.gst || 'none'}`);
  }
}

// ─── Fix: PATCH the resolvable ones ──────────────────────────────────────────

if (MODE_FIX && missing.length > 0) {
  console.log(`\nPatching ${missing.length} accounts...`);
  let ok = 0, fail = 0;

  for (const r of missing) {
    process.stdout.write(`  [${r.id}] ${r.name.slice(0, 40).padEnd(42)} → ${r.resolved} ... `);
    try {
      await apiFetch(
        `/proxy/accounts_duplicate/records`,
        'PATCH',
        { id: String(r.id), fields: { 'Account Type': r.resolved } }
      );
      console.log('OK');
      ok++;
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      fail++;
    }
    await new Promise(res => setTimeout(res, 80));
  }

  console.log(`\n✓ Done — Patched: ${ok}, Failed: ${fail}`);
  if (unknown.length > 0) {
    console.log(`${unknown.length} accounts still have no Account Type — not in Excel, needs manual review.`);
  }
} else if (MODE_FIX && missing.length === 0) {
  console.log('\nNothing to patch — all resolvable accounts already have Account Type set.');
}
