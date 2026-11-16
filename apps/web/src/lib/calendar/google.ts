// Google Calendar (read-only, scope calendar.readonly) adapter. Mock-tested; needs owner re-consent to run live.
// Uses documented endpoints: calendarList.list and events.list with pageToken/syncToken (HTTP 410 => full resync).
import type { CalEvent, CalendarInfo } from './model.ts';

const BASE = 'https://www.googleapis.com/calendar/v3';
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Raw = Record<string, any>;

export class SyncTokenExpired extends Error { constructor() { super('Google sync token expired'); } }

async function getJson(fetchImpl: Fetch, url: string, token: string): Promise<Raw> {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 410) throw new SyncTokenExpired();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Google Calendar HTTP ${res.status}`);
  return body;
}

export const mapCalendar = (raw: Raw, accountId: string): CalendarInfo => ({
  id: `${accountId}:${raw.id}`, accountId, provider: 'google', providerCalendarId: String(raw.id), name: String(raw.summaryOverride || raw.summary || raw.id),
  timeZone: String(raw.timeZone || 'UTC'), primary: Boolean(raw.primary), color: String(raw.backgroundColor || '')
});

export async function listCalendars(fetchImpl: Fetch, token: string, accountId: string): Promise<CalendarInfo[]> {
  const out: CalendarInfo[] = [];
  let pageToken = '';
  do {
    const body = await getJson(fetchImpl, `${BASE}/users/me/calendarList?maxResults=250${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, token);
    for (const item of body.items || []) out.push(mapCalendar(item, accountId));
    pageToken = String(body.nextPageToken || '');
  } while (pageToken);
  return out;
}

const when = (value: Raw | undefined, fallbackZone: string) => value?.dateTime
  ? { iso: new Date(value.dateTime).toISOString(), allDay: false, zone: String(value.timeZone || fallbackZone) }
  : value?.date ? { iso: String(value.date), allDay: true, zone: 'UTC' } : null;

/** null when the event cannot be mapped (e.g. a deleted event without times). */
export function mapEvent(raw: Raw, calendar: CalendarInfo): CalEvent | null {
  const start = when(raw.start, calendar.timeZone), end = when(raw.end, calendar.timeZone);
  const status = raw.status === 'cancelled' ? 'cancelled' : raw.status === 'tentative' ? 'tentative' : 'confirmed';
  if (!start && status !== 'cancelled') return null;
  const orig = when(raw.originalStartTime, calendar.timeZone);
  return {
    id: `${calendar.accountId}:${raw.id}`, accountId: calendar.accountId, calendarId: calendar.id, provider: 'google', providerEventId: String(raw.id),
    title: String(raw.summary || '(no title)'), description: String(raw.description || ''), location: String(raw.location || ''),
    start: start?.iso || orig?.iso || '', end: end?.iso || start?.iso || '', allDay: start?.allDay ?? orig?.allDay ?? false, timeZone: start?.zone || calendar.timeZone, status,
    ...(Array.isArray(raw.recurrence) ? { recurrence: raw.recurrence.map(String) } : {}),
    ...(raw.recurringEventId ? { recurringEventId: String(raw.recurringEventId), originalStart: orig?.iso } : {})
  };
}

export type CalendarSync = { events: CalEvent[]; deletedIds: string[]; nextSyncToken: string; full: boolean };

/**
 * Incremental when `syncToken` is given; an expired token (410) transparently falls back to a full sync.
 * Cancelled instances of recurring events are kept (they hide that occurrence); other cancelled events are returned in deletedIds.
 */
export async function syncCalendar(fetchImpl: Fetch, token: string, calendar: CalendarInfo, syncToken = '', timeMinIso = ''): Promise<CalendarSync> {
  const run = async (tokenToUse: string): Promise<CalendarSync> => {
    const events: CalEvent[] = [], deletedIds: string[] = [];
    let pageToken = '', next = '';
    do {
      const q = new URLSearchParams({ maxResults: '250', showDeleted: 'true', singleEvents: 'false' });
      if (tokenToUse) q.set('syncToken', tokenToUse); else if (timeMinIso) q.set('timeMin', timeMinIso);
      if (pageToken) q.set('pageToken', pageToken);
      const body = await getJson(fetchImpl, `${BASE}/calendars/${encodeURIComponent(calendar.providerCalendarId)}/events?${q}`, token);
      for (const raw of body.items || []) {
        const ev = mapEvent(raw, calendar);
        if (raw.status === 'cancelled' && !raw.recurringEventId) deletedIds.push(`${calendar.accountId}:${raw.id}`);
        else if (ev) events.push(ev);
      }
      pageToken = String(body.nextPageToken || ''); next = String(body.nextSyncToken || next);
    } while (pageToken);
    return { events, deletedIds, nextSyncToken: next, full: !tokenToUse };
  };
  try { return await run(syncToken); }
  catch (cause) { if (cause instanceof SyncTokenExpired && syncToken) return run(''); throw cause; }
}
