import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actOnReminder, createReminder, markAllRead, reminderLists, taskDueInstant, tick } from '../src/lib/server/reminders.ts';

const NOW = Date.parse('2026-11-16T15:00:00Z'); // 10:00 in New York
const prefs = { timeZone: 'America/New_York', eventLeadMinutes: 15, taskReminderTime: '09:00', weekStart: 0 } as any;
const task = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, due: '2026-11-16', done: false, createdAt: '', ...over }) as any;
const event = (id: string, start: string, over: Record<string, unknown> = {}) => ({ id, accountId: 'a', calendarId: 'c', provider: 'google', providerEventId: id, title: `Event ${id}`, description: '', location: '', start, end: new Date(Date.parse(start) + 3600_000).toISOString(), allDay: false, timeZone: 'UTC', status: 'confirmed', ...over }) as any;
const mk = (over: Record<string, unknown> = {}) => ({ reminders: [], tasks: [], events: [], prefs: { ...prefs }, calendarDisabled: [], ...over }) as any;

test('task due instant uses dueTime, else the default time, in the owner zone', () => {
  assert.equal(taskDueInstant(task('a', { dueTime: '17:30' }), prefs), '2026-11-16T22:30:00.000Z');
  assert.equal(taskDueInstant(task('a'), prefs), '2026-11-16T14:00:00.000Z');
  assert.equal(taskDueInstant(task('a', { due: '' }), prefs), null);
  assert.equal(taskDueInstant(task('a'), { ...prefs, taskReminderTime: '' }), null);
});

test('tick creates task + event reminders once, fires due ones, and is idempotent across restarts', () => {
  const s = mk({ tasks: [task('t1'), task('t2', { due: '2026-11-17', dueTime: '08:00' })], events: [event('e1', '2026-11-16T15:10:00Z'), event('e2', '2026-11-16T20:00:00Z'), event('far', '2026-11-25T20:00:00Z'), event('past', '2026-11-16T14:00:00Z'), event('ad', '2026-11-17T00:00:00Z', { allDay: true, start: '2026-11-17', end: '2026-11-18' })] });
  assert.equal(tick(s, NOW), true);
  const title = (st: string) => s.reminders.filter((r: any) => r.status === st).map((r: any) => r.title).sort();
  assert.deepEqual(title('fired'), ['Event e1', 'Task t1']);       // t1 was due 9:00; e1 starts in 10 min (< 15 min lead)
  assert.deepEqual(title('scheduled'), ['Event e2', 'Task t2']);   // far/past/all-day events get none
  const snapshot = JSON.stringify(s.reminders);
  assert.equal(tick(s, NOW), false);                               // same instant again: nothing changes
  assert.equal(tick(JSON.parse(JSON.stringify(s)), NOW + 1000), false); // "restart": reloaded state, no duplicates
  assert.equal(JSON.stringify(s.reminders), snapshot);
  tick(s, Date.parse('2026-11-16T19:46:00Z'));
  assert.deepEqual(title('fired'), ['Event e1', 'Event e2', 'Task t1']);
});

test('snooze, dismiss, done; dismissed automatic reminders are never recreated', () => {
  const s = mk({ tasks: [task('t1')], events: [event('e1', '2026-11-16T15:10:00Z')] });
  tick(s, NOW);
  const [t, e] = ['Task t1', 'Event e1'].map((n) => s.reminders.find((r: any) => r.title === n));
  actOnReminder(s, e.id, { op: 'snooze', minutes: 5 }, NOW);
  assert.equal(e.status, 'scheduled'); tick(s, NOW + 4 * 60_000); assert.equal(e.status, 'scheduled');
  tick(s, NOW + 5 * 60_000); assert.equal(e.status, 'fired'); assert.equal(e.readAt, undefined); // unread again after snooze
  actOnReminder(s, e.id, { op: 'dismiss' }, NOW + 6 * 60_000);
  tick(s, NOW + 7 * 60_000);
  assert.equal(s.reminders.filter((r: any) => r.source.type === 'event').length, 1); assert.equal(e.status, 'dismissed');
  actOnReminder(s, t.id, { op: 'done' }, NOW);
  assert.equal(s.tasks[0].done, true); assert.equal(t.status, 'done');
  assert.equal(actOnReminder(s, 'nope', { op: 'dismiss' }), false);
});

test('task changes: completing closes its reminder, deleting removes pending ones, re-dating re-keys', () => {
  const s = mk({ tasks: [task('a', { due: '2026-11-18' }), task('b', { due: '2026-11-18' }), task('c', { due: '2026-11-18' })] });
  tick(s, NOW); assert.equal(s.reminders.length, 3);
  s.tasks[0].done = true; s.tasks = s.tasks.filter((t: any) => t.id !== 'b'); s.tasks.find((t: any) => t.id === 'c').due = '2026-11-20';
  tick(s, NOW);
  const of = (id: string) => s.reminders.filter((r: any) => r.source.taskId === id);
  assert.equal(of('a')[0].status, 'done'); assert.equal(of('b').length, 0);
  assert.equal(of('c').length, 1); assert.equal(of('c')[0].at, '2026-11-20T14:00:00.000Z');
});

test('custom reminders, edit, lists, unread count, mark all read, history pruning', () => {
  const s = mk();
  const r = createReminder(s, { title: 'Call mom', at: '2026-11-16T14:30:00Z', note: 'birthday' }, NOW);
  createReminder(s, { title: 'Later', at: '2026-11-17T14:30:00Z' }, NOW);
  tick(s, NOW);
  let l = reminderLists(s.reminders, NOW);
  assert.deepEqual([l.active.length, l.upcoming.length, l.unread, l.overdue], [1, 1, 1, 0]);
  assert.equal(reminderLists(s.reminders, NOW + 2 * 3600_000).overdue, 1);
  markAllRead(s, NOW); assert.equal(reminderLists(s.reminders, NOW).unread, 0);
  actOnReminder(s, r.id, { op: 'edit', title: 'Call mom!', at: '2026-11-16T18:00:00Z' }, NOW);
  assert.equal(r.status, 'scheduled'); tick(s, NOW); assert.equal(r.status, 'scheduled');
  actOnReminder(s, r.id, { op: 'dismiss' }, NOW);
  assert.equal(reminderLists(s.reminders, NOW).history.length, 1);
  tick(s, NOW + 91 * 86_400_000);
  assert.ok(!s.reminders.some((x: any) => x.id === r.id)); // pruned after 90 days
  actOnReminder(s, s.reminders[0].id, { op: 'delete' }); assert.equal(s.reminders.length, 0);
});

test('disabled calendars and lead=null produce no event reminders; accounts stay isolated by event id', () => {
  const ev = [event('g:e', '2026-11-16T16:00:00Z', { calendarId: 'off' }), event('z:e', '2026-11-16T16:00:00Z', { accountId: 'z', calendarId: 'on' })];
  const s = mk({ events: ev, calendarDisabled: ['off'] }); tick(s, NOW);
  assert.deepEqual(s.reminders.map((r: any) => r.source.eventId), ['z:e']);
  const none = mk({ events: ev, prefs: { ...prefs, eventLeadMinutes: null } }); tick(none, NOW); assert.equal(none.reminders.length, 0);
});
