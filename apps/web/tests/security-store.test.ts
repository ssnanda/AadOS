import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecurityStore } from '../src/lib/server/security-store.ts';

const W = 600_000;
test('login failures persist across instances (restart) and expire', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sec-'));
  const a = new SecurityStore(dir);
  for (let i = 0; i < 3; i++) a.addFailure('1.2.3.4', W, 1000 + i);
  assert.equal(new SecurityStore(dir).recentFailures('1.2.3.4', W, 2000), 3);
  assert.equal(new SecurityStore(dir).recentFailures('9.9.9.9', W, 2000), 0);
  assert.equal(new SecurityStore(dir).recentFailures('1.2.3.4', W, 1000 + W + 10), 0);
  a.clearFailures('1.2.3.4'); assert.equal(a.recentFailures('1.2.3.4', W, 2000), 0);
});
test('revoking sessions persists; file is 0600; corrupt file fails open to defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sec-'));
  const s = new SecurityStore(dir);
  assert.equal(s.validAfter(), 0);
  s.revokeAllSessions(5000);
  assert.equal(new SecurityStore(dir).validAfter(), 5000);
  assert.equal(statSync(join(dir, 'security.json')).mode & 0o777, 0o600);
});
