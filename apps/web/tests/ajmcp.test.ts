import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiError, createAjmcpClient, describeError, fitMessages, validBaseUrl } from '../src/lib/server/ai/ajmcp.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const mk = (handler: (url: string, init?: RequestInit) => Promise<Response>, extra = {}) => createAjmcpClient({ baseUrl: 'https://ai.example.test/', token: 'TOKEN-123', fetchImpl: handler, sleep: async () => {}, ...extra });

test('config: https only (loopback allowed for mocks); missing token is not_configured', () => {
  assert.equal(validBaseUrl('https://ajmcp.example.com'), true); assert.equal(validBaseUrl('http://ajmcp.example.com'), false); assert.equal(validBaseUrl('http://127.0.0.1:9999'), true); assert.equal(validBaseUrl('nope'), false);
  assert.throws(() => createAjmcpClient({ baseUrl: 'https://x.test', token: '' }), (e: AiError) => e.kind === 'not_configured');
  assert.throws(() => createAjmcpClient({ baseUrl: 'http://x.test', token: 't' }), (e: AiError) => e.kind === 'not_configured');
});

test('chat: bearer auth, JSON body with only messages (no model/provider/system overrides), metadata returned', async () => {
  let seen: any;
  const c = mk(async (url, init) => { seen = { url, init }; return json(200, { reply: ' Hello ', site: 'aados', provider: 'openai', model: 'gpt-x', usage: { input_tokens: 10, output_tokens: 3, note: 'x' }, requestId: 'r1' }); });
  const r = await c.chat([{ role: 'user', content: 'Hi' }]);
  assert.equal(seen.url, 'https://ai.example.test/v1/chat'); assert.equal(seen.init.headers.Authorization, 'Bearer TOKEN-123');
  assert.deepEqual(Object.keys(JSON.parse(seen.init.body)), ['messages']);
  assert.deepEqual([r.reply, r.provider, r.model, r.requestId], ['Hello', 'openai', 'gpt-x', 'r1']); assert.deepEqual(r.usage, { input_tokens: 10, output_tokens: 3 });
  assert.equal(typeof r.latencyMs, 'number');
});

test('error classification; auth and limits are never retried; busy/5xx retried with a bound', async () => {
  for (const [status, body, kind] of [[401, { error: 'unauthorized' }, 'auth'], [403, { error: 'site_token_required' }, 'forbidden'], [413, { error: 'request_too_large' }, 'too_large'], [429, { error: 'rate_limit' }, 'rate_limit'], [400, { error: 'invalid_request' }, 'invalid_request']] as const) {
    let calls = 0;
    await assert.rejects(mk(async () => { calls++; return json(status, body); }).chat([{ role: 'user', content: 'x' }]), (e: AiError) => e.kind === kind);
    assert.equal(calls, 1, `${kind} must not retry`);
  }
  let n = 0;
  await assert.rejects(mk(async () => { n++; return json(503, { error: 'busy' }); }, { retries: 2 }).chat([{ role: 'user', content: 'x' }]), (e: AiError) => e.kind === 'busy');
  assert.equal(n, 3);
  let m = 0;
  const ok = await mk(async () => (++m < 2 ? json(502, {}) : json(200, { reply: 'ok' }))).chat([{ role: 'user', content: 'x' }]);
  assert.equal(ok.reply, 'ok'); assert.equal(m, 2);
});

test('invalid responses and network failure', async () => {
  await assert.rejects(mk(async () => new Response('<html>', { status: 200 })).chat([{ role: 'user', content: 'x' }]), (e: AiError) => e.kind === 'invalid_response');
  await assert.rejects(mk(async () => json(200, { reply: '' })).chat([{ role: 'user', content: 'x' }]), (e: AiError) => e.kind === 'invalid_response');
  await assert.rejects(mk(async () => { throw new TypeError('fetch failed'); }, { retries: 0 }).chat([{ role: 'user', content: 'x' }]), (e: AiError) => e.kind === 'unavailable');
});

test('timeout and cancellation', async () => {
  const hang = (_u: string, init?: RequestInit) => new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  await assert.rejects(mk(hang, { timeoutMs: 30, retries: 0 }).chat([{ role: 'user', content: 'x' }]), (e: AiError) => e.kind === 'timeout');
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 20);
  await assert.rejects(mk(hang, { timeoutMs: 5000 }).chat([{ role: 'user', content: 'x' }], ctl.signal), (e: AiError) => e.kind === 'cancelled');
});

test('request limits: newest turns kept, over-long latest message refused, byte budget enforced', () => {
  const many = Array.from({ length: 29 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` }));
  const fit = fitMessages(many);
  assert.ok(fit.length <= 20); assert.equal(fit.at(-1)!.content, 'm28'); assert.equal(fit[0].role, 'user');
  assert.throws(() => fitMessages([{ role: 'user', content: 'x'.repeat(6001) }]), (e: AiError) => e.kind === 'too_large');
  const big = Array.from({ length: 9 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: 'y'.repeat(5900) }));
  const trimmed = fitMessages(big);
  assert.ok(Buffer.byteLength(JSON.stringify({ messages: trimmed })) <= 32 * 1024); assert.ok(trimmed.length < 9);
  assert.throws(() => fitMessages([{ role: 'assistant', content: 'x' }]), (e: AiError) => e.kind === 'invalid_request');
  assert.equal(describeError(new AiError('auth', 'x')), 'AJMCP rejected the AadOS token.');
});

test('capabilities', async () => {
  const c = mk(async (url) => { assert.ok(url.endsWith('/v1/capabilities')); return json(200, { version: '0.9', id: 'aados', kind: 'site', provider: 'anthropic', endpoints: ['/v1/chat'] }); });
  assert.deepEqual(await c.capabilities(), { version: '0.9', id: 'aados', provider: 'anthropic', endpoints: ['/v1/chat'] });
});

test('plain HTTP only for loopback or explicitly allowed hosts (local Docker mocks)', () => {
  assert.equal(validBaseUrl('http://mock:9999'), false);
  assert.equal(validBaseUrl('http://mock:9999', ['mock']), true);
  assert.equal(validBaseUrl('http://other:9999', ['mock']), false);
});
