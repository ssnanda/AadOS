// Zoho Calendar (read-only) mapping. Field names follow the Zoho Calendar API v1 documentation
// (calendars list; events with dateandtime{start,end,timezone}, isallday, rrule) but have NOT been verified
// against a live account: needs the owner's re-consent (ZohoCalendar.calendar.READ / ZohoCalendar.event.READ).
import type { CalEvent, CalendarInfo } from './model.ts';

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
  return {
    id: `${calendar.accountId}:${raw.uid}`, accountId: calendar.accountId, calendarId: calendar.id, provider: 'zoho', providerEventId: String(raw.uid),
    title: String(raw.title || '(no title)'), description: String(raw.description || ''), location: String(raw.location || ''),
    start: start.iso, end: (end || start).iso, allDay, timeZone: String(dt.timezone || calendar.timeZone), status: raw.status === 'cancelled' ? 'cancelled' : 'confirmed',
    ...(rrule.length ? { recurrence: rrule.map((r) => (/^RRULE:/i.test(r) ? r : `RRULE:${r}`)) } : {})
  };
}
