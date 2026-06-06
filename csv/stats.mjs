import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const TOKEN   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYWRtaW4tMDAxIiwicm9sZSI6ImFkbWluIiwiZXhwIjoxNzgwNzU1MzkwLCJpYXQiOjE3ODA2Njg5OTB9.rvgwV-tncgsm9gMtq40exuVVNxuoCSt0-creA605KJc';
const BASE    = 'http://148.135.136.1:8082';
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: HEADERS });
  return r.json();
}

// Fetch all records
console.log('Fetching accounts...');
const acctData = await get('/proxy/accounts_duplicate/records?limit=5000');
const accounts = acctData.records;

console.log('Fetching contacts...');
const contData = await get('/proxy/contacts/records?limit=5000');
const contacts = contData.records;

// Build accountId → [contacts] map
const acctMap = new Map(); // id -> { account obj, contacts: [] }
for (const a of accounts) {
  acctMap.set(a.id, { ...a.fields, _id: a.id, _contacts: [] });
}

let unlinked = 0;
for (const c of contacts) {
  const linkedId = c.fields['nc_i78f__Accounts duplicate_id'];
  if (linkedId && acctMap.has(linkedId)) {
    acctMap.get(linkedId)._contacts.push({
      name:   c.fields['Name'] || '',
      email:  c.fields['Email'] || '',
      phone:  c.fields['Phone Number'] || '',
      dept:   c.fields['Department'] || '',
    });
  } else {
    unlinked++;
  }
}

const allAccounts = [...acctMap.values()];

// Core counts
const totalAccounts     = allAccounts.length;
const totalContacts     = contacts.length;
const linkedContacts    = totalContacts - unlinked;
const withContact       = allAccounts.filter(a => a._contacts.length > 0).length;
const withoutContact    = totalAccounts - withContact;

// By type
const byType = {};
for (const a of allAccounts) {
  const t = a['Account Type'] || '(None)';
  byType[t] = (byType[t] || 0) + 1;
}

// Contact distribution
const dist = { 0: 0, 1: 0, 2: 0, '3+': 0 };
for (const a of allAccounts) {
  const n = a._contacts.length;
  if (n === 0)      dist[0]++;
  else if (n === 1) dist[1]++;
  else if (n === 2) dist[2]++;
  else              dist['3+']++;
}

// By state
const byState = {};
for (const a of allAccounts) {
  const s = a['Billing State'] || '(No State)';
  byState[s] = (byState[s] || 0) + 1;
}
const topStates = Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 12);

// Accounts with most contacts (all have ≤1 here but keep generic)
const topByContacts = allAccounts
  .filter(a => a._contacts.length > 0)
  .sort((a, b) => b._contacts.length - a._contacts.length)
  .slice(0, 15)
  .map(a => ({ name: a['Account Name'], type: a['Account Type'], count: a._contacts.length, contacts: a._contacts.map(c => c.name).join(', ') }));

// Accounts with no contacts list (for report)
const noContactList = allAccounts
  .filter(a => a._contacts.length === 0)
  .map(a => ({ name: a['Account Name'], type: a['Account Type'], state: a['Billing State'] || '', city: a['Billing City'] || '' }));

const stats = {
  totalAccounts, totalContacts, linkedContacts, unlinkedContacts: unlinked,
  withContact, withoutContact, byType, dist, topStates, topByContacts, noContactList,
};

// Write JSON for report generator
import { writeFileSync } from 'fs';
writeFileSync(new URL('./stats_output.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1').replace(/%20/g,' '), JSON.stringify(stats, null, 2));
console.log('Stats saved to stats_output.json');
console.log(`Accounts: ${totalAccounts} | Contacts: ${totalContacts} | With contact: ${withContact} | Without: ${withoutContact}`);
