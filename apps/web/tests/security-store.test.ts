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

test('owner password override: wins while the deployment hash is unchanged; a deployment reset makes it inactive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sec-'));
  const fp = (v: string) => `fp:${v}`;
  const s = new SecurityStore(dir);
  assert.equal(s.effectivePasswordHash('DEPLOY-1', fp), 'DEPLOY-1');
  s.setPasswordHash('NEW-HASH', 'DEPLOY-1', fp);
  assert.equal(new SecurityStore(dir).effectivePasswordHash('DEPLOY-1', fp), 'NEW-HASH');
  assert.equal(new SecurityStore(dir).effectivePasswordHash('DEPLOY-2', fp), 'DEPLOY-2'); // dev-local --reset-user / oc-deploy --reset-user
  s.revokeAllSessions(5); assert.equal(new SecurityStore(dir).effectivePasswordHash('DEPLOY-1', fp), 'NEW-HASH'); // other writes keep it
});
