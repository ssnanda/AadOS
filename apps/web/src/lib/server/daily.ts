// Calendar part of the daily dashboard. Pure; real data only (empty lists when nothing is synced).
import { agenda, type CalEvent, type Occurrence } from '../calendar/model.ts';
import { addDays, bucketByDay, rangeUtc, todayIn } from '../calendar/view.ts';

export type DailyCalendar = {
  today: string;
  todayEvents: Occurrence[];
  /** The next timed event that has not started yet (today or later this week). */
  next: Occurrence | null;
  /** Next seven days (including today): date and how many events touch it. */
  week: { date: string; count: number }[];
  weekTotal: number;
};

export function dailyCalendar(events: CalEvent[], tz: string, nowMs = Date.now(), disabledCalendars: string[] = []): DailyCalendar {
  const today = todayIn(tz, nowMs);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const { from, to } = rangeUtc(days, tz);
  const off = new Set(disabledCalendars);
  const occurrences = agenda(events.filter((e) => !off.has(e.calendarId)), from, to);
  const buckets = bucketByDay(occurrences, days, tz);
  const ids = new Set(buckets[today].map((i) => `${i.eventId}:${i.occurrenceStart}`));
  return {
    today,
    todayEvents: occurrences.filter((o) => ids.has(`${o.id}:${o.occurrenceStart}`)),
    next: occurrences.find((o) => !o.allDay && Date.parse(o.start) > nowMs) || null,
    week: days.map((date) => ({ date, count: buckets[date].length })),
    weekTotal: occurrences.length
  };
}
