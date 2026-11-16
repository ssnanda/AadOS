import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, queryInbox, messageKey } from '../src/lib/server/inbox.ts';
import { classify, detectAction } from '../src/lib/server/categories.ts';

const acct = (id: string, provider: 'gmail' | 'zoho', email: string) => ({ id, provider, email, remoteId: '', accessToken: 'SECRET', refreshToken: 'SECRET', expiresAt: 0, folders: [] });
const pipe = (id: string, accountId: string, system = false) => ({ id, name: id, source: 'gmail' as const, accountId, folderId: 'x', folderName: 'x', folders: [], parser: 'generic' as const, enabled: true, cursor: 0, lastSync: '', lastError: '', system });
const item = (pipelineId: string, messageId: string, over: Record<string, unknown> = {}) => ({ id: `${pipelineId}:${messageId}`, pipelineId, messageId, subject: 'Hello', sender: 'Ann <ann@example.com>', receivedAt: '2026-11-10T10:00:00Z', summary: '', kind: 'other', stage: 'new' as const, facts: {}, ...over });

const accounts = [acct('gmail-a', 'gmail', 'a@gmail.com'), acct('gmail-b', 'gmail', 'b@gmail.com'), acct('zoho-a', 'zoho', 'z@zoho.com')];
const pipelines = [pipe('inbox-gmail-a', 'gmail-a', true), pipe('shop', 'gmail-a'), pipe('inbox-gmail-b', 'gmail-b', true), pipe('inbox-zoho-a', 'zoho-a', true)];

test('same message in an inbox feed and a custom view is one row', () => {
  const rows = buildRows({ pipelines, accounts, items: [item('inbox-gmail-a', 'm1'), item('shop', 'm1')] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].copyIds.length, 2);
  assert.deepEqual(rows[0].pipelines, ['shop']);
  assert.equal(rows[0].inInbox, true);
});

test('identical message ids in different accounts stay separate (account isolation)', () => {
  const rows = buildRows({ pipelines, accounts, items: [item('inbox-gmail-a', 'm1'), item('inbox-gmail-b', 'm1')] });
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].accountId, rows[1].accountId);
  assert.equal(messageKey('gmail-a', 'm1'), 'gmail-a:m1');
});

test('rows never expose credentials', () => {
  const rows = buildRows({ pipelines, accounts, items: [item('inbox-gmail-a', 'm1')] });
  assert.ok(!JSON.stringify(rows).includes('SECRET'));
});

test('unread: opened-in-AadOS copy makes the message read', () => {
  const rows = buildRows({ pipelines, accounts, items: [item('inbox-gmail-a', 'm1', { unread: true }), item('shop', 'm1', { unread: true, seen: true })] });
  assert.equal(rows[0].unread, false);
});

test('filters, search, pagination and counts', () => {
  const items = Array.from({ length: 120 }, (_, i) => item(i % 2 ? 'inbox-gmail-a' : 'inbox-zoho-a', `m${i}`, { receivedAt: new Date(Date.UTC(2026, 10, 1) + i * 3600_000).toISOString(), subject: i === 7 ? 'Dentist appointment' : `Note ${i}`, unread: i % 3 === 0 }));
  const rows = buildRows({ pipelines, accounts, items });
  const now = Date.UTC(2026, 10, 12);
  const first = queryInbox(rows, { view: 'all', pageSize: 50 }, now);
  assert.equal(first.total, 120); assert.equal(first.rows.length, 50); assert.equal(first.pages, 3);
  assert.equal(first.rows[0].messageId, 'm119'); // newest first
  assert.equal(queryInbox(rows, { page: 3, pageSize: 50 }, now).rows.length, 20);
  assert.equal(queryInbox(rows, { page: 99, pageSize: 50 }, now).page, 3); // clamped
  assert.equal(queryInbox(rows, { q: 'dentist' }, now).total, 1);
  assert.equal(queryInbox(rows, { q: 'z@zoho.com', view: 'all' }, now).total, 60); // search across account identity
  assert.equal(queryInbox(rows, { account: 'zoho-a', view: 'all' }, now).total, 60);
  assert.equal(queryInbox(rows, { view: 'unread' }, now).total, 40);
  assert.equal(queryInbox(rows, { from: '2026-11-02', to: '2026-11-02', view: 'all' }, now).total, 24);
  assert.equal(queryInbox(rows, { view: 'all', account: 'gmail-a' }, now).counts.all, 60);
});

test('thread count and thread filter', () => {
  const rows = buildRows({ pipelines, accounts, items: [item('inbox-gmail-a', 'm1', { threadId: 't1' }), item('inbox-gmail-a', 'm2', { threadId: 't1' }), item('inbox-gmail-a', 'm3', { threadId: 't2' })] });
  assert.equal(rows.find((r) => r.messageId === 'm1')!.threadCount, 2);
  assert.equal(queryInbox(rows, { view: 'all', thread: 't1' }).total, 2);
});

test('categories are rule-based and honour manual override', () => {
  assert.ok(classify({ subject: 'Your order #12345 has shipped', sender: 'orders@store.com', summary: '' }).includes('Orders and Deliveries'));
  assert.ok(classify({ subject: 'Your statement is ready', sender: 'billing@bank.com', summary: 'Amount due $40 by Nov 30' }).includes('Bills'));
  assert.ok(classify({ subject: 'Weekly newsletter', sender: 'news@site.com', summary: 'unsubscribe' }).includes('Newsletters'));
  assert.deepEqual(classify({ subject: 'x', sender: 'a@b.com', summary: '', categories: ['Travel'] }), ['Travel']);
  assert.deepEqual(classify({ subject: 'random', sender: '', summary: '' }), ['Other']);
});

test('Needs Reply: questions yes; bulk, outgoing and dismissed no; local override wins', () => {
  const ctx = { accountEmail: 'me@x.com' };
  assert.equal(detectAction({ subject: 'Can you send the form by Friday?', sender: 'Sam <sam@y.com>', summary: '' }, ctx)?.kind, 'reply');
  assert.equal(detectAction({ subject: 'Can you send the form?', sender: 'me@x.com', summary: '' }, ctx), null);
  assert.equal(detectAction({ subject: 'Big sale?', sender: 'no-reply@shop.com', summary: 'unsubscribe' }, ctx), null);
  assert.equal(detectAction({ subject: 'Can you call me?', sender: 'sam@y.com', summary: '', actionState: 'dismissed' }, ctx), null);
  assert.equal(detectAction({ subject: 'FYI', sender: 'sam@y.com', summary: '', actionState: 'actionable' }, ctx)?.kind, 'reply');
  assert.equal(detectAction({ subject: 'Payment due Nov 30', sender: 'billing@bank.com', summary: '' }, ctx)?.kind, 'financial');
});

test('Needs Reply view and count exclude reviewed messages', () => {
  const rows = buildRows({ pipelines, accounts, items: [item('inbox-gmail-a', 'm1', { subject: 'Can you help?' }), item('inbox-gmail-a', 'm2', { subject: 'Can you help?', actionState: 'reviewed' })] });
  const result = queryInbox(rows, { view: 'needs-reply' });
  assert.equal(result.total, 1); assert.equal(result.counts.needsReply, 1);
});

import { extractDue } from '../src/lib/server/dates.ts';
test('due-date extraction', () => {
  const now = new Date('2026-11-16T12:00:00Z'); // Monday
  assert.equal(extractDue('Amount due by Nov 30', now), '2026-11-30');
  assert.equal(extractDue('due 12/05/2026', now), '2026-12-05');
  assert.equal(extractDue('due 2026-12-01', now), '2026-12-01');
  assert.equal(extractDue('pay by Friday', now), '2026-11-20');
  assert.equal(extractDue('pay tomorrow', now), '2026-11-17');
  assert.equal(extractDue('Jan 5', now), '2027-01-05'); // already past 30d? no: Jan 5 this year is >30d past -> next year
  assert.equal(extractDue('Feb 31', now), '');
  assert.equal(extractDue('nothing here', now), '');
  assert.equal(detectAction({ subject: 'Payment due Nov 30', sender: 'billing@bank.com', summary: '' }, { now })?.due, '2026-11-30');
});
