// Pure merge helpers for calendar sync results. Unit-tested.
import type { CalEvent } from './model.ts';
import type { CalendarSync } from './google.ts';

/** Apply one Google sync result: full => replace the calendar's events; incremental => upsert + delete. */
export function mergeGoogle(events: CalEvent[], calendarId: string, sync: CalendarSync): CalEvent[] {
  const deleted = new Set(sync.deletedIds);
  const incoming = new Map(sync.events.map((e) => [e.id, e]));
  const kept = events.filter((e) => !(sync.full && e.calendarId === calendarId) && !deleted.has(e.id) && !incoming.has(e.id));
  return [...kept, ...sync.events];
}

/** Replace every event of one calendar (used for providers without sync tokens). */
export const replaceCalendarEvents = (events: CalEvent[], calendarId: string, fresh: CalEvent[]): CalEvent[] =>
  [...events.filter((e) => e.calendarId !== calendarId), ...fresh];

/** Drop calendars (and their events/sync tokens) of an account that are no longer listed upstream. */
export function pruneAccount<C extends { id: string; accountId: string }>(calendars: C[], events: CalEvent[], tokens: Record<string, string>, accountId: string, keep: Set<string>) {
  const gone = new Set(calendars.filter((c) => c.accountId === accountId && !keep.has(c.id)).map((c) => c.id));
  return {
    calendars: calendars.filter((c) => !gone.has(c.id)),
    events: events.filter((e) => !gone.has(e.calendarId)),
    tokens: Object.fromEntries(Object.entries(tokens).filter(([id]) => !gone.has(id)))
  };
}
