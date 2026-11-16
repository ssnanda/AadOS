import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCounts, dbReadMode, fetchDbCounts } from '../src/lib/server/db-compare.ts';

const c = (over = {}) => ({ accounts: 2, messages: 10, unread: 4, tasks: 1, perAccount: { a: 6, b: 4 }, ...over });
test('identical counts match; differences are itemised', () => {
  assert.deepEqual(compareCounts(c(), c()), { match: true, differences: [] });
  const r = compareCounts(c(), c({ messages: 9, perAccount: { a: 6, b: 3 } }));
  assert.equal(r.match, false); assert.deepEqual(r.differences, ['messages: legacy 10 vs database 9', 'account b: legacy 4 vs database 3']);
});
test('flag defaults to off; only "compare" enables comparison', () => {
  assert.equal(dbReadMode(undefined), 'off'); assert.equal(dbReadMode('on'), 'off'); assert.equal(dbReadMode('compare'), 'compare');
});
test('client sends the bearer token and maps failures without leaking it', async () => {
  let auth = '';
  const ok = await fetchDbCounts(async (_u, init) => { auth = (init!.headers as any).Authorization; return new Response(JSON.stringify({ accounts: 1, messages: 2, unread: 1, tasks: 0, per_account: { a: 2 } })); }, 'http://api/', 'SECRET-TOKEN');
  assert.equal(auth, 'Bearer SECRET-TOKEN'); assert.deepEqual(ok.perAccount, { a: 2 });
  await assert.rejects(fetchDbCounts(async () => new Response('', { status: 503 }), 'http://api', 'T'), /disabled/);
  await assert.rejects(fetchDbCounts(async () => new Response('', { status: 401 }), 'http://api', 'SECRET-TOKEN'), (e: Error) => /rejected/.test(e.message) && !e.message.includes('SECRET'));
  await assert.rejects(fetchDbCounts(async () => new Response(''), '', ''), /must be set/);
});
