import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overview, addDays } from '../src/lib/server/overview.ts';
import { buildRows } from '../src/lib/server/inbox.ts';
import { dailyCalendar } from '../src/lib/server/daily.ts';

const today = '2026-11-16';
test('date helpers', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});

const acct = { id: 'g', provider: 'gmail' as const, email: 'a@x.com', remoteId: '', accessToken: '', refreshToken: '', expiresAt: 0, folders: [], lastError: 'boom' };
const pipe = { id: 'inbox-g', name: 'Inbox', source: 'gmail' as const, accountId: 'g', folderId: 'INBOX', folderName: 'Inbox', folders: [], parser: 'generic' as const, enabled: true, cursor: 0, lastSync: '', lastError: '', system: true };
const item = (id: string, subject: string, over: Record<string, unknown> = {}) => ({ id: `inbox-g:${id}`, pipelineId: 'inbox-g', messageId: id, subject, sender: 'Bank <billing@bank.com>', receivedAt: '2026-11-15T10:00:00Z', summary: '', kind: 'other', stage: 'new' as const, facts: {}, unread: true, ...over });

test('overview uses real data only and surfaces connection errors', () => {
  const empty = overview({ rows: [], accounts: [], today });
  assert.deepEqual([empty.important, empty.needsReply, empty.billsRenewals, empty.upcoming, empty.errors], [[], [], [], [], []]);
  const rows = buildRows({ pipelines: [pipe], accounts: [acct], items: [item('1', 'Your statement is ready, amount due Nov 30'), item('2', 'Urgent: action required'), item('3', 'Can you reply?', { sender: 'Sam <sam@y.com>' })], now: new Date('2026-11-16T12:00:00Z') });
  const o = overview({ rows, accounts: [acct], today });
  assert.equal(o.counts.billsRenewals, 1); assert.ok(o.counts.important >= 1); assert.equal(o.counts.needsReply, 1);
  assert.equal(o.upcoming[0]?.due, '2026-11-30');
  assert.deepEqual(o.errors, [{ id: 'g', label: 'Gmail · a@x.com', message: 'boom' }]);
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
