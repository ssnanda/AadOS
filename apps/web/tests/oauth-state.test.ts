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
