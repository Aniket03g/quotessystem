/**
 * Grove CRM Bulk Importer
 * Reads "dealer and customer list for CRM.xlsx", parses addresses into
 * City/State/PostalCode/Street, then imports accounts + contacts to NocoDB
 * via the Go proxy API.
 *
 * Usage:
 *   node import.mjs --preview          # show parsed data, no API calls
 *   node import.mjs --import           # actually import to NocoDB
 *   node import.mjs --import --limit=50 # import first 50 rows only
 *
 * Set env vars before running:
 *   PROXY_URL   (default: http://localhost:8082)
 *   JWT_TOKEN   your JWT from localStorage (open devtools → Application → localStorage → jwt_token)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import { readFileSync } from 'fs';

const PROXY_URL = process.env.PROXY_URL || 'http://localhost:8082';
const JWT_TOKEN = process.env.JWT_TOKEN || '';
const FILE_PATH = new URL('./dealer and customer list for CRM.xlsx', import.meta.url).pathname
  .replace(/^\/([A-Z]:)/, '$1')
  .replace(/%20/g, ' ');

const args = process.argv.slice(2);
const MODE_PREVIEW = args.includes('--preview');
const MODE_IMPORT  = args.includes('--import');
const LIMIT_ARG    = args.find(a => a.startsWith('--limit='));
const LIMIT        = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : Infinity;

if (!MODE_PREVIEW && !MODE_IMPORT) {
  console.log('Usage: node import.mjs --preview | --import [--limit=N]');
  process.exit(1);
}

// ─── Address Parser ───────────────────────────────────────────────────────────

const INDIA_STATES = [
  'Maharashtra', 'Uttar Pradesh', 'Haryana', 'Gujarat', 'Karnataka',
  'Tamil Nadu', 'Kerala', 'West Bengal', 'Rajasthan', 'Punjab',
  'Madhya Pradesh', 'Andhra Pradesh', 'Telangana', 'Odisha', 'Bihar',
  'Jharkhand', 'Uttarakhand', 'Himachal Pradesh', 'Jammu & Kashmir',
  'Jammu and Kashmir', 'Goa', 'Tripura', 'Assam', 'Meghalaya',
  'Manipur', 'Nagaland', 'Mizoram', 'Sikkim', 'Arunachal Pradesh',
  'Chhattisgarh', 'Chandigarh', 'Puducherry',
  // Union territories and short forms
  'Delhi', 'Ladakh',
];

// Use word-boundary matching so "New Delhi" doesn't match "Delhi"
const STATE_PATTERNS = INDIA_STATES.map(s => ({
  name: s,
  re: new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
}));

const CITY_TO_STATE = {
  'New Delhi': 'Delhi',
  'West Delhi': 'Delhi',
  'East Delhi': 'Delhi',
  'North Delhi': 'Delhi',
  'South Delhi': 'Delhi',
  'North West': 'Delhi',
  'Central Delhi': 'Delhi',
  'Mumbai': 'Maharashtra',
  'Mumbai City': 'Maharashtra',
  'Navi Mumbai': 'Maharashtra',
  'Kolkata': 'West Bengal',
  'Chennai': 'Tamil Nadu',
  'Bangalore': 'Karnataka',
  'Bengaluru': 'Karnataka',
  'Hyderabad': 'Telangana',
  'Ahmedabad': 'Gujarat',
  'Pune': 'Maharashtra',
  'Noida': 'Uttar Pradesh',
  'Greater Noida': 'Uttar Pradesh',
  'Gurgaon': 'Haryana',
  'Gurugram': 'Haryana',
  'Faridabad': 'Haryana',
  'Sonipat': 'Haryana',
  'Panipat': 'Haryana',
  'Agartala': 'Tripura',
  'Trivandrum': 'Kerala',
  'Thiruvananthapuram': 'Kerala',
  'Surat': 'Gujarat',
  'Agra': 'Uttar Pradesh',
  'Lucknow': 'Uttar Pradesh',
  'Kanpur': 'Uttar Pradesh',
  'Jaipur': 'Rajasthan',
  'Jodhpur': 'Rajasthan',
  'Bhopal': 'Madhya Pradesh',
  'Indore': 'Madhya Pradesh',
  'Nagpur': 'Maharashtra',
  'Patna': 'Bihar',
  'Bhubaneswar': 'Odisha',
  'Dehradun': 'Uttarakhand',
  'Shimla': 'Himachal Pradesh',
  'Coimbatore': 'Tamil Nadu',
  'Kochi': 'Kerala',
  'Cochin': 'Kerala',
  'Visakhapatnam': 'Andhra Pradesh',
  'Vijayawada': 'Andhra Pradesh',
  'Mangalore': 'Karnataka',
  'Mysore': 'Karnataka',
  'Varanasi': 'Uttar Pradesh',
  'Allahabad': 'Uttar Pradesh',
  'Prayagraj': 'Uttar Pradesh',
  'Amritsar': 'Punjab',
  'Ludhiana': 'Punjab',
  'Chandigarh': 'Chandigarh',
  'Guwahati': 'Assam',
  'Raipur': 'Chhattisgarh',
  'Ranchi': 'Jharkhand',
  'Kolhapur': 'Maharashtra',
  'Nashik': 'Maharashtra',
  'Aurangabad': 'Maharashtra',
  'Thane': 'Maharashtra',
  'Vasai': 'Maharashtra',
  'Mulund': 'Maharashtra',
  'Andheri': 'Maharashtra',
};

function parseIndianAddress(raw) {
  if (!raw || !raw.trim()) {
    return { street: '', city: '', state: '', postalCode: '', country: 'India' };
  }

  let addr = raw.trim().replace(/,+\s*$/, '');
  let postalCode = '';

  // Extract 6-digit Indian pin code at the end
  const pinMatch = addr.match(/[-–\s]+(\d{6})\s*,?\s*$/);
  if (pinMatch) {
    postalCode = pinMatch[1];
    addr = addr.slice(0, pinMatch.index).trim().replace(/,+$/, '').trim();
  }

  // Normalize double-commas and split into segments
  const segments = addr
    .replace(/,,+/g, ',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return { street: addr, city: '', state: '', postalCode, country: 'India' };
  }

  let state = '';
  let city = '';

  // Strip "District" / "Dist." prefixes before matching
  let lastSeg = segments[segments.length - 1].replace(/^(District|Dist\.)\s+/i, '').trim();

  // Try exact match against known state list
  const matchedState = STATE_PATTERNS.find(p => p.re.test(lastSeg));

  if (matchedState) {
    state = matchedState.name;
    segments.pop();
    if (segments.length > 0) {
      city = segments.pop();
    }
  } else {
    // Treat as city and infer state from map
    city = lastSeg;
    segments.pop();
    const cityKey = Object.keys(CITY_TO_STATE).find(k =>
      city.toLowerCase().includes(k.toLowerCase())
    );
    if (cityKey) {
      state = CITY_TO_STATE[cityKey];
    }
  }

  const street = segments.join(', ');
  return { street, city, state, postalCode, country: 'India' };
}

// ─── Excel Reader ─────────────────────────────────────────────────────────────

function readSheet(workbook, sheetName, accountType) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) { console.warn(`Sheet "${sheetName}" not found`); return []; }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  // headers: Company name, End user, First Name, Last name, Contact Person,
  //          Email Id, Designation, Dept, Mobile no., landline No., Address, GST No.
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const company  = String(r[0] || '').trim();
    const firstName = String(r[2] || '').trim();
    const lastName  = String(r[3] || '').trim();
    const contactPerson = String(r[4] || '').trim();
    const email     = String(r[5] || '').trim();
    const designation = String(r[6] || '').trim();
    const dept      = String(r[7] || '').trim();
    const mobile    = String(r[8] || '').trim();
    const landline  = String(r[9] || '').trim();
    const rawAddr   = String(r[10] || '').trim();
    const gst       = String(r[11] || '').trim();

    if (!company && !gst) continue; // skip empty rows

    const addr = parseIndianAddress(rawAddr);

    // Clean phone: skip Excel error values
    const phone = (mobile && !mobile.includes('#')) ? mobile
                : (landline && !landline.includes('#')) ? landline
                : '';

    // Contact name: prefer "Contact Person", fall back to First+Last
    const contactName = contactPerson || [firstName, lastName].filter(Boolean).join(' ');

    results.push({
      account: {
        'Account Name': company,
        'Company Name': company,
        'Phone Number': phone,
        'GST No': gst,
        'Email 1': email,
        'Account Type': accountType,
        'Billing Street': addr.street,
        'Billing City': addr.city,
        'Billing State': addr.state,
        'Billing Code': addr.postalCode,
        'Billing Country': addr.country,
        'Source': 'Import',
      },
      contact: contactName ? {
        name: contactName,
        fields: {
          'Name': contactName,
          ...(email ? { 'Email': email } : {}),
          ...(phone ? { 'Phone Number': phone } : {}),
          ...(landline && !landline.includes('#') && landline !== phone ? { 'Other Phone': landline } : {}),
          ...(dept ? { 'Department': dept } : {}),
        },
      } : null,
    });
  }

  return results;
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

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

async function gstExists(_gst) {
  return false; // duplicate check disabled — import all rows
}

async function createAccount(fields) {
  const result = await apiFetch('/proxy/accounts_duplicate/records', 'POST', { fields });
  return result?.records?.[0]?.id ?? result?.id;
}

async function createContact(fields) {
  const result = await apiFetch('/proxy/contacts/records', 'POST', { fields });
  return result?.records?.[0]?.id ?? result?.id;
}

async function linkContactToAccount(contactId, accountId) {
  await apiFetch(`/proxy/contacts/links/accounts_duplicate/${contactId}`, 'POST', [{ id: accountId }]);
}

// ─── Preview ──────────────────────────────────────────────────────────────────

function printPreview(rows) {
  console.log('\n' + '─'.repeat(120));
  console.log(
    'Company'.padEnd(30) +
    'Type'.padEnd(10) +
    'GST'.padEnd(18) +
    'Street'.padEnd(30) +
    'City'.padEnd(18) +
    'State'.padEnd(16) +
    'PIN'
  );
  console.log('─'.repeat(120));
  for (const { account, contact } of rows) {
    const co  = (account['Account Name'] || '').slice(0, 28).padEnd(30);
    const typ = (account['Account Type'] || '').padEnd(10);
    const gst = (account['GST No'] || '').padEnd(18);
    const str = (account['Billing Street'] || '').slice(0, 28).padEnd(30);
    const cit = (account['Billing City'] || '').slice(0, 16).padEnd(18);
    const sta = (account['Billing State'] || '').slice(0, 14).padEnd(16);
    const pin = (account['Billing Code'] || '');
    console.log(co + typ + gst + str + cit + sta + pin);
    if (contact) {
      console.log(`  → Contact: ${contact.name}${contact.fields['Department'] ? ' | Dept: ' + contact.fields['Department'] : ''}`);
    }
  }
  console.log('─'.repeat(120));
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function importRows(rows) {
  if (!JWT_TOKEN) {
    console.error('JWT_TOKEN env var is not set. Get your token from browser devtools → Application → localStorage → jwt_token');
    process.exit(1);
  }

  let created = 0, skipped = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const { account, contact } = rows[i];
    const company = account['Account Name'];
    const gst     = account['GST No'];

    process.stdout.write(`[${i + 1}/${rows.length}] ${company.slice(0, 40).padEnd(40)} `);

    try {
      // Skip duplicate GST
      if (gst && await gstExists(gst)) {
        console.log('SKIP (GST exists)');
        skipped++;
        continue;
      }

      const accountId = await createAccount(account);

      if (contact && accountId) {
        const contactId = await createContact(contact.fields);
        if (contactId) {
          await linkContactToAccount(contactId, accountId);
        }
      }

      console.log(`OK (accountId=${accountId})`);
      created++;
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      failed++;
    }

    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n✓ Done — Created: ${created}, Skipped: ${skipped}, Failed: ${failed}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const workbook = XLSX.readFile(FILE_PATH);

const dealerRows   = readSheet(workbook, 'dealer',   'Dealer');
const customerRows = readSheet(workbook, 'customer', 'Customer');
const allRows      = [...dealerRows, ...customerRows].slice(0, LIMIT);

console.log(`Loaded ${dealerRows.length} dealers + ${customerRows.length} customers = ${allRows.length} rows total`);
if (LIMIT < Infinity) console.log(`(limited to first ${LIMIT})`);

if (MODE_PREVIEW) {
  printPreview(allRows.slice(0, 50));
  console.log(`\nShowing first 50 of ${allRows.length} rows. Run with --import to push to NocoDB.`);
}

if (MODE_IMPORT) {
  console.log(`\nImporting ${allRows.length} rows to ${PROXY_URL} ...\n`);
  await importRows(allRows);
}
