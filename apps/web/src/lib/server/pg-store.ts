// PostgreSQL primary storage for AadOS state. The document (no secrets) lives in `app_state`; tokens and OAuth
// client secrets are encrypted (vault.ts) into `mail_credentials`. Updates are one transaction holding
// `SELECT ... FOR UPDATE` on the single state row, so concurrent writers (even from other processes) serialise.
// Tables are created by the API's Ecto migrations (run automatically at API start-up).
import { open, seal, type Keyring } from './vault.ts';
import { assembleState, canonical, countsOf, splitState, type Credentials } from './state-split.ts';

export type Client = { query(text: string, params?: unknown[]): Promise<{ rows: any[] }>; release?(): void };
export type Pool = { connect(): Promise<Client> };
type State = any;

export class PgStorage {
  private pool: Pool; private keyring: Keyring; private normalize: (saved: any) => State;
  constructor(pool: Pool, keyring: Keyring, normalize: (saved: any) => State) { this.pool = pool; this.keyring = keyring; this.normalize = normalize; }

  /** Wait for the API's migrations (tables are created there). */
  async ready(attempts = 90, delayMs = 1000): Promise<void> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      const client = await this.pool.connect().catch((e) => { last = e; return null; });
      if (client) {
        try { const r = await client.query(`SELECT to_regclass('app_state')::text AS a, to_regclass('mail_credentials')::text AS c`); if (r.rows[0]?.a && r.rows[0]?.c) return; last = new Error('database migrations have not run yet'); }
        catch (e) { last = e; } finally { client.release?.(); }
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(`PostgreSQL is not ready: ${last instanceof Error ? last.message : String(last)}`);
  }

  private async loadCredentials(client: Client): Promise<{ credentials: Credentials; plain: Record<string, string> }> {
    const rows = (await client.query('SELECT scope, key_version, iv, tag, ciphertext FROM mail_credentials')).rows;
    const credentials: Credentials = {}, plain: Record<string, string> = {};
    for (const row of rows) {
      const text = open(row.scope, { keyVersion: row.key_version, iv: row.iv, tag: row.tag, ciphertext: row.ciphertext }, this.keyring);
      credentials[row.scope] = JSON.parse(text); plain[row.scope] = text;
    }
    return { credentials, plain };
  }

  private async read(client: Client, lock: boolean) {
    const row = (await client.query(`SELECT data, version FROM app_state WHERE id = 1${lock ? ' FOR UPDATE' : ''}`)).rows[0];
    if (!row) return null;
    const { credentials, plain } = await this.loadCredentials(client);
    return { state: this.normalize(assembleState(row.data, credentials)), version: Number(row.version), plain };
  }

  /** null when nothing has been stored yet. */
  async load(): Promise<State | null> {
    const client = await this.pool.connect();
    try { return (await this.read(client, false))?.state ?? null; } finally { client.release?.(); }
  }

  private async write(client: Client, state: State, previousPlain: Record<string, string>, version: number, meta?: { from: string }) {
    const { doc, credentials } = splitState(state);
    await client.query(
      `INSERT INTO app_state (id, data, version, migrated_from, migrated_at, inserted_at, updated_at)
       VALUES (1, $1::jsonb, $2, $3::varchar, CASE WHEN $3::varchar IS NULL THEN NULL ELSE now() END, now(), now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, updated_at = now()`,
      [JSON.stringify(doc).replace(/\\u0000/g, ''), version, meta?.from ?? null]
    );
    const wanted = new Set(Object.keys(credentials));
    for (const [scope, payload] of Object.entries(credentials)) {
      const text = JSON.stringify(payload);
      if (previousPlain[scope] === text) continue; // unchanged: keep the existing ciphertext
      const s = seal(scope, text, this.keyring);
      await client.query(
        `INSERT INTO mail_credentials (scope, key_version, iv, tag, ciphertext, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5, now(), now())
         ON CONFLICT (scope) DO UPDATE SET key_version = EXCLUDED.key_version, iv = EXCLUDED.iv, tag = EXCLUDED.tag, ciphertext = EXCLUDED.ciphertext, updated_at = now()`,
        [scope, s.keyVersion, s.iv, s.tag, s.ciphertext]
      );
    }
    // A disconnected account's tokens must not linger.
    for (const scope of Object.keys(previousPlain)) if (!wanted.has(scope)) await client.query('DELETE FROM mail_credentials WHERE scope = $1', [scope]);
  }

  /** One transaction: lock, read, apply `change`, write back. Rolls back (and rethrows) if `change` throws. */
  async transact(change: (state: State) => void | Promise<void>, empty: () => State): Promise<State> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.read(client, true);
      const state = current?.state ?? empty();
      await change(state);
      await this.write(client, state, current?.plain ?? {}, (current?.version ?? 0) + 1);
      await client.query('COMMIT');
      return state;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally { client.release?.(); }
  }

  /**
   * One-time import of an existing state (from state.enc). No-op when the database already holds state.
   * Writes in a transaction, reads it back and compares it with the source; any mismatch rolls everything back.
   */
  async importState(source: State, from: string): Promise<{ imported: boolean; counts: ReturnType<typeof countsOf> }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = (await client.query('SELECT 1 FROM app_state WHERE id = 1 FOR UPDATE')).rows.length > 0;
      if (existing) { await client.query('ROLLBACK'); return { imported: false, counts: countsOf((await this.load()) || {}) }; }
      // jsonb cannot hold NUL characters; strip them from the source too so the integrity comparison stays exact.
      const normalized = this.normalize(JSON.parse(JSON.stringify(source).replace(/\\u0000/g, '')));
      await this.write(client, normalized, {}, 1, { from });
      const back = await this.read(client, false);
      if (!back || canonical(back.state) !== canonical(normalized)) throw new Error('integrity check failed: data read back from PostgreSQL differs from the source; nothing was written');
      await client.query('COMMIT');
      return { imported: true, counts: countsOf(back.state) };
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally { client.release?.(); }
  }
}
