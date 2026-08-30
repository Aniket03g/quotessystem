/**
 * Resolve the model numbers in an AMC sheet against NocoDB's Products table and
 * emit the AMC linkage: one contract per invoice row, one asset per model token,
 * each asset carrying the NocoDB product id it resolved to.
 *
 * Why this is not a simple lookup: the sheet's Model cell is free text. Separators
 * are inconsistent (commas, bare spaces, or both), some models are multi-word
 * ("Trueview 85"), and the catalogue often carries a longer variant of the same
 * model ("VCH51" on the invoice is "VCH51 Pro Package" in NocoDB). So matching runs
 * in tiers and every token is reported with the tier it landed in — nothing is
 * silently dropped or silently guessed:
 *
 *   exact     normalised model strings are equal
 *   prefix    sheet model is a prefix of exactly one catalogue model
 *   ambiguous sheet model prefixes several (e.g. A30 -> A30-010, A30-020) -> needs a human
 *   missing   not in the catalogue at all (usually a discontinued model)
 *
 * A brand hint from the sheet's Products columns narrows candidates before the
 * fuzzy tiers run, so "A30" cannot drift onto an Ahuja amplifier.
 *
 * Usage:
 *   node _match-models.mjs                       # default: amc demo.xlsx
 *   node _match-models.mjs --file="AMC Data kddi.xlsx"
 *
 * Reads _products.json (refresh it with _fetch-products.mjs). Writes
 * _amc_connection.json and _amc_connection_review.xlsx.
 */
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
const XLSX = createRequire(import.meta.url)('xlsx');

const fileArg = process.argv.find(a => a.startsWith('--file='));
const FILE = fileArg ? fileArg.slice(7) : 'amc demo.xlsx';

const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---- product index -------------------------------------------------------
// The v3 pagination overlaps between pages, so dedupe by id before indexing.
const raw = JSON.parse(readFileSync('_products.json', 'utf8'));
const seen = new Set();
const products = raw.filter(p => !seen.has(p.id) && seen.add(p.id)).filter(p => norm(p['Model No']));
const exactIdx = new Map();
for (const p of products) {
  const k = norm(p['Model No']);
  if (!exactIdx.has(k)) exactIdx.set(k, []);
  exactIdx.get(k).push(p);
}

const brandOf = p => String(p.Brand ?? '').toLowerCase();
const slim = p => ({
  id: p.id, model: p['Model No'], name: p['Product Name'], brand: p.Brand,
  category: p['Product Category'], status: p['Product Status'],
  warrantyYears: p.warranty, uom: p['Unit of Measurement UOM'],
  customerPrice: p['Customer Unit Price'], hsn: p['HSN/SAC Code'],
});

/** Resolve one model string, preferring candidates whose brand matches a sheet hint. */
function resolve(model, brandHints) {
  const k = norm(model);
  if (!k) return { tier: 'missing', candidates: [] };

  const narrow = list => {
    if (!brandHints.length || list.length < 2) return list;
    const hit = list.filter(p => brandHints.some(b => brandOf(p).includes(b) || b.includes(brandOf(p))));
    return hit.length ? hit : list;
  };

  const exact = narrow(exactIdx.get(k) || []);
  if (exact.length === 1) return { tier: 'exact', candidates: exact };
  if (exact.length > 1) return { tier: 'ambiguous', candidates: exact };

  // Catalogue often appends a suffix ("Pro Package", "-W Package") to the model
  // printed on the invoice, so a prefix hit is the common near-miss.
  const pre = narrow(products.filter(p => norm(p['Model No']).startsWith(k)));
  if (pre.length === 1) return { tier: 'prefix', candidates: pre };
  if (pre.length > 1) return { tier: 'ambiguous', candidates: pre };

  return { tier: 'missing', candidates: [] };
}

// ---- sheet ---------------------------------------------------------------
const wb = XLSX.readFile(FILE);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });

const hdrIdx = rows.findIndex(r => r.some(c => String(c).trim().toLowerCase() === 'model'));
if (hdrIdx < 0) { console.error(`No header row with a "Model" column in ${FILE}`); process.exit(1); }
const hdr = rows[hdrIdx].map(c => String(c).trim());
const col = n => hdr.findIndex(h => h.toLowerCase() === n.toLowerCase());
const C = {
  sr: col('Sr no'), partner: col('Partner'), customer: col('Customer'), location: col('Location'),
  invoice: col('Invoice no'), invDate: col('Invoice Date'), basic: col('Basic Value'),
  model: col('Model'), serial: col('serial no.'), qty: col('Quantity'), price: col('Price'),
  products: col('Products'),
};

const xlDate = v => {
  const n = Number(v);
  if (!n || Number.isNaN(n)) return String(v || '');
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
};

/** Greedy longest-first scan: try the whole segment, then shorter leading runs. */
function scanSegment(seg, brandHints) {
  const tokens = seg.trim().split(/\s+/).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    let hit = null;
    for (let len = tokens.length - i; len >= 1; len--) {
      const cand = tokens.slice(i, i + len).join(' ');
      const res = resolve(cand, brandHints);
      if (res.tier !== 'missing') { hit = { raw: cand, len, res }; break; }
    }
    if (hit) { out.push({ raw: hit.raw, ...hit.res }); i += hit.len; }
    else { out.push({ raw: tokens[i], tier: 'missing', candidates: [] }); i += 1; }
  }
  return out;
}

const contracts = [];
for (let r = hdrIdx + 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row || row.every(c => String(c).trim() === '')) continue;

  const brands = hdr.slice(C.products).map((_, k) => String(row[C.products + k] ?? '').trim())
    .filter(Boolean).map(b => b.toLowerCase());
  const modelCell = String(row[C.model] ?? '').trim();
  const items = modelCell ? modelCell.split(',').flatMap(s => scanSegment(s, brands)) : [];
  const serials = String(row[C.serial] ?? '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);

  contracts.push({
    srNo: row[C.sr],
    partner: String(row[C.partner] ?? '').trim(),
    customer: String(row[C.customer] ?? '').trim(),
    location: String(row[C.location] ?? '').trim(),
    invoiceNo: String(row[C.invoice] ?? '').trim(),
    invoiceDate: xlDate(row[C.invDate]),
    basicValue: row[C.basic] === '' ? null : Number(row[C.basic]),
    quantityCell: String(row[C.qty] ?? '').trim(),
    priceCell: row[C.price] === '' ? null : row[C.price],
    brandHints: brands,
    serials,
    // Serials are a flat list with no per-model delimiter, so they are attached at
    // contract level rather than guessed onto individual assets.
    serialsAlignToAssets: serials.length === items.length,
    modelCell,
    assets: items.map(it => ({
      sheetModel: it.raw,
      matchTier: it.tier,
      productId: it.tier === 'exact' || it.tier === 'prefix' ? it.candidates[0].id : null,
      product: it.tier === 'exact' || it.tier === 'prefix' ? slim(it.candidates[0]) : null,
      candidates: it.tier === 'ambiguous' ? it.candidates.map(slim) : [],
    })),
  });
}

writeFileSync('_amc_connection.json', JSON.stringify({ source: FILE, generated: new Date().toISOString(), contracts }, null, 1));

// ---- flat review sheet ---------------------------------------------------
const flat = [];
for (const c of contracts) {
  if (!c.assets.length) {
    flat.push({ 'Sr no': c.srNo, Customer: c.customer, Location: c.location, 'Invoice no': c.invoiceNo,
      'Invoice Date': c.invoiceDate, 'Basic Value': c.basicValue, 'Sheet Model': '', Match: 'no-model-data',
      'Product Id': '', 'NocoDB Model No': '', 'Product Name': '', Brand: '', Category: '',
      'Warranty (yrs)': '', 'Other Candidates': '', Serials: c.serials.join(' ') });
    continue;
  }
  for (const a of c.assets) {
    flat.push({
      'Sr no': c.srNo, Customer: c.customer, Location: c.location, 'Invoice no': c.invoiceNo,
      'Invoice Date': c.invoiceDate, 'Basic Value': c.basicValue,
      'Sheet Model': a.sheetModel, Match: a.matchTier,
      'Product Id': a.productId ?? '', 'NocoDB Model No': a.product?.model ?? '',
      'Product Name': a.product?.name ?? '', Brand: a.product?.brand ?? c.brandHints.join('/'),
      Category: a.product?.category ?? '', 'Warranty (yrs)': a.product?.warrantyYears ?? '',
      'Other Candidates': a.candidates.map(x => `${x.id}:${x.model}`).join(' | '),
      Serials: c.serials.join(' '),
    });
  }
}
const out = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(flat), 'AMC Connection');
XLSX.writeFile(out, '_amc_connection_review.xlsx');

// ---- console summary -----------------------------------------------------
const tally = { exact: 0, prefix: 0, ambiguous: 0, missing: 0 };
for (const c of contracts) {
  console.log(`\nSr ${c.srNo} | ${c.customer || '(customer blank in sheet)'} | inv ${c.invoiceNo} (${c.invoiceDate}) | brands: ${c.brandHints.join(', ') || '-'}`);
  if (!c.assets.length) { console.log('   (Model column empty for this row)'); continue; }
  for (const a of c.assets) {
    tally[a.matchTier]++;
    const tag = { exact: 'EXACT ', prefix: 'PREFIX', ambiguous: 'AMBIG ', missing: 'MISS  ' }[a.matchTier];
    if (a.product) console.log(`   ${tag} ${a.sheetModel.padEnd(11)} -> #${a.product.id} "${a.product.model}" ${a.product.name} [${a.product.brand}]`);
    else if (a.candidates.length) console.log(`   ${tag} ${a.sheetModel.padEnd(11)} -> ${a.candidates.map(x => `#${x.id} ${x.model}`).join('  /  ')}`);
    else console.log(`   ${tag} ${a.sheetModel.padEnd(11)} -> not in catalogue`);
  }
  if (c.serials.length) console.log(`   serials (${c.serials.length}) ${c.serialsAlignToAssets ? 'align 1:1 with assets' : 'do NOT align with asset count ' + c.assets.length}`);
}
const tot = Object.values(tally).reduce((a, b) => a + b, 0);
console.log(`\n=== ${tot} model tokens: ${tally.exact} exact, ${tally.prefix} prefix, ${tally.ambiguous} ambiguous, ${tally.missing} missing `
  + `(${tot ? Math.round((tally.exact + tally.prefix) / tot * 100) : 0}% auto-linked) ===`);
console.log('Wrote _amc_connection.json and _amc_connection_review.xlsx');
