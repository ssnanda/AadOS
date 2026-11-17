// Creating, editing and deleting calendar events (Google calendar.events / Zoho ZohoCalendar.event.*).
// Request builders are pure and unit-tested (tests/calendar-write.test.ts). Zoho's write API is documented but
// unverified against a live account (same caveat as the Zoho reader).
import { zonedToUtc, type CalEvent, type CalendarInfo } from './model.ts';
import { zohoUid } from './zoho.ts';

/** What the event form sends: wall-clock date/time in the owner's zone. All-day end date is inclusive. */
export type EventInput = { title: string; description: string; location: string; allDay: boolean; startDate: string; startTime: string; endDate: string; endTime: string; timeZone: string };
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;
const addDay = (day: string, n = 1) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const utc = (day: string, time: string, tz: string) => { const [y, mo, d] = day.split('-').map(Number), [h, mi] = time.split(':').map(Number); return zonedToUtc(y, mo, d, h, mi, 0, tz); };

/** Validates the form and returns UTC instants (timed) or dates (all-day, end exclusive). */
export function normalize(i: EventInput): { start: string; end: string } {
  if (!i.title.trim()) throw new Error('Give the event a title.');
  if (!DATE.test(i.startDate) || !DATE.test(i.endDate || i.startDate)) throw new Error('Pick a start and end date.');
  const endDate = i.endDate || i.startDate;
  if (i.allDay) {
    if (endDate < i.startDate) throw new Error('The end date is before the start date.');
    return { start: i.startDate, end: addDay(endDate) };
  }
  if (!TIME.test(i.startTime) || !TIME.test(i.endTime)) throw new Error('Pick a start and end time.');
  const s = utc(i.startDate, i.startTime, i.timeZone), e = utc(endDate, i.endTime, i.timeZone);
  if (e <= s) throw new Error('The event must end after it starts.');
  return { start: new Date(s).toISOString(), end: new Date(e).toISOString() };
}

export function googleBody(i: EventInput) {
  const r = normalize(i);
  return {
    summary: i.title.trim(), description: i.description, location: i.location,
    start: i.allDay ? { date: r.start } : { dateTime: r.start, timeZone: i.timeZone },
    end: i.allDay ? { date: r.end } : { dateTime: r.end, timeZone: i.timeZone }
  };
}

const zStamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
/** Zoho `eventdata`: UTC yyyyMMdd'T'HHmmss'Z', or yyyyMMdd for all-day (end inclusive). */
export function zohoEventData(i: EventInput, etag?: string) {
  const r = normalize(i);
  return {
    title: i.title.trim(), description: i.description, location: i.location, isallday: i.allDay,
    dateandtime: i.allDay ? { timezone: i.timeZone, start: r.start.replace(/-/g, ''), end: addDay(r.end, -1).replace(/-/g, '') } : { timezone: i.timeZone, start: zStamp(r.start), end: zStamp(r.end) },
    ...(etag ? { etag } : {})
  };
}

async function ok(res: Response, label: string) {
  if (res.ok || res.status === 204) return res.status === 204 ? {} : res.json().catch(() => ({}));
  const body = await res.json().catch(() => ({}));
  throw new Error(body?.error?.message || body?.message || `${label} HTTP ${res.status}`);
}

const G = 'https://www.googleapis.com/calendar/v3';
export async function googleWrite(fetchImpl: Fetch, token: string, op: 'create' | 'update' | 'delete', calendar: CalendarInfo, event?: CalEvent, input?: EventInput) {
  const cal = encodeURIComponent(calendar.providerCalendarId);
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  // Edits to one occurrence of a repeating event apply to the whole series (the stored event is the series).
  const id = event ? encodeURIComponent(event.recurringEventId || event.providerEventId) : '';
  if (op === 'create') return ok(await fetchImpl(`${G}/calendars/${cal}/events`, { method: 'POST', headers, body: JSON.stringify(googleBody(input!)) }), 'Google Calendar');
  if (op === 'update') {
    // A repeating event keeps its schedule: only title, place and notes change (moving one date would move the series).
    const body: Record<string, unknown> = googleBody(input!);
    if (event?.recurrence?.length || event?.recurringEventId) { delete body.start; delete body.end; }
    return ok(await fetchImpl(`${G}/calendars/${cal}/events/${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), 'Google Calendar');
  }
  return ok(await fetchImpl(`${G}/calendars/${cal}/events/${id}`, { method: 'DELETE', headers }), 'Google Calendar');
}

export async function zohoWrite(fetchImpl: Fetch, dc: string, token: string, op: 'create' | 'update' | 'delete', calendar: CalendarInfo, event?: CalEvent, input?: EventInput) {
  const base = `https://calendar.zoho.${dc || 'com'}/api/v1/calendars/${zohoUid(calendar.providerCalendarId)}/events`;
  const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json' };
  const data = (etag?: string) => encodeURIComponent(JSON.stringify(zohoEventData(input!, etag)));
  if (op === 'create') return ok(await fetchImpl(`${base}?eventdata=${data()}`, { method: 'POST', headers }), 'Zoho Calendar');
  if (!event) throw new Error('Event not found.');
  const id = zohoUid(event.providerEventId);
  if (op === 'update') return ok(await fetchImpl(`${base}/${id}?eventdata=${data(event.etag)}`, { method: 'PUT', headers }), 'Zoho Calendar');
  return ok(await fetchImpl(`${base}/${id}`, { method: 'DELETE', headers: { ...headers, ...(event.etag ? { etag: event.etag } : {}) } }), 'Zoho Calendar');
}
