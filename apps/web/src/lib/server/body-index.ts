import { database, hasDatabase, readState, type AadOSState } from '$lib/server/aados-store';
import { fetchBodies, jobsFor, type Body } from '$lib/server/email-bodies';

// Full-text search over email bodies (PostgreSQL table mail_bodies, migration 20261127000001).
// Filled in the background after each sync, read-only towards the mailboxes: nothing is marked read, moved or deleted.
// The only deletes are index rows for emails no longer stored in AadOS.
// Without PostgreSQL storage (or before the migration has run) every function here quietly does nothing.

const PER_RUN = 300, CONCURRENCY = 2, MAX_TEXT = 20_000;

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
/** HTML → plain text good enough for searching. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (/^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : /^#x[0-9a-f]+$/i.test(e) ? String.fromCodePoint(parseInt(e.slice(2), 16)) : m))
    .replace(/\s+/g, ' ')
    .trim();
}

let tableReady: boolean | undefined;
async function pool() {
  if (!hasDatabase()) return null;
  const db = await database();
  if (!tableReady) {
    const r = await db.query(`SELECT to_regclass('mail_bodies')::text AS t`);
    tableReady = Boolean(r.rows[0]?.t);
    if (!tableReady) { console.warn('[aados] body search: table mail_bodies missing (API migration not run yet)'); return null; }
  }
  return db;
}

/** Background: index up to PER_RUN not-yet-indexed emails (newest first) and prune rows for emails gone from AadOS. */
export async function indexBodies() {
  const db = await pool();
  if (!db) return;
  const state = await readState();
  const jobs = jobsFor(state, state.items);
  // Prune: index rows whose email is no longer stored (deleted, purged, account removed). Paused accounts keep theirs.
  const owner = new Map(state.pipelines.map((p) => [p.id, p.accountId]));
  const accounts = state.items.map((i) => i.accountId || owner.get(i.pipelineId) || ''), ids = state.items.map((i) => i.messageId);
  await db.query(`DELETE FROM mail_bodies b WHERE NOT EXISTS (SELECT 1 FROM unnest($1::text[], $2::text[]) AS k(a, m) WHERE k.a = b.account_id AND k.m = b.provider_message_id)`, [accounts, ids]);
  const have = new Set((await db.query('SELECT account_id, provider_message_id FROM mail_bodies')).rows.map((r) => `${r.account_id}\u0000${r.provider_message_id}`));
  const todo = jobs.filter((j) => !have.has(`${j.account.id}\u0000${j.item.messageId}`)).slice(0, PER_RUN);
  if (!todo.length) return;
  let added = 0;
  await fetchBodies(state, todo, async ({ item, account }, body: Body) => {
    const text = `${item.subject} ${item.sender} ${item.to || ''} ${body.html ? htmlToText(body.html) : body.text}`.slice(0, MAX_TEXT);
    await db.query('INSERT INTO mail_bodies (account_id, provider_message_id, text) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [account.id, item.messageId, text]);
    added++;
  }, { concurrency: CONCURRENCY, inlineImages: false });
  console.log(`[aados] body search: indexed ${added}/${todo.length} (${have.size + added} total)`);
}

/** Search words → tsquery: every word must match (prefix match), letters/digits only. */
function toTsQuery(q: string) {
  const pieces = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 12);
  return pieces.map((p) => `${p}:*`).join(' & ');
}

/** Emails whose stored text (subject, sender, recipients, body) contains every search word, as `account\0messageId`. */
export async function bodyMatches(q: string): Promise<Set<string>> {
  const tsq = toTsQuery(q);
  if (!tsq) return new Set();
  try {
    const db = await pool();
    if (!db) return new Set();
    const r = await db.query(`SELECT account_id, provider_message_id FROM mail_bodies WHERE search @@ to_tsquery('simple', $1) LIMIT 5000`, [tsq]);
    return new Set(r.rows.map((x) => `${x.account_id}\u0000${x.provider_message_id}`));
  } catch (cause) {
    console.warn('[aados] body search failed:', cause instanceof Error ? cause.message : cause);
    return new Set();
  }
}

const FETCH_MAX = 40;
/**
 * Plain text per email (`account:messageId` → text) for rule body conditions: from the search index; with `fetch`,
 * emails not indexed yet (new mail) are read from the mailbox (read-only, at most FETCH_MAX) and indexed on the way.
 */
export async function bodyTexts(state: AadOSState, rows: { key: string; accountId: string; messageId: string }[], opts: { fetch?: boolean } = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!rows.length) return out;
  const db = await pool().catch(() => null);
  if (db) {
    const r = await db.query(`SELECT b.account_id, b.provider_message_id, b.text FROM mail_bodies b JOIN unnest($1::text[], $2::text[]) AS k(a, m) ON k.a = b.account_id AND k.m = b.provider_message_id`, [rows.map((x) => x.accountId), rows.map((x) => x.messageId)]).catch(() => ({ rows: [] as any[] }));
    for (const x of r.rows) out.set(`${x.account_id}:${x.provider_message_id}`, String(x.text || ''));
  }
  if (!opts.fetch) return out;
  const missing = new Set(rows.filter((x) => !out.has(x.key)).slice(0, FETCH_MAX).map((x) => x.key));
  if (!missing.size) return out;
  const owner = new Map(state.pipelines.map((p) => [p.id, p.accountId]));
  const items = state.items.filter((i) => missing.has(`${i.accountId || owner.get(i.pipelineId) || ''}:${i.messageId}`));
  await fetchBodies(state, jobsFor(state, items), async ({ item, account }, body) => {
    const text = `${item.subject} ${item.sender} ${item.to || ''} ${body.html ? htmlToText(body.html) : body.text}`.slice(0, MAX_TEXT);
    out.set(`${account.id}:${item.messageId}`, text);
    if (db) await db.query('INSERT INTO mail_bodies (account_id, provider_message_id, text) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [account.id, item.messageId, text]).catch(() => undefined);
  }, { concurrency: CONCURRENCY, inlineImages: false });
  return out;
}
