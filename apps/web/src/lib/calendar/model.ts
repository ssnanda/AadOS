// Read-only calendar domain: types, time-zone helpers, recurrence expansion and the unified agenda.
// Pure (no framework imports) so it is unit-tested with `node --test`.

export type Provider = 'google' | 'zoho';
export type CalendarInfo = { id: string; accountId: string; provider: Provider; providerCalendarId: string; name: string; timeZone: string; primary: boolean; color: string };
export type CalEvent = {
  id: string; accountId: string; calendarId: string; provider: Provider; providerEventId: string;
  title: string; description: string; location: string;
  /** Timed events: ISO UTC instants. All-day events: YYYY-MM-DD (end exclusive). */
  start: string; end: string; allDay: boolean; timeZone: string; status: 'confirmed' | 'tentative' | 'cancelled';
  /** RFC 5545 lines (RRULE / EXDATE) for a recurring master. */
  recurrence?: string[];
  /** Set on an edited/cancelled single instance of a recurring event. */
  recurringEventId?: string; originalStart?: string;
};
export type Occurrence = CalEvent & { occurrenceStart: string };

const DAY = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---------- time zones ----------
const fmt = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); fmt.set(tz, f); }
  return f;
}
export const validZone = (tz: string) => { try { formatter(tz); return true; } catch { return false; } };

/** Offset (ms) of `tz` from UTC at the instant `utcMs`. */
export function zoneOffset(utcMs: number, tz: string): number {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(utcMs)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}
/** Wall-clock time in `tz` -> UTC ms (gaps move forward, overlaps take the first occurrence). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wall - zoneOffset(wall, tz);
  const adjusted = wall - zoneOffset(guess, tz);
  if (adjusted !== guess) guess = adjusted;
  return guess;
}
/** UTC ms -> wall-clock parts in `tz`. */
export function utcToZoned(utcMs: number, tz: string) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(utcMs)).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

// ---------- RRULE ----------
type Rule = { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'; interval: number; count: number; until: string; byDay: { n: number; day: number }[]; byMonthDay: number[]; byMonth: number[] };
export function parseRule(lines: string[] | undefined): Rule | null {
  const line = (lines || []).find((l) => /^RRULE[:;]/i.test(l));
  if (!line) return null;
  const parts = Object.fromEntries(line.replace(/^RRULE:/i, '').split(';').map((kv) => kv.split('=') as [string, string]));
  const freq = String(parts.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null; // unsupported (HOURLY etc.): treated as non-recurring
  const byDay = String(parts.BYDAY || '').split(',').filter(Boolean).map((v) => { const m = v.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i); return m ? { n: m[1] ? Number(m[1]) : 0, day: WEEKDAYS.indexOf(m[2].toUpperCase()) } : null; }).filter((v): v is { n: number; day: number } => Boolean(v));
  const nums = (v?: string) => String(v || '').split(',').filter(Boolean).map(Number).filter((n) => Number.isInteger(n));
  return { freq: freq as Rule['freq'], interval: Math.max(1, Number(parts.INTERVAL) || 1), count: Number(parts.COUNT) || 0, until: String(parts.UNTIL || ''), byDay, byMonthDay: nums(parts.BYMONTHDAY), byMonth: nums(parts.BYMONTH) };
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (y: number, mo: number, d: number) => `${y}-${pad(mo)}-${pad(d)}`;
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const weekday = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
const dayNumber = (y: number, mo: number, d: number) => Math.floor(Date.UTC(y, mo - 1, d) / DAY);

/** Nth (1-based, negative from end) given weekday in the month, or 0 when it does not exist. */
function nthWeekday(y: number, mo: number, day: number, n: number): number {
  const dim = daysInMonth(y, mo);
  const days = Array.from({ length: dim }, (_, i) => i + 1).filter((d) => weekday(y, mo, d) === day);
  const pick = n > 0 ? days[n - 1] : days[days.length + n];
  return pick || 0;
}

function parseUntil(until: string, tz: string): number {
  const m = until.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!m) return Infinity;
  if (m[4]) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return zonedToUtc(+m[1], +m[2], +m[3], 23, 59, 59, tz);
}

function excluded(lines: string[] | undefined, tz: string): Set<number> {
  const out = new Set<number>();
  for (const line of lines || []) {
    const m = line.match(/^EXDATE(?:;([^:]*))?:(.+)$/i);
    if (!m) continue;
    const zone = m[1]?.match(/TZID=([^;:]+)/i)?.[1] || tz;
    for (const v of m[2].split(',')) {
      const t = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
      if (!t) continue;
      out.add(t[7] ? Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +t[6]) : zonedToUtc(+t[1], +t[2], +t[3], +(t[4] || 0), +(t[5] || 0), +(t[6] || 0), zone));
    }
  }
  return out;
}

/** Occurrences of one event overlapping [from, to) (UTC ms). Single events return themselves. */
export function expandEvent(ev: CalEvent, from: number, to: number, limit = 1000): Occurrence[] {
  if (ev.status === 'cancelled') return [];
  const tz = validZone(ev.timeZone) ? ev.timeZone : 'UTC';
  const startMs = ev.allDay ? Date.parse(`${ev.start}T00:00:00Z`) : Date.parse(ev.start);
  const endMs = ev.allDay ? Date.parse(`${ev.end}T00:00:00Z`) : Date.parse(ev.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return [];
  const span = Math.max(endMs - startMs, 0);
  const rule = parseRule(ev.recurrence);
  const make = (occStart: number): Occurrence => {
    const s = ev.allDay ? new Date(occStart).toISOString().slice(0, 10) : new Date(occStart).toISOString();
    const e = ev.allDay ? new Date(occStart + span).toISOString().slice(0, 10) : new Date(occStart + span).toISOString();
    return { ...ev, start: s, end: e, occurrenceStart: s };
  };
  const overlaps = (s: number) => s < to && s + Math.max(span, 1) > from;
  if (!rule) return overlaps(startMs) ? [make(startMs)] : [];

  // Walk in wall-clock time of the event's zone so "9am every Monday" stays 9am across DST.
  const local = ev.allDay ? { ...utcToZoned(startMs, 'UTC'), h: 0, mi: 0, s: 0 } : utcToZoned(startMs, tz);
  const toUtc = (y: number, mo: number, d: number) => ev.allDay ? Date.UTC(y, mo - 1, d) : zonedToUtc(y, mo, d, local.h, local.mi, local.s, tz);
  const until = parseUntil(rule.until, ev.allDay ? 'UTC' : tz);
  const skip = excluded(ev.recurrence, tz);
  const out: Occurrence[] = [];
  let produced = 0;
  const startDay = dayNumber(local.y, local.mo, local.d);
  const mondayOf = (dn: number) => dn - ((new Date(dn * DAY).getUTCDay() + 6) % 7);

  const emit = (y: number, mo: number, d: number): boolean => {
    const s = toUtc(y, mo, d);
    if (s < startMs) return true;            // before the first instance
    if (s > until) return false;
    produced++;
    if (rule.count && produced > rule.count) return false;
    if (s >= to) return false;
    if (!skip.has(s) && overlaps(s)) out.push(make(s));
    return out.length < limit;
  };

  if (rule.freq === 'DAILY') {
    for (let i = 0, dn = startDay; i < 50_000; i++, dn += rule.interval) { const t = new Date(dn * DAY); if (!emit(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())) break; }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length ? rule.byDay.map((b) => b.day) : [weekday(local.y, local.mo, local.d)];
    const weekZero = mondayOf(startDay);
    for (let dn = startDay, i = 0; i < 100_000; dn++, i++) {
      const t = new Date(dn * DAY);
      if (((mondayOf(dn) - weekZero) / 7) % rule.interval !== 0 || !days.includes(t.getUTCDay())) continue;
      if (!emit(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())) break;
    }
  } else {
    // MONTHLY / YEARLY: step by months/years, then pick days within each period.
    const step = rule.freq === 'MONTHLY' ? rule.interval : 12 * rule.interval;
    for (let i = 0; i < 5000; i++) {
      const total = local.y * 12 + (local.mo - 1) + i * step;
      const y = Math.floor(total / 12), mo = (total % 12) + 1;
      const months = rule.freq === 'YEARLY' && rule.byMonth.length ? rule.byMonth : [mo];
      const days: number[] = [];
      for (const m of months) {
        if (rule.freq === 'MONTHLY' && m !== mo) continue;
        const dim = daysInMonth(y, m);
        let picks: number[];
        if (rule.byDay.length) picks = rule.byDay.map((b) => b.n ? nthWeekday(y, m, b.day, b.n) : 0).filter(Boolean);
        else if (rule.byMonthDay.length) picks = rule.byMonthDay.map((d) => d < 0 ? dim + 1 + d : d).filter((d) => d >= 1 && d <= dim);
        else picks = local.d <= dim ? [local.d] : []; // e.g. the 31st skips short months, Feb 29 skips non-leap years
        for (const d of picks.sort((a, b) => a - b)) days.push(m * 100 + d);
      }
      let stop = false;
      for (const md of days) { if (!emit(y, Math.floor(md / 100), md % 100)) { stop = true; break; } }
      if (stop || Date.UTC(y, mo - 1, 1) > to + 32 * DAY) break;
    }
  }
  return out;
}

/** Unified agenda across accounts/providers: expands recurrences, applies edited/cancelled instances, sorts by start. */
export function agenda(events: CalEvent[], fromIso: string, toIso: string, opts: { calendarIds?: string[]; accountId?: string } = {}): Occurrence[] {
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  const scoped = events.filter((e) => (!opts.calendarIds || opts.calendarIds.includes(e.calendarId)) && (!opts.accountId || e.accountId === opts.accountId));
  const overridden = new Set(scoped.filter((e) => e.recurringEventId && e.originalStart).map((e) => `${e.accountId}:${e.recurringEventId}:${Date.parse(e.originalStart!)}`));
  const out: Occurrence[] = [];
  for (const ev of scoped) {
    for (const occ of expandEvent(ev, from, to)) {
      if (!ev.recurringEventId && ev.recurrence && overridden.has(`${ev.accountId}:${ev.providerEventId}:${Date.parse(occ.occurrenceStart)}`)) continue;
      out.push(occ);
    }
  }
  // Dedupe the same provider event listed in two calendars of one account.
  const seen = new Set<string>();
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)).filter((o) => { const k = `${o.accountId}:${o.providerEventId}:${o.occurrenceStart}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
