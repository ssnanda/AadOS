// Reminders engine. Pure and deterministic: all state lives in the (durable) application state, so a restart or a
// second process can run `tick` again without creating duplicates (every automatic reminder has a stable dedupeKey).
import type { Prefs, Task } from './aados-store';
import { agenda, zonedToUtc, validZone, type CalEvent } from '../calendar/model.ts';

export type ReminderSource = { type: 'custom' } | { type: 'task'; taskId: string } | { type: 'event'; eventId: string; occurrenceStart: string };
export type Reminder = {
  id: string; title: string;
  /** When it should fire (ISO instant). */ at: string;
  source: ReminderSource;
  /** scheduled -> fired (shown in the notification center) -> dismissed | done. Snoozing returns it to scheduled. */
  status: 'scheduled' | 'fired' | 'dismissed' | 'done';
  /** Stable identity of an automatic reminder; '' for manual ones. Never reused, so a dismissed one is not recreated. */
  dedupeKey: string;
  createdAt: string; firedAt?: string; snoozedUntil?: string; readAt?: string; closedAt?: string; note?: string;
};

type State = { reminders: Reminder[]; tasks: Task[]; events: CalEvent[]; prefs: Prefs; calendarDisabled?: string[] };
const HISTORY_DAYS = 90;
const EVENT_HORIZON_MS = 2 * 86_400_000;
let seq = 0;
const newId = (now: number) => `r${now.toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const effectiveAt = (r: Reminder) => r.snoozedUntil || r.at;

/** Instant a task is due: its date + dueTime (or the default reminder time) in the owner's zone. null = no reminder. */
export function taskDueInstant(task: Pick<Task, 'due' | 'dueTime'>, prefs: Prefs): string | null {
  if (!task.due) return null;
  const time = task.dueTime || prefs.taskReminderTime;
  if (!/^\d{2}:\d{2}$/.test(time || '')) return null;
  const [y, m, d] = task.due.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  return new Date(zonedToUtc(y, m, d, h, mi, 0, validZone(prefs.timeZone) ? prefs.timeZone : 'UTC')).toISOString();
}

/**
 * One scheduler pass. Idempotent. Returns true when anything changed (so the caller knows whether to persist).
 *  1. task reminders: one per open task with a due instant (re-keyed when the due date/time changes);
 *     reminders of completed/deleted tasks are closed/removed;
 *  2. event reminders: `prefs.eventLeadMinutes` before each upcoming occurrence in the next two days;
 *  3. scheduled reminders whose time has come are fired (they stay fired until snoozed/dismissed/completed);
 *  4. closed history older than 90 days is pruned.
 */
export function tick(state: State, nowMs = Date.now()): boolean {
  let changed = false;
  const nowIso = new Date(nowMs).toISOString();
  const keys = new Set(state.reminders.map((r) => r.dedupeKey).filter(Boolean));
  const add = (title: string, at: string, source: ReminderSource, dedupeKey: string) => {
    if (keys.has(dedupeKey)) return;
    state.reminders.push({ id: newId(nowMs), title, at, source, status: 'scheduled', dedupeKey, createdAt: nowIso });
    keys.add(dedupeKey); changed = true;
  };

  // 1. tasks
  const tasks = new Map(state.tasks.map((t) => [t.id, t]));
  for (const task of state.tasks) {
    if (task.done) continue;
    const at = taskDueInstant(task, state.prefs);
    if (at) add(task.title, at, { type: 'task', taskId: task.id }, `task:${task.id}:${at}`);
  }
  const before = state.reminders.length;
  state.reminders = state.reminders.filter((r) => {
    if (r.source.type !== 'task') return true;
    const task = tasks.get(r.source.taskId);
    if (!task) return r.status !== 'scheduled' && r.status !== 'fired'; // deleted task: drop pending, keep history
    if (r.status === 'scheduled' && !r.snoozedUntil) { const at = taskDueInstant(task, state.prefs); if (!task.done && r.dedupeKey !== `task:${task.id}:${at}`) return false; } // due date/time changed
    return true;
  });
  if (state.reminders.length !== before) changed = true;
  for (const r of state.reminders) {
    if (r.source.type === 'task' && (r.status === 'scheduled' || r.status === 'fired') && tasks.get(r.source.taskId)?.done) { r.status = 'done'; r.closedAt = nowIso; changed = true; }
    if (r.source.type === 'task' && r.status !== 'done' && r.status !== 'dismissed') { const t = tasks.get(r.source.taskId); if (t && r.title !== t.title) { r.title = t.title; changed = true; } }
  }

  // 2. calendar events
  const lead = state.prefs.eventLeadMinutes;
  if (lead !== null && lead >= 0) {
    const disabled = new Set(state.calendarDisabled || []);
    const upcoming = agenda(state.events.filter((e) => !disabled.has(e.calendarId)), nowIso, new Date(nowMs + EVENT_HORIZON_MS).toISOString());
    for (const o of upcoming) {
      if (o.allDay) continue; // all-day events have no meaningful lead time
      const startMs = Date.parse(o.start);
      if (startMs <= nowMs) continue; // already started
      add(o.title, new Date(startMs - lead * 60_000).toISOString(), { type: 'event', eventId: o.id, occurrenceStart: o.occurrenceStart }, `event:${o.id}:${o.occurrenceStart}:${lead}`);
    }
  }

  // 3. fire
  for (const r of state.reminders) {
    if (r.status === 'scheduled' && Date.parse(effectiveAt(r)) <= nowMs) { r.status = 'fired'; r.firedAt = nowIso; delete r.readAt; changed = true; }
  }

  // 4. prune old history (keys of pruned automatic reminders refer to past instants, so they cannot be recreated)
  const cutoff = nowMs - HISTORY_DAYS * 86_400_000;
  const kept = state.reminders.filter((r) => !((r.status === 'dismissed' || r.status === 'done') && Date.parse(r.closedAt || r.firedAt || r.at) < cutoff));
  if (kept.length !== state.reminders.length) { state.reminders = kept; changed = true; }
  return changed;
}

export function createReminder(state: State, input: { title: string; at: string; note?: string; source?: ReminderSource }, nowMs = Date.now()): Reminder {
  const r: Reminder = { id: newId(nowMs), title: input.title, at: input.at, source: input.source || { type: 'custom' }, status: 'scheduled', dedupeKey: '', createdAt: new Date(nowMs).toISOString(), ...(input.note ? { note: input.note } : {}) };
  state.reminders.push(r);
  return r;
}

export type ReminderAction = { op: 'snooze'; minutes: number } | { op: 'dismiss' } | { op: 'done' } | { op: 'read' } | { op: 'delete' } | { op: 'edit'; title: string; at: string; note?: string };

/** Apply a user action. Completing a task reminder also completes the task. Returns false if the reminder is unknown. */
export function actOnReminder(state: State, id: string, action: ReminderAction, nowMs = Date.now()): boolean {
  const r = state.reminders.find((x) => x.id === id);
  if (!r) return false;
  const nowIso = new Date(nowMs).toISOString();
  if (action.op === 'snooze') { r.status = 'scheduled'; r.snoozedUntil = new Date(nowMs + Math.max(1, action.minutes) * 60_000).toISOString(); r.readAt = nowIso; }
  else if (action.op === 'dismiss') { r.status = 'dismissed'; r.closedAt = nowIso; r.readAt ||= nowIso; }
  else if (action.op === 'done') {
    r.status = 'done'; r.closedAt = nowIso; r.readAt ||= nowIso;
    if (r.source.type === 'task') { const id2 = r.source.taskId; const t = state.tasks.find((x) => x.id === id2); if (t && !t.done) { t.done = true; t.completedAt = nowIso; } }
  }
  else if (action.op === 'read') r.readAt ||= nowIso;
  else if (action.op === 'delete') state.reminders = state.reminders.filter((x) => x.id !== id);
  else if (action.op === 'edit') { r.title = action.title; r.at = action.at; r.note = action.note || undefined; delete r.snoozedUntil; if (r.status !== 'scheduled') { r.status = 'scheduled'; delete r.firedAt; delete r.closedAt; } }
  return true;
}

export const markAllRead = (state: State, nowMs = Date.now()) => { const iso = new Date(nowMs).toISOString(); for (const r of state.reminders) if (r.status === 'fired' && !r.readAt) r.readAt = iso; };

/** Lists for the notification center. `active` = fired and waiting for the owner (overdue ones included). */
export function reminderLists(reminders: Reminder[], nowMs = Date.now()) {
  const by = (f: (r: Reminder) => string, dir = 1) => (a: Reminder, b: Reminder) => dir * f(a).localeCompare(f(b));
  const active = reminders.filter((r) => r.status === 'fired').sort(by(effectiveAt, -1));
  return {
    active,
    upcoming: reminders.filter((r) => r.status === 'scheduled').sort(by(effectiveAt)),
    history: reminders.filter((r) => r.status === 'dismissed' || r.status === 'done').sort(by((r) => r.closedAt || r.at, -1)),
    unread: active.filter((r) => !r.readAt).length,
    /** Fired more than an hour ago and still not handled. */
    overdue: active.filter((r) => nowMs - Date.parse(effectiveAt(r)) > 3600_000).length
  };
}
