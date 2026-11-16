import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, filterTasks, taskCounts, overview, addDays, isIsoDate } from '../src/lib/server/tasks.ts';
import { buildRows } from '../src/lib/server/inbox.ts';

const today = '2026-11-16';
const t = (id: string, over: Record<string, unknown> = {}) => ({ id, title: id, due: '', done: false, createdAt: `2026-11-0${id.length}T00:00:00Z`, ...over }) as any;
const tasks = [t('a', { due: '2026-11-10' }), t('b', { due: today, priority: 'low' }), t('c', { due: today, priority: 'high' }), t('d', { due: '2026-11-30' }), t('e'), t('f', { done: true, due: '2026-11-01' })];

test('buckets and counts', () => {
  assert.deepEqual(tasks.map((x) => bucketOf(x, today)), ['overdue', 'today', 'today', 'upcoming', 'nodate', 'done']);
  assert.deepEqual(taskCounts(tasks, today), { open: 5, today: 2, overdue: 1, upcoming: 1, nodate: 1, done: 1, all: 6 });
});
test('filter + sort: open before done, priority breaks ties, undated last', () => {
  assert.deepEqual(filterTasks(tasks, 'open', 'due', today).map((x) => x.id), ['a', 'c', 'b', 'd', 'e']);
  assert.deepEqual(filterTasks(tasks, 'today', 'priority', today).map((x) => x.id), ['c', 'b']);
  assert.deepEqual(filterTasks(tasks, 'all', 'due', today).map((x) => x.id).slice(-1), ['f']);
  assert.deepEqual(filterTasks(tasks, 'overdue', 'due', today).map((x) => x.id), ['a']);
});
test('date helpers', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(isIsoDate('2026-02-31'), false);
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('nope'), false);
});

const acct = { id: 'g', provider: 'gmail' as const, email: 'a@x.com', remoteId: '', accessToken: '', refreshToken: '', expiresAt: 0, folders: [], lastError: 'boom' };
const pipe = { id: 'inbox-g', name: 'Inbox', source: 'gmail' as const, accountId: 'g', folderId: 'INBOX', folderName: 'Inbox', folders: [], parser: 'generic' as const, enabled: true, cursor: 0, lastSync: '', lastError: '', system: true };
const item = (id: string, subject: string, over: Record<string, unknown> = {}) => ({ id: `inbox-g:${id}`, pipelineId: 'inbox-g', messageId: id, subject, sender: 'Bank <billing@bank.com>', receivedAt: '2026-11-15T10:00:00Z', summary: '', kind: 'other', stage: 'new' as const, facts: {}, unread: true, ...over });

test('overview uses real data only and surfaces connection errors', () => {
  const empty = overview({ rows: [], tasks: [], accounts: [], today });
  assert.deepEqual([empty.important, empty.needsReply, empty.billsRenewals, empty.upcoming, empty.tasksToday, empty.errors], [[], [], [], [], [], []]);
  const rows = buildRows({ pipelines: [pipe], accounts: [acct], items: [item('1', 'Your statement is ready, amount due Nov 30'), item('2', 'Urgent: action required'), item('3', 'Can you reply?', { sender: 'Sam <sam@y.com>' })], now: new Date('2026-11-16T12:00:00Z') });
  const o = overview({ rows, tasks, accounts: [acct], today });
  assert.equal(o.counts.billsRenewals, 1); assert.ok(o.counts.important >= 1); assert.equal(o.counts.needsReply, 1);
  assert.equal(o.upcoming[0]?.due, '2026-11-30');
  assert.equal(o.tasksToday.length, 2); assert.equal(o.tasksOverdue.length, 1);
  assert.deepEqual(o.errors, [{ id: 'g', label: 'Gmail · a@x.com', message: 'boom' }]);
});

import { findDuplicate, parseTags, allTags, isTime } from '../src/lib/server/tasks.ts';
import { dailyCalendar } from '../src/lib/server/daily.ts';

test('task search, tag filter, due-time ordering', () => {
  const list = [t('a', { title: 'Pay electric bill', due: today, dueTime: '17:00', tags: ['money'] }), t('b', { title: 'Call dentist', due: today, dueTime: '09:00', notes: 'about the bill' }), t('c', { title: 'Groceries', tags: ['home'] })];
  assert.deepEqual(filterTasks(list, 'open', 'due', today, { q: 'bill' }).map((x) => x.id), ['b', 'a']); // notes are searched; earlier time first
  assert.deepEqual(filterTasks(list, 'open', 'due', today, { tag: 'home' }).map((x) => x.id), ['c']);
  assert.deepEqual(filterTasks(list, 'open', 'due', today, { q: 'bill money' }).map((x) => x.id), ['a']);
  assert.deepEqual(allTags(list), ['home', 'money']);
});

test('duplicate prevention: same title+due, or same linked email/event; done tasks do not block', () => {
  const list = [t('a', { title: 'Pay  Bill', due: today }), t('b', { title: 'X', emailKey: 'g:m1' }), t('c', { title: 'Old', due: today, done: true })];
  assert.equal(findDuplicate(list, { title: 'pay bill', due: today })?.id, 'a');
  assert.equal(findDuplicate(list, { title: 'pay bill', due: '2026-12-01' }), undefined);
  assert.equal(findDuplicate(list, { title: 'anything', emailKey: 'g:m1' })?.id, 'b');
  assert.equal(findDuplicate(list, { title: 'Old', due: today }), undefined);
  assert.equal(findDuplicate(list, { title: 'pay bill', due: today }, 'a'), undefined); // editing itself
  assert.deepEqual(parseTags(' Home, money ,home,, '), ['home', 'money']);
  assert.equal(isTime('09:30'), true); assert.equal(isTime('24:00'), false);
});

test('daily calendar: today, next appointment, 7-day counts; empty when nothing is synced', () => {
  const NY = 'America/New_York', now = Date.parse('2026-11-16T15:00:00Z');
  const e = (id: string, start: string, over: Record<string, unknown> = {}) => ({ id, accountId: 'a', calendarId: 'c', provider: 'google', providerEventId: id, title: id, description: '', location: '', start, end: new Date(Date.parse(start) + 3600_000).toISOString(), allDay: false, timeZone: NY, status: 'confirmed', ...over }) as any;
  const empty = dailyCalendar([], NY, now);
  assert.deepEqual([empty.todayEvents.length, empty.next, empty.weekTotal], [0, null, 0]); assert.equal(empty.week.length, 7); assert.equal(empty.today, '2026-11-16');
  const d = dailyCalendar([e('earlier', '2026-11-16T13:00:00Z'), e('soon', '2026-11-16T17:00:00Z'), e('tomorrow', '2026-11-17T17:00:00Z'), e('hidden', '2026-11-16T18:00:00Z', { calendarId: 'off' }), e('later', '2026-12-25T17:00:00Z')], NY, now, ['off']);
  assert.deepEqual(d.todayEvents.map((o) => o.title), ['earlier', 'soon']); assert.equal(d.next?.title, 'soon');
  assert.deepEqual(d.week.slice(0, 2).map((w) => w.count), [2, 1]); assert.equal(d.weekTotal, 3);
});
