import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSync } from '../src/lib/server/sync-merge.ts';

const base = () => ({
  zoho: {}, gmail: {}, dismissed: [] as string[], tasks: [],
  accounts: [{ id: 'g', provider: 'gmail', email: 'a@x.com', accessToken: 'old', refreshToken: 'r', expiresAt: 1, folders: [], lastSync: '', lastError: '' }],
  pipelines: [{ id: 'p', cursor: 0, lastSync: '', lastError: '' }],
  items: [{ id: 'p:1', pipelineId: 'p', messageId: '1', unread: true, subject: 's' }]
}) as any;

test('adds new items, refreshes tokens, updates unread; keeps concurrent local edits', () => {
  const before = base();
  const working = structuredClone(before);
  working.items.push({ id: 'p:2', pipelineId: 'p', messageId: '2', unread: true });
  working.items[0].unread = false;
  working.accounts[0].accessToken = 'new'; working.accounts[0].lastSync = 'T';
  working.pipelines[0].lastSync = 'T';

  const latest = structuredClone(before);
  latest.items[0].actionState = 'reviewed';              // edited while the sync ran
  latest.tasks.push({ id: 't' });                         // task added while the sync ran
  latest.accounts.push({ id: 'z', provider: 'zoho' });    // account connected while the sync ran
  mergeSync(latest, before, working);

  assert.equal(latest.items.length, 2);
  assert.equal(latest.items[0].unread, false);
  assert.equal(latest.items[0].actionState, 'reviewed');
  assert.equal(latest.accounts[0].accessToken, 'new');
  assert.equal(latest.accounts.length, 2);
  assert.equal(latest.tasks.length, 1);
  assert.equal(latest.pipelines[0].lastSync, 'T');
});

test('never resurrects deleted/dismissed mail, never duplicates, ignores removed accounts', () => {
  const before = base();
  const working = structuredClone(before);
  working.items.push({ id: 'p:2', pipelineId: 'p', messageId: '2' }, { id: 'p:3', pipelineId: 'p', messageId: '3' });
  working.accounts[0].accessToken = 'new';
  const latest = structuredClone(before);
  latest.dismissed.push('p:2');
  latest.items.push({ id: 'p:3', pipelineId: 'p', messageId: '3' }); // already added by someone else
  latest.accounts = []; // disconnected meanwhile
  mergeSync(latest, before, working);
  assert.deepEqual(latest.items.map((i: any) => i.id), ['p:1', 'p:3']);
  assert.equal(latest.accounts.length, 0);
});

test('merging twice is idempotent', () => {
  const before = base(); const working = structuredClone(before);
  working.items.push({ id: 'p:2', pipelineId: 'p', messageId: '2' });
  const latest = structuredClone(before);
  mergeSync(latest, before, working); mergeSync(latest, before, working);
  assert.equal(latest.items.length, 2);
});
