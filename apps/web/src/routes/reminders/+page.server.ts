import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { actOnReminder, createReminder, effectiveAt, markAllRead, reminderLists, tick, type ReminderAction } from '$lib/server/reminders';
import { validZone, zonedToUtc } from '$lib/calendar/model';
import { isDate } from '$lib/calendar/view';
import { isTime } from '$lib/server/tasks';

export const load: PageServerLoad = async () => {
  const state = await readState();
  const lists = reminderLists(state.reminders);
  const tz = validZone(state.prefs.timeZone) ? state.prefs.timeZone : 'UTC';
  const slim = (r: (typeof state.reminders)[number]) => ({ id: r.id, title: r.title, at: effectiveAt(r), original: r.at, snoozed: Boolean(r.snoozedUntil), status: r.status, source: r.source.type, note: r.note || '', unread: r.status === 'fired' && !r.readAt, closedAt: r.closedAt || '', auto: Boolean(r.dedupeKey),
    link: r.source.type === 'task' ? '/tasks' : r.source.type === 'event' ? `/calendar?view=day&date=${r.source.occurrenceStart.slice(0, 10)}` : '' });
  return { notifyBrowser: state.notify.browser, active: lists.active.map(slim), upcoming: lists.upcoming.slice(0, 100).map(slim), history: lists.history.slice(0, 100).map(slim), unread: lists.unread, overdue: lists.overdue, tz, prefs: state.prefs };
};

/** Date + time typed by the owner (their zone) -> instant. */
function instant(date: string, time: string, tz: string): string | null {
  if (!isDate(date) || !isTime(time)) return null;
  const [y, m, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  return new Date(zonedToUtc(y, m, d, h, mi, 0, validZone(tz) ? tz : 'UTC')).toISOString();
}

export const actions: Actions = {
  create: async ({ request }) => {
    const f = await request.formData();
    const title = String(f.get('title') || '').trim().slice(0, 200);
    if (!title) return fail(400, { error: 'Enter what to be reminded about.' });
    let ok = true;
    await updateState((s) => {
      const at = instant(String(f.get('date') || ''), String(f.get('time') || ''), s.prefs.timeZone);
      if (!at) { ok = false; return; }
      createReminder(s, { title, at, note: String(f.get('note') || '').trim().slice(0, 500) });
      tick(s);
    });
    return ok ? { created: true } : fail(400, { error: 'Choose a valid date and time.' });
  },
  act: async ({ request }) => {
    const f = await request.formData();
    const id = String(f.get('id') || ''), op = String(f.get('op') || '');
    let action: ReminderAction | null = null;
    if (op === 'snooze') action = { op, minutes: Math.min(Math.max(Number(f.get('minutes')) || 10, 1), 7 * 24 * 60) };
    else if (op === 'dismiss' || op === 'done' || op === 'read' || op === 'delete') action = { op };
    if (!action) return fail(400, { error: 'Unknown action.' });
    let found = false;
    await updateState((s) => { found = actOnReminder(s, id, action!); if (found) tick(s); });
    return found ? { acted: id } : fail(404, { error: 'Reminder not found.' });
  },
  edit: async ({ request }) => {
    const f = await request.formData();
    const id = String(f.get('id') || ''), title = String(f.get('title') || '').trim().slice(0, 200);
    if (!title) return fail(400, { error: 'Enter what to be reminded about.' });
    let result: 'ok' | 'date' | 'missing' = 'ok';
    await updateState((s) => {
      const at = instant(String(f.get('date') || ''), String(f.get('time') || ''), s.prefs.timeZone);
      if (!at) { result = 'date'; return; }
      if (!actOnReminder(s, id, { op: 'edit', title, at, note: String(f.get('note') || '').trim().slice(0, 500) })) result = 'missing'; else tick(s);
    });
    return result === 'ok' ? { edited: id } : fail(result === 'date' ? 400 : 404, { error: result === 'date' ? 'Choose a valid date and time.' : 'Reminder not found.' });
  },
  readAll: async () => { await updateState((s) => { markAllRead(s); }); return { read: true }; }
};
