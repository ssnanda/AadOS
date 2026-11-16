import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validOAuthState } from '../src/lib/server/oauth-state.ts';

test('accepts the pending, unexpired state only', () => {
  const future = Date.now() + 60_000;
  assert.equal(validOAuthState('abc', future, 'abc'), true);
  assert.equal(validOAuthState('abc', future, 'abd'), false);
  assert.equal(validOAuthState('abc', future, 'abcd'), false);
  assert.equal(validOAuthState('', future, ''), false); // nothing pending
  assert.equal(validOAuthState('abc', Date.now() - 1, 'abc'), false); // expired
});

import { addFlow, consumeFlow } from '../src/lib/server/oauth-state.ts';
test('parallel flows do not overwrite each other; each is single-use', () => {
  const p: Record<string, any> = {};
  addFlow(p, 'one', 'v1'); addFlow(p, 'two', 'v2');
  assert.equal(consumeFlow(p, 'two')?.verifier, 'v2');
  assert.equal(consumeFlow(p, 'two'), null); // replay
  assert.equal(consumeFlow(p, 'one')?.verifier, 'v1');
  assert.equal(consumeFlow(p, 'nope'), null);
});
test('expired flows are rejected and pruned; pending set is capped', () => {
  const p: Record<string, any> = {};
  addFlow(p, 'old', undefined, 0);
  assert.equal(consumeFlow(p, 'old', 11 * 60 * 1000), null);
  for (let i = 0; i < 25; i++) addFlow(p, `t${i}`, undefined, 1000 + i);
  assert.ok(Object.keys(p).length <= 10);
  assert.ok(consumeFlow(p, 't24', 2000));
});
