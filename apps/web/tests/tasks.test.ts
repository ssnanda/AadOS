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
