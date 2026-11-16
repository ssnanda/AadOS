// Calendar view maths: ranges for month/week/day/agenda in the viewer's time zone and day-bucketing of occurrences.
// Pure; unit-tested (including DST days and multi-day events).
import { utcToZoned, zonedToUtc, validZone, type Occurrence } from './model.ts';

export type ViewKind = 'month' | 'week' | 'day' | 'agenda';
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (date: string) => { const [y, m, d] = date.split('-').map(Number); return { y, m, d }; };
export const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;

/** Calendar-date arithmetic (no time zone involved). */
export function addDays(date: string, n: number): string {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
const weekdayOf = (date: string) => { const { y, m, d } = parse(date); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

/** Today's date in a zone. */
export function todayIn(tz: string, now = Date.now()): string {
  const z = utcToZoned(now, validZone(tz) ? tz : 'UTC');
  return iso(z.y, z.mo, z.d);
}
/** Local calendar date and minutes-from-midnight of an instant in a zone. */
export function localParts(utcIso: string, tz: string) {
  const z = utcToZoned(Date.parse(utcIso), tz);
  return { date: iso(z.y, z.mo, z.d), minutes: z.h * 60 + z.mi };
}

/** Days shown by a view. Month = whole weeks covering the month; agenda = 30 days from the date. */
export function viewDays(kind: ViewKind, date: string, weekStart = 0): string[] {
  if (kind === 'day') return [date];
  if (kind === 'agenda') return Array.from({ length: 30 }, (_, i) => addDays(date, i));
  const back = (d: string) => addDays(d, -((weekdayOf(d) - weekStart + 7) % 7));
  if (kind === 'week') { const s = back(date); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
  const { y, m } = parse(date);
  const first = iso(y, m, 1), last = iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  const start = back(first), end = addDays(back(last), 6);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** UTC instants bounding the shown days in the viewer's zone (DST-safe: a day can be 23 or 25 hours). */
export function rangeUtc(days: string[], tz: string): { from: string; to: string } {
  const zone = validZone(tz) ? tz : 'UTC';
  const a = parse(days[0]), b = parse(addDays(days[days.length - 1], 1));
  return { from: new Date(zonedToUtc(a.y, a.m, a.d, 0, 0, 0, zone)).toISOString(), to: new Date(zonedToUtc(b.y, b.m, b.d, 0, 0, 0, zone)).toISOString() };
}

/** Previous/next anchor date for a view. */
export function shiftDate(kind: ViewKind, date: string, dir: 1 | -1): string {
  if (kind === 'day') return addDays(date, dir);
  if (kind === 'week') return addDays(date, 7 * dir);
  if (kind === 'agenda') return addDays(date, 30 * dir);
  const { y, m } = parse(date);
  const t = new Date(Date.UTC(y, m - 1 + dir, 1));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
}

export type DayItem = { key: string; eventId: string; occurrenceStart: string; title: string; allDay: boolean; start: string; end: string; minutes: number; part: 'single' | 'start' | 'middle' | 'end'; calendarId: string };

/**
 * Put each occurrence on every local day it touches. Timed events use the viewer's zone; all-day events use their
 * own dates (end exclusive). Multi-day events are marked start/middle/end. Sorted: all-day first, then by time.
 */
export function bucketByDay(occurrences: Occurrence[], days: string[], tz: string): Record<string, DayItem[]> {
  const zone = validZone(tz) ? tz : 'UTC';
  const out: Record<string, DayItem[]> = Object.fromEntries(days.map((d) => [d, []]));
  for (const o of occurrences) {
    let first: string, last: string, minutes = 0;
    if (o.allDay) { first = o.start; last = addDays(o.end > o.start ? o.end : addDays(o.start, 1), -1); }
    else {
      const s = localParts(o.start, zone); first = s.date; minutes = s.minutes;
      // An event ending exactly at midnight does not occupy the next day.
      const endMs = Math.max(Date.parse(o.end) - 1, Date.parse(o.start));
      last = localParts(new Date(endMs).toISOString(), zone).date;
    }
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (!(d in out)) continue;
      const part = first === last ? 'single' : d === first ? 'start' : d === last ? 'end' : 'middle';
      out[d].push({ key: `${o.id}:${o.occurrenceStart}:${d}`, eventId: o.id, occurrenceStart: o.occurrenceStart, title: o.title, allDay: o.allDay || part === 'middle', start: o.start, end: o.end, minutes: d === first ? minutes : 0, part, calendarId: o.calendarId });
    }
  }
  for (const d of days) out[d].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.minutes - b.minutes || a.title.localeCompare(b.title));
  return out;
}

/** Human summary of an RRULE line, e.g. "Weekly on Mon, Wed". '' when not recurring/unknown. */
export function describeRecurrence(lines: string[] | undefined): string {
  const line = (lines || []).find((l) => /^RRULE[:;]/i.test(l));
  if (!line) return '';
  const p = Object.fromEntries(line.replace(/^RRULE:/i, '').split(';').map((kv) => kv.split('=') as [string, string]));
  const every = Number(p.INTERVAL) > 1 ? Number(p.INTERVAL) : 0;
  const unit = ({ DAILY: ['Daily', 'days'], WEEKLY: ['Weekly', 'weeks'], MONTHLY: ['Monthly', 'months'], YEARLY: ['Yearly', 'years'] } as Record<string, string[]>)[String(p.FREQ).toUpperCase()];
  if (!unit) return 'Repeats';
  const names: Record<string, string> = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };
  const days = String(p.BYDAY || '').split(',').filter(Boolean).map((d) => names[d.replace(/^[+-]?\d+/, '').toUpperCase()] || d).join(', ');
  return `${every ? `Every ${every} ${unit[1]}` : unit[0]}${days ? ` on ${days}` : ''}${p.COUNT ? `, ${p.COUNT} times` : ''}${p.UNTIL ? `, until ${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}` : ''}`;
}
