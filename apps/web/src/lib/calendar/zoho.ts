// Zoho Calendar (read-only) mapping. Field names follow the Zoho Calendar API v1 documentation
// (calendars list; events with dateandtime{start,end,timezone}, isallday, rrule) but have NOT been verified
// against a live account: needs the owner's re-consent (ZohoCalendar.calendar.READ / ZohoCalendar.event.READ).
import { findMeetingUrl, type CalEvent, type CalendarInfo } from './model.ts';

type Raw = Record<string, any>;

/** Zoho timestamps look like 20261102T140000Z, 20261102T090000-0500 or (all-day) 20261102. */
export function parseZohoTime(value: unknown): { iso: string; allDay: boolean } | null {
  const v = String(value || '').trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?$/);
  if (m) {
    const off = m[7] && m[7] !== 'Z' ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : 'Z';
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`);
    return Number.isNaN(t) ? null : { iso: new Date(t).toISOString(), allDay: false };
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : { iso: new Date(t).toISOString(), allDay: false };
}

export const mapZohoCalendar = (raw: Raw, accountId: string): CalendarInfo => ({
  id: `${accountId}:${raw.uid}`, accountId, provider: 'zoho', providerCalendarId: String(raw.uid), name: String(raw.name || raw.uid),
  timeZone: String(raw.timezone || 'UTC'), primary: Boolean(raw.isdefault ?? raw.default ?? false), color: String(raw.color || '')
});

export function mapZohoEvent(raw: Raw, calendar: CalendarInfo): CalEvent | null {
  const dt = raw.dateandtime || {};
  const start = parseZohoTime(dt.start), end = parseZohoTime(dt.end);
  if (!start) return null;
  const allDay = Boolean(raw.isallday) || start.allDay;
  const rrule: string[] = Array.isArray(raw.rrule) ? raw.rrule : raw.rrule ? [raw.rrule] : [];
  // Documented shape: organizer is an email string; attendees are { email, status }.
  const attendees = Array.isArray(raw.attendees) ? raw.attendees.filter((a: Raw) => a?.email).map((a: Raw) => ({ email: String(a.email), ...(a.status ? { status: String(a.status).toLowerCase() } : {}) })) : [];
  const meetingUrl = findMeetingUrl(raw.location, raw.description);
  return {
    id: `${calendar.accountId}:${raw.uid}`, accountId: calendar.accountId, calendarId: calendar.id, provider: 'zoho', providerEventId: String(raw.uid),
    title: String(raw.title || '(no title)'), description: String(raw.description || ''), location: String(raw.location || ''),
    start: start.iso, end: (end || start).iso, allDay, timeZone: String(dt.timezone || calendar.timeZone), status: raw.status === 'cancelled' ? 'cancelled' : 'confirmed',
    ...(raw.organizer ? { organizer: String(raw.organizer) } : {}), ...(attendees.length ? { attendees } : {}), ...(meetingUrl ? { meetingUrl } : {}),
    ...(raw.etag ? { etag: String(raw.etag) } : {}),
    ...(rrule.length ? { recurrence: rrule.map((r) => (/^RRULE:/i.test(r) ? r : `RRULE:${r}`)) } : {})
  };
}

// ---- fetch client (documented Zoho Calendar API v1; unverified against a live account) ----
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const calendarBase = (dc: string) => `https://calendar.zoho.${dc || 'com'}/api/v1`;
/** Zoho calendar uids end in base64 padding (`==`); Zoho answers 404 when it is percent-encoded, so `=` stays literal. */
export const zohoUid = (uid: string) => encodeURIComponent(uid).replace(/%3D/gi, '=');

async function getZoho(fetchImpl: Fetch, url: string, token: string): Promise<Raw> {
  const res = await fetchImpl(url, { headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json+large' } }); // +large: documented way to include event descriptions
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zoho Calendar HTTP ${res.status}${body?.message || body?.error ? `: ${body.message || body.error}` : ''} (${new URL(url).pathname.replace(/^\/api\/v1/, '')})`);
  return body;
}

/** My calendars plus Group calendars (e.g. a shared Conference Room). Zoho returns only "own" unless asked per
 *  category; a failing group lookup never hides the owner's own calendars. */
export async function listZohoCalendars(fetchImpl: Fetch, dc: string, token: string, accountId: string): Promise<CalendarInfo[]> {
  const own = await getZoho(fetchImpl, `${calendarBase(dc)}/calendars?category=own`, token);
  const group = await getZoho(fetchImpl, `${calendarBase(dc)}/calendars?category=group`, token).catch(() => ({ calendars: [] }));
  const seen = new Set<string>(), out: CalendarInfo[] = [];
  for (const c of [...(Array.isArray(own.calendars) ? own.calendars : []), ...(Array.isArray(group.calendars) ? group.calendars : [])]) {
    if (!c?.uid || seen.has(String(c.uid))) continue;
    seen.add(String(c.uid));
    const info = mapZohoCalendar(c, accountId);
    out.push(c.category === 'group' ? { ...info, name: `${info.name} (group)` } : info);
  }
  return out;
}

// Event ranges are sent as plain dates (yyyyMMdd), the form every Zoho Calendar example uses.
const stamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Events overlapping [from, to). Zoho limits a query range, so this walks 30-day windows. */
export async function fetchZohoEvents(fetchImpl: Fetch, dc: string, token: string, calendar: CalendarInfo, from: Date, to: Date): Promise<CalEvent[]> {
  const out = new Map<string, CalEvent>();
  for (let start = from.getTime(); start < to.getTime(); start += 30 * 86_400_000) {
    const end = Math.min(start + 30 * 86_400_000, to.getTime());
    const range = encodeURIComponent(JSON.stringify({ start: stamp(new Date(start)), end: stamp(new Date(end)) }));
    const body = await getZoho(fetchImpl, `${calendarBase(dc)}/calendars/${zohoUid(calendar.providerCalendarId)}/events?range=${range}`, token);
    for (const raw of Array.isArray(body.events) ? body.events : []) { const ev = mapZohoEvent(raw, calendar); if (ev) out.set(ev.id, ev); }
  }
  return [...out.values()];
}
