import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const secret = 'x'.repeat(64);
const state = { accounts: [{ id: 'gmail-a', provider: 'gmail', email: 'a@x.com', remoteId: '', accessToken: 'TOKEN', refreshToken: 'REFRESH', folders: [] }], zoho: { clientSecret: 'CS' }, pipelines: [{ id: 'inbox-gmail-a', name: 'Inbox', accountId: 'gmail-a', parser: 'generic', enabled: true, system: true, folders: [] }], items: [{ id: 'inbox-gmail-a:m1', pipelineId: 'inbox-gmail-a', messageId: 'm1', subject: 's' }], dismissed: [] };
const encrypt = (value: unknown) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', createHash('sha256').update(`aados-state-v1:${secret}`).digest(), iv); const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]); return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.'); };
const tool = (dir: string, ...args: string[]) => spawnSync(process.execPath, ['scripts/state-tool.mjs', ...args], { env: { ...process.env, AADOS_DATA_DIR: dir, AADOS_SESSION_SECRET: secret }, encoding: 'utf8' });

test('verify prints counts only; backup is a verified 0600 copy; original untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aados-'));
  writeFileSync(join(dir, 'state.enc'), encrypt(state));
  const before = readFileSync(join(dir, 'state.enc'), 'utf8');
  const v = tool(dir, 'verify');
  assert.equal(v.status, 0); assert.deepEqual(JSON.parse(v.stdout), { accounts: 1, views: 0, inboxFeeds: 1, messages: 1, dismissed: 0 });
  assert.ok(!v.stdout.includes('TOKEN'));
  const b = tool(dir, 'backup'); assert.equal(b.status, 0);
  const backup = readdirSync(dir).find((f) => f.includes('.bak-'))!;
  assert.equal(statSync(join(dir, backup)).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, backup), 'utf8'), before);
  assert.equal(readFileSync(join(dir, 'state.enc'), 'utf8'), before);
});

test('export strips tokens and secrets, refuses to overwrite, wrong secret fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aados-'));
  writeFileSync(join(dir, 'state.enc'), encrypt(state));
  const out = join(dir, 'out.json');
  assert.equal(tool(dir, 'export', out).status, 0);
  const text = readFileSync(out, 'utf8');
  assert.ok(!/TOKEN|REFRESH|CS"/.test(text));
  assert.equal(JSON.parse(text).items[0].accountId, 'gmail-a');
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.notEqual(tool(dir, 'export', out).status, 0);
  const bad = spawnSync(process.execPath, ['scripts/state-tool.mjs', 'verify'], { env: { ...process.env, AADOS_DATA_DIR: dir, AADOS_SESSION_SECRET: 'y'.repeat(64) }, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
});

test('--with-credentials includes tokens only when asked, still 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aados-'));
  writeFileSync(join(dir, 'state.enc'), encrypt({ ...state, gmail: { clientId: 'CID', clientSecret: 'GSECRET' }, tasks: [{ id: 't', title: 'x' }] }));
  const plain = join(dir, 'plain.json'), full = join(dir, 'full.json');
  assert.equal(tool(dir, 'export', plain).status, 0);
  assert.ok(!readFileSync(plain, 'utf8').includes('REFRESH') && !JSON.parse(readFileSync(plain, 'utf8')).credentials);
  assert.equal(JSON.parse(readFileSync(plain, 'utf8')).tasks.length, 1);
  assert.equal(tool(dir, 'export', full, '--with-credentials').status, 0);
  const c = JSON.parse(readFileSync(full, 'utf8')).credentials;
  assert.equal(c['account:gmail-a'].refreshToken, 'REFRESH'); assert.equal(c['app:gmail'].clientSecret, 'GSECRET');
  assert.equal(statSync(full).mode & 0o777, 0o600);
});
