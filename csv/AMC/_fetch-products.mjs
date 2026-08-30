/**
 * Dump the Products table out of NocoDB into _products.json for the model matcher.
 *
 * Defaults to the PRODUCTION NocoDB (148.135.136.1:8080), not the NOCODB_URL in
 * proxy/.env — that one points at the Tailscale dev instance and its product data
 * differs (prices and Active/Inactive status diverge). Override with --host=.
 *
 * The auth header is xc-token, taken from proxy/.env. Note this is NocoDB direct,
 * so a proxy-issued JWT will NOT work here — NocoDB rejects it as invalid.
 *
 * v3 is used rather than v2 because v2 expands the Products<->Quotes m2m links on
 * every row, which makes a 1000-row page 500 error. v3's `next` cursor overlaps
 * between pages, so callers must dedupe by id (the matcher does).
 *
 * Usage:
 *   node _fetch-products.mjs
 *   node _fetch-products.mjs --host=http://100.103.198.65:8090 --out=_products.dev.json
 */
import { writeFileSync, readFileSync } from 'fs';

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const env = Object.fromEntries(
  readFileSync('../../proxy/.env', 'utf8').split(/\r?\n/)
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);

const HOST = arg('host', 'http://148.135.136.1:8080').replace(/\/$/, '');
const OUT = arg('out', '_products.json');
const TOKEN = env.NOCODB_TOKEN;
const BID = env.NOCODB_BASE_ID;
const TID = 'mk85gltwt79dab0'; // Products

const FIELDS = ['Product Name', 'Model No', 'Brand', 'Product Category', 'Product Status',
  'Customer Unit Price', 'Dealer Unit Price', 'Unit of Measurement UOM', 'warranty',
  'HSN/SAC Code', 'Description'];

let url = `${HOST}/api/v3/data/${BID}/${TID}/records?limit=200&fields=${encodeURIComponent(FIELDS.join(','))}`;
const all = [];
while (url) {
  const r = await fetch(url, { headers: { 'xc-token': TOKEN } });
  const j = await r.json();
  if (!j.records) { console.error(JSON.stringify(j).slice(0, 300)); break; }
  for (const rec of j.records) all.push({ id: rec.id, ...rec.fields });
  // The cursor echoes back the host NocoDB thinks it is, which may be the internal
  // address, so rebuild the next URL against the host we were asked to use.
  url = j.next ? j.next.replace(/^https?:\/\/[^/]+/, HOST) : null;
}

const seen = new Set();
const unique = all.filter(p => !seen.has(p.id) && seen.add(p.id));
console.log(`host      : ${HOST}`);
console.log(`fetched   : ${all.length} rows, ${unique.length} unique ids`);
console.log(`with model: ${unique.filter(p => String(p['Model No'] ?? '').trim()).length}`);
writeFileSync(OUT, JSON.stringify(all, null, 1));
console.log(`wrote     : ${OUT}`);
