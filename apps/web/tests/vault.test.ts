import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyringFromEnv, open, seal } from '../src/lib/server/vault.ts';
import { assembleState, canonical, splitState } from '../src/lib/server/state-split.ts';
import { createDecipheriv } from 'node:crypto';

const k = (n: number) => Buffer.alloc(32, n);
const ring = (n = 1, version = 1) => ({ current: [version, k(n)] as [number, Buffer], ring: { [version]: k(n) } });

test('seal/open round trip; fresh IV; scope, key, tag and ciphertext are all authenticated', () => {
  const s = seal('account:a', { refreshToken: 'SECRET' }, ring());
  assert.ok(!s.ciphertext.toString('utf8').includes('SECRET'));
  assert.equal(open('account:a', s, ring()), '{"refreshToken":"SECRET"}');
  assert.notDeepEqual(seal('account:a', 'x', ring()).iv, seal('account:a', 'x', ring()).iv);
  assert.throws(() => open('account:b', s, ring()), /failed authentication/);
  assert.throws(() => open('account:a', s, ring(2)), /failed authentication/);
  assert.throws(() => open('account:a', { ...s, keyVersion: 9 }, ring()), /unknown key version/);
  const bad = Buffer.from(s.ciphertext); bad[0] ^= 1;
  assert.throws(() => open('account:a', { ...s, ciphertext: bad }, ring()), /failed authentication/);
});

test('wire format matches the Elixir vault (fixed vector produced here, decrypted by Elixir in CI)', () => {
  const key = Buffer.alloc(32, 7), iv = Buffer.from('CQkJCQkJCQkJCQkJ', 'base64');
  const d = createDecipheriv('aes-256-gcm', key, iv); d.setAAD(Buffer.from('aados:cred:v1:account:gmail-a')); d.setAuthTag(Buffer.from('/YkkmtEYd1pTfzrsAgpCAQ==', 'base64'));
  assert.equal(Buffer.concat([d.update(Buffer.from('XKf28diCpBLINqRTg4SB5fbiQY4=', 'base64')), d.final()]).toString(), '{"refreshToken":"R"}');
});

test('keyring from env: validates the key, supports a previous key for rotation', () => {
  assert.throws(() => keyringFromEnv({}), /32 bytes/);
  assert.throws(() => keyringFromEnv({ AADOS_CREDENTIAL_ENCRYPTION_KEY: Buffer.from('short').toString('base64') }), /32 bytes/);
  const r = keyringFromEnv({ AADOS_CREDENTIAL_ENCRYPTION_KEY: k(2).toString('base64'), AADOS_CREDENTIAL_KEY_VERSION: '2', AADOS_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: k(1).toString('base64'), AADOS_CREDENTIAL_KEY_VERSION_PREVIOUS: '1' });
  const old = seal('s', 'v', ring(1, 1));
  assert.equal(open('s', old, r), 'v'); assert.equal(seal('s', 'v', r).keyVersion, 2);
});

const state: any = { zoho: { clientId: 'ZID', clientSecret: 'ZSECRET', dataCenter: 'in', pending: { t: { expiresAt: 1, verifier: 'VERIFIER' } } }, gmail: { clientId: 'GID', clientSecret: 'GSECRET' },
  accounts: [{ id: 'g1', provider: 'gmail', email: 'a@x.com', accessToken: 'ACCESS', refreshToken: 'REFRESH', expiresAt: 99, folders: [] }], pipelines: [], items: [{ id: 'p:1', subject: 's' }], dismissed: [], tasks: [{ id: 't' }] };

test('split removes every secret from the database document and reassembly is lossless', () => {
  const { doc, credentials } = splitState(state);
  const text = JSON.stringify(doc);
  for (const secret of ['ACCESS', 'REFRESH', 'ZSECRET', 'GSECRET', 'VERIFIER']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(Object.keys(credentials).sort(), ['account:g1', 'app:gmail', 'app:zoho']);
  assert.equal(canonical(assembleState(doc, credentials)), canonical(state));
  assert.equal(state.accounts[0].accessToken, 'ACCESS'); // source untouched
});

test('integration secrets (AJMCP token, RustFS keys) are moved to the vault and restored', () => {
  const withInt = { ...state, integrations: { ajmcp: { url: 'https://ai.example', token: 'AJ-TOKEN' }, s3: { endpoint: 'https://s3.example', bucket: 'b', region: '', accessKey: 'AK-X', secretKey: 'SK-X', forcePathStyle: true, prefix: '' } } };
  const { doc, credentials } = splitState(withInt);
  for (const s of ['AJ-TOKEN', 'AK-X', 'SK-X']) assert.ok(!JSON.stringify(doc).includes(s), s);
  assert.equal((credentials['app:integrations'] as any).ajmcp.token, 'AJ-TOKEN');
  assert.equal(canonical(assembleState(doc, credentials)), canonical(withInt));
});
