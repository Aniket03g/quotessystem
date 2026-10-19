/**
 * Notifications are DERIVED, not stored: each one is built from live data every
 * time (a lead's Next Follow-up, a warranty/AMC product's end date), so it can
 * never disagree with the record it points at. The proxy stores only which ones
 * a user has marked read (/api/notifications/read), per user.
 *
 * A notification's key carries its date — "lead:42:2026-09-30" — so moving a
 * follow-up to a new day produces a fresh, unread notification instead of
 * staying silenced by the old read mark.
 */
import { getToken } from './api';
import { getTokenClaims } from '../utils/jwt';

export type NotificationKind = 'followup' | 'cover';
export type Urgency = 'overdue' | 'today' | 'week' | 'later';

export type ChipTone = 'slate' | 'blue' | 'amber' | 'emerald' | 'red' | 'violet';

export interface AppNotification {
  key: string;
  kind: NotificationKind;
  /** The record the notification is about — shown bold, e.g. "Acme · Rohit". */
  subject: string;
  /** What is happening to it, e.g. "follow-up due" / "warranty ends for 4 products". */
  event: string;
  /** Plain-text version of subject + event, used for search. */
  title: string;
  detail: string;
  chips: { label: string; tone: ChipTone }[];
  date: string;        // YYYY-MM-DD the event falls on
  days: number;        // from today; negative = in the past
  urgency: Urgency;
  href: string;
  read: boolean;
}

/** How far ahead each source looks. Covers match the reminder email's 60 days. */
export const FOLLOWUP_AHEAD_DAYS = 7;
export const COVER_AHEAD_DAYS = 60;

const CACHE_KEY = 'notif-unread';
const CACHE_TTL_MS = 5 * 60 * 1000;
export const UNREAD_EVENT = 'notifications:unread';

function apiBase(): string {
  return import.meta.env.PUBLIC_API_BASE_URL ||
    `${window.location.protocol}//${window.location.hostname}:8082`;
}

function headers(): Record<string, string> {
  return { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

async function getRecords(table: string): Promise<any[]> {
  const res = await fetch(`${apiBase()}/proxy/${table}/records`, { headers: headers() });
  if (!res.ok) throw new Error(`${table}: ${res.status}`);
  const data = await res.json();
  return (data.records || []).map((r: any) => ({ id: r.id ?? r.Id, ...(r.fields || r) }));
}

const STATUS_TONE: Record<string, ChipTone> = {
  'New': 'blue', 'Contacted': 'violet', 'Qualified': 'emerald',
  'Proposal Sent': 'amber', 'Negotiation': 'amber',
};

const iso = (v: any) => (v ? String(v).slice(0, 10) : '');

function daysFromToday(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((then - today) / 86400000);
}

function urgencyOf(days: number): Urgency {
  return days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 7 ? 'week' : 'later';
}

/**
 * Lead follow-ups that are overdue or due within FOLLOWUP_AHEAD_DAYS, for leads
 * the user owns. Admins and managers can READ many more leads than they chase,
 * so ownership is checked here rather than trusting the proxy's scoping; admins
 * additionally get unassigned leads, since no rep will be chasing those.
 */
function followUps(leads: any[], me: string, admin: boolean): Omit<AppNotification, 'read'>[] {
  const out: Omit<AppNotification, 'read'>[] = [];
  for (const l of leads) {
    const date = iso(l['Next Follow-up']);
    if (!date) continue;
    if (l['Status'] === 'Converted' || l['Status'] === 'Lost') continue;

    const assigned = String(l['Assigned to'] || '').trim().toLowerCase();
    const creator = String(l['Lead Created By'] || '').trim().toLowerCase();
    const mine = assigned ? assigned === me : creator === me;
    const unowned = !assigned && !creator;
    if (!mine && !(admin && unowned)) continue;

    const days = daysFromToday(date);
    if (days > FOLLOWUP_AHEAD_DAYS) continue;

    const who = [l['Company'], l['Lead Name']].filter(Boolean).join(' · ') || `Lead #${l.id}`;
    const event = days < 0 ? 'follow-up overdue' : days === 0 ? 'follow-up today' : 'follow-up due';
    const chips: AppNotification['chips'] = [];
    if (l['Status']) chips.push({ label: String(l['Status']), tone: STATUS_TONE[l['Status']] || 'slate' });
    if (l['Source']) chips.push({ label: String(l['Source']), tone: 'slate' });
    if (unowned) chips.push({ label: 'Unassigned', tone: 'amber' });
    out.push({
      key: `lead:${l.id}:${date}`,
      kind: 'followup',
      subject: who,
      event,
      title: `${who} ${event}`,
      detail: l['Contact Person'] ? `Contact: ${l['Contact Person']}` : '',
      chips,
      date, days, urgency: urgencyOf(days),
      href: `/lead-detail?id=${l.id}`,
    });
  }
  return out;
}

/**
 * The date a product's renewal is counted down to — its own warranty end, even
 * when a later Yealink AMS date sits in End Date. Mirrors remindOn in
 * proxy/internal/reminders/reminders.go.
 */
function remindOn(a: any): string {
  const end = iso(a['End Date']);
  const inv = iso(a['Invoice End Date']);
  if (!inv) return end;
  return !end || inv < end ? inv : end;
}

/**
 * Warranty/AMC products ending within COVER_AHEAD_DAYS (or already ended), one
 * notification per invoice and date — the same grouping as the reminder email.
 */
function covers(parents: any[], assets: any[]): Omit<AppNotification, 'read'>[] {
  const byParent = new Map<number, any[]>();
  for (const a of assets) {
    const pid = Number(a['Warranty Id']);
    // A kit's Bundle row is its price; the kit's parts are what expire.
    if (!pid || a['Kind'] === 'Bundle') continue;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(a);
  }

  const out: Omit<AppNotification, 'read'>[] = [];
  for (const p of parents) {
    if (p['Status'] === 'Renewed') continue;
    const customer = p['Customer Name'] || p['Title'] || `Cover #${p.id}`;
    const type = p['Type'] === 'AMC' ? 'AMC' : 'Warranty';
    const mineAssets = byParent.get(Number(p.id)) || [];

    const groups = new Map<string, any[]>();
    if (mineAssets.length) {
      for (const a of mineAssets) {
        if (a['Status'] === 'Renewed' || a['Status'] === 'Replaced') continue;
        const d = remindOn(a);
        if (!d) continue;
        if (!groups.has(d)) groups.set(d, []);
        groups.get(d)!.push(a);
      }
    } else if (iso(p['Expiry Date'])) {
      groups.set(iso(p['Expiry Date']), []);
    }

    for (const [date, group] of groups) {
      const days = daysFromToday(date);
      if (days > COVER_AHEAD_DAYS) continue;
      const n = group.length;
      const what = n ? `${n} product${n === 1 ? '' : 's'}` : 'cover';
      const quoted = n > 0 && group.every((a) => a['Status'] === 'Renewal Quoted');
      const event = `${type === 'AMC' ? 'AMC' : 'warranty'} ${days < 0 ? 'ended' : 'ends'} for ${what}`;
      const models = [...new Set(group.map((a) => a['Model']).filter(Boolean))];
      const chips: AppNotification['chips'] = [{ label: type, tone: type === 'AMC' ? 'violet' : 'emerald' }];
      if (p['Invoice No']) chips.push({ label: `Inv ${p['Invoice No']}`, tone: 'slate' });
      chips.push(quoted
        ? { label: 'Renewal quoted', tone: 'blue' }
        : { label: days < 0 ? 'Not renewed' : 'Needs renewal quote', tone: days < 0 ? 'red' : 'amber' });
      out.push({
        key: `cover:${p.id}:${date}`,
        kind: 'cover',
        subject: customer,
        event,
        title: `${customer} ${event}`,
        detail: models.length ? models.slice(0, 4).join(', ') + (models.length > 4 ? ` +${models.length - 4} more` : '') : '',
        chips,
        date, days, urgency: urgencyOf(days),
        href: `/warranty-detail?id=${p.id}`,
      });
    }
  }
  return out;
}

async function readKeys(): Promise<Set<string>> {
  const res = await fetch(`${apiBase()}/api/notifications/read`, { headers: headers() });
  if (!res.ok) throw new Error(`read marks: ${res.status}`);
  const data = await res.json();
  return new Set<string>(data.keys || []);
}

/** Everything the signed-in user should see, soonest first. */
export async function loadNotifications(): Promise<AppNotification[]> {
  const claims = getTokenClaims();
  const me = String(claims?.email || localStorage.getItem('user_email') || '').toLowerCase();
  const admin = claims?.role === 'admin' || claims?.role === 'super_admin';

  // Warranty & AMC is admin-only today (its rows carry no owner yet), so only
  // admins are shown cover notifications — and only they fetch those tables.
  const [leads, parents, assets, read] = await Promise.all([
    getRecords('leads'),
    admin ? getRecords('warranty_reminders').catch(() => []) : Promise.resolve([]),
    admin ? getRecords('warranty_assets').catch(() => []) : Promise.resolve([]),
    readKeys().catch(() => new Set<string>()),
  ]);

  const list = [...followUps(leads, me, admin), ...covers(parents, assets)]
    .map((n) => ({ ...n, read: read.has(n.key) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  publishUnread(list.filter((n) => !n.read).length);
  return list;
}

export async function setRead(keys: string[], read: boolean): Promise<void> {
  for (let i = 0; i < keys.length; i += 500) {
    const res = await fetch(`${apiBase()}/api/notifications/read`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ keys: keys.slice(i, i + 500), read }),
    });
    if (!res.ok) throw new Error(`Could not save (${res.status})`);
  }
}

/** Updates the sidebar badge on this page and caches the count for the next. */
export function publishUnread(count: number): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ count, at: Date.now() }));
  } catch { /* storage unavailable — the badge just refetches next page */ }
  window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: count }));
}

/**
 * The unread count for the sidebar badge. Served from a 5-minute session cache
 * so moving between pages does not refetch every lead and product each time.
 */
export async function unreadCount(): Promise<number> {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.count;
  } catch { /* fall through to a fresh load */ }
  const list = await loadNotifications();
  return list.filter((n) => !n.read).length;
}
