import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRetry, needsReconnect } from '../src/lib/server/retry.ts';

const res = (status: number, headers: Record<string, string> = {}) => new Response('{}', { status, headers });
const run = (statuses: (number | Error)[], attempts = 4) => {
  const waits: number[] = []; let calls = 0;
  const fetchImpl = (async () => { const next = statuses[Math.min(calls++, statuses.length - 1)]; if (next instanceof Error) throw next; return res(next, next === 429 ? { 'retry-after': '2' } : {}); }) as typeof fetch;
  return { waits, calls: () => calls, go: () => fetchRetry('https://x.test', {}, { attempts, fetchImpl, sleep: async (ms) => { waits.push(ms); } }) };
};

test('retries 429 honouring Retry-After, then succeeds', async () => {
  const t = run([429, 200]); const r = await t.go();
  assert.equal(r.status, 200); assert.equal(t.calls(), 2); assert.deepEqual(t.waits, [2000]);
});
test('retries 5xx and network errors with growing backoff', async () => {
  const t = run([503, new Error('net'), 200]); assert.equal((await t.go()).status, 200); assert.deepEqual(t.waits, [1000, 2000]);
});
test('gives up after the attempt limit and returns the last response', async () => {
  const t = run([500]); assert.equal((await t.go()).status, 500); assert.equal(t.calls(), 4);
});
test('does not retry client errors', async () => {
  const t = run([401, 200]); assert.equal((await t.go()).status, 401); assert.equal(t.calls(), 1);
});
test('rethrows the final network error', async () => {
  const t = run([new Error('down')], 2); await assert.rejects(t.go(), /down/);
});
test('needsReconnect recognises dead refresh tokens', () => {
  assert.equal(needsReconnect('invalid_grant'), true);
  assert.equal(needsReconnect('Token has been expired or revoked.'), true);
  assert.equal(needsReconnect('Zoho HTTP 500'), false);
});
