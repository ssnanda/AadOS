import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PgStorage } from '../src/lib/server/pg-store.ts';
import { keyringFromEnv } from '../src/lib/server/vault.ts';
import { canonical } from '../src/lib/server/state-split.ts';

// Integration tests against a real PostgreSQL; skipped unless AADOS_TEST_DATABASE_URL names a *_test database.
// (bin/dev-local.sh test starts one.) The DDL mirrors the API's Ecto migrations for app_state and mail_credentials.
const url = process.env.AADOS_TEST_DATABASE_URL;
const skip = !url || !/_test$/.test(new URL(url).pathname) ? 'AADOS_TEST_DATABASE_URL not set' : false;
const KEY = Buffer.alloc(32, 5).toString('base64');
const keyring = keyringFromEnv({ AADOS_CREDENTIAL_ENCRYPTION_KEY: KEY });
const norm = (s: any) => ({ tasks: [], items: [], accounts: [], dismissed: [], pipelines: [], zoho: {}, gmail: {}, ...s });
const empty = () => norm({});
let pool: pg.Pool, store: PgStorage;

const state = () => norm({
  zoho: { clientId: 'ZID', clientSecret: 'ZSECRET' }, gmail: { clientId: 'GID', clientSecret: 'GSECRET' },
  accounts: [{ id: 'g1', provider: 'gmail', email: 'a@x.com', accessToken: 'ACCESS', refreshToken: 'REFRESH', expiresAt: 5, folders: [] }, { id: 'g2', provider: 'gmail', email: 'b@x.com', accessToken: 'A2', refreshToken: 'R2', expiresAt: 6, folders: [] }],
  items: [{ id: 'p:1', pipelineId: 'p', messageId: '1', subject: 'Hello\u0000NUL', unread: true }], tasks: [{ id: 't1', title: 'Pay', due: '2026-11-30', done: false }], dismissed: ['p:9']
});

before(async () => {
  if (skip) return;
  // Own schema so these tables never collide with the API's Ecto-managed ones in the same test database.
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query('CREATE SCHEMA IF NOT EXISTS node_test'); await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 10, options: '-c search_path=node_test' });
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, version bigint NOT NULL DEFAULT 0, migrated_from varchar, migrated_at timestamp(0), inserted_at timestamp(0) NOT NULL, updated_at timestamp(0) NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS mail_credentials (scope varchar PRIMARY KEY, key_version integer NOT NULL, iv bytea NOT NULL, tag bytea NOT NULL, ciphertext bytea NOT NULL, inserted_at timestamp(0) NOT NULL, updated_at timestamp(0) NOT NULL)`);
  store = new PgStorage(pool, keyring, norm);
});
after(async () => { if (pool) await pool.end(); });
const reset = () => pool.query('TRUNCATE app_state, mail_credentials');

test('ready() succeeds when migrations exist', { skip }, async () => { await store.ready(2, 10); });

test('import: integrity-checked, idempotent, never overwrites existing database state', { skip }, async () => {
  await reset();
  const first = await store.importState(state(), 'state.enc');
  assert.equal(first.imported, true); assert.deepEqual(first.counts, { accounts: 2, messages: 1, tasks: 1, views: 0, dismissed: 1 });
  const loaded = await store.load();
  assert.equal(loaded.accounts[0].refreshToken, 'REFRESH'); assert.equal(loaded.zoho.clientSecret, 'ZSECRET');
  assert.equal(loaded.items[0].subject, 'HelloNUL'); // jsonb cannot store NUL; stripped consistently
  const second = await store.importState(norm({ tasks: [{ id: 'other' }] }), 'state.enc');
  assert.equal(second.imported, false);
  assert.equal((await store.load()).tasks[0].id, 't1');
});

test('secrets are encrypted at rest and absent from the document; wrong key cannot read', { skip }, async () => {
  await reset(); await store.importState(state(), 'state.enc');
  const doc = JSON.stringify((await pool.query('SELECT data FROM app_state')).rows[0].data);
  for (const s of ['ACCESS', 'REFRESH', 'ZSECRET', 'GSECRET']) assert.ok(!doc.includes(s), s);
  const rows = (await pool.query('SELECT scope, ciphertext FROM mail_credentials ORDER BY scope')).rows;
  assert.deepEqual(rows.map((r) => r.scope), ['account:g1', 'account:g2', 'app:gmail', 'app:zoho']);
  assert.ok(rows.every((r) => !r.ciphertext.toString('utf8').includes('REFRESH')));
  const other = new PgStorage(pool, keyringFromEnv({ AADOS_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64') }), norm);
  await assert.rejects(other.load(), /failed authentication/);
});

test('transact: concurrent writers serialise (no lost updates) and a throwing change rolls back', { skip }, async () => {
  await reset(); await store.importState(state(), 'state.enc');
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.transact((s) => { s.tasks.push({ id: `c${i}` }); }, empty)));
  assert.equal((await store.load()).tasks.length, 26);
  await assert.rejects(store.transact((s) => { s.tasks = []; throw new Error('boom'); }, empty), /boom/);
  assert.equal((await store.load()).tasks.length, 26);
  assert.equal(Number((await pool.query('SELECT version FROM app_state')).rows[0].version), 26);
});

test('token refresh re-encrypts only that account; unchanged credentials keep their ciphertext; disconnect deletes tokens', { skip }, async () => {
  await reset(); await store.importState(state(), 'state.enc');
  const before = Object.fromEntries((await pool.query('SELECT scope, ciphertext FROM mail_credentials')).rows.map((r) => [r.scope, r.ciphertext.toString('hex')]));
  await store.transact((s) => { s.accounts[0].accessToken = 'NEW-ACCESS'; }, empty);
  const after = Object.fromEntries((await pool.query('SELECT scope, ciphertext FROM mail_credentials')).rows.map((r) => [r.scope, r.ciphertext.toString('hex')]));
  assert.notEqual(after['account:g1'], before['account:g1']);
  for (const scope of ['account:g2', 'app:gmail', 'app:zoho']) assert.equal(after[scope], before[scope]);
  assert.equal((await store.load()).accounts[0].accessToken, 'NEW-ACCESS');
  await store.transact((s) => { s.accounts = s.accounts.filter((a: any) => a.id !== 'g1'); }, empty);
  assert.deepEqual((await pool.query('SELECT scope FROM mail_credentials ORDER BY scope')).rows.map((r) => r.scope), ['account:g2', 'app:gmail', 'app:zoho']);
});

test('empty database: transact creates state; load is null before', { skip }, async () => {
  await reset();
  assert.equal(await store.load(), null);
  const s = await store.transact((x) => { x.tasks.push({ id: 'first' }); }, empty);
  assert.equal(canonical((await store.load()).tasks), canonical(s.tasks));
});
