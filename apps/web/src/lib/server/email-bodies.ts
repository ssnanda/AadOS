import { readState, updateState, type AadOSState, type MailAccount, type Pipeline, type PipelineItem } from '$lib/server/aados-store';
import { fetchZohoBody } from '$lib/server/zoho';
import { fetchGmailBody } from '$lib/server/gmail';
import { isUnread } from '$lib/server/search';

// In-memory cache of email bodies (bodies never change), shared by the preview route and the unread warm-up.
// Warm-up fetches text/HTML only: remote images are not loaded, so senders' trackers see nothing until an email is opened.
export type Body = { html: string; text: string };
declare global { var __aadosBodies: Map<string, Body> | undefined; var __aadosBodyBytes: number | undefined; var __aadosWarming: boolean | undefined; }
const MAX_CACHED = 600, MAX_BODY_BYTES = 1_000_000, MAX_TOTAL_BYTES = 120_000_000, CONCURRENCY = 3;

const sizeOf = (b: Body) => b.html.length + b.text.length;
export const bodyKey = (pipelineId: string, messageId: string) => `${pipelineId}\u0000${messageId}`;
export const cachedBody = (key: string) => globalThis.__aadosBodies?.get(key);

export function remember(key: string, body: Body) {
  const cache = (globalThis.__aadosBodies ??= new Map());
  if (sizeOf(body) > MAX_BODY_BYTES) return;
  const old = cache.get(key);
  if (old) { cache.delete(key); globalThis.__aadosBodyBytes = (globalThis.__aadosBodyBytes || 0) - sizeOf(old); }
  cache.set(key, body); globalThis.__aadosBodyBytes = (globalThis.__aadosBodyBytes || 0) + sizeOf(body);
  while (cache.size > MAX_CACHED || (globalThis.__aadosBodyBytes || 0) > MAX_TOTAL_BYTES) {
    const [k, v] = cache.entries().next().value!;
    cache.delete(k); globalThis.__aadosBodyBytes = (globalThis.__aadosBodyBytes || 0) - sizeOf(v);
  }
}

/**
 * Background, read-only: (1) load every unread email's body (all accounts) into the cache, newest first; then
 * (2) add email text to the PostgreSQL search index (body-index.ts). Never marks anything seen or read and never
 * touches the mailboxes beyond reading. One run at a time; cached/indexed bodies are skipped.
 * The cache is server-side only; the preview route still checks who may read each email.
 */
export function warmUnread() {
  if (globalThis.__aadosWarming) return;
  globalThis.__aadosWarming = true;
  (async () => {
    await run().catch((cause) => console.warn('[aados] unread warm-up failed:', cause instanceof Error ? cause.message : cause));
    const { indexBodies } = await import('./body-index');
    await indexBodies().catch((cause) => console.warn('[aados] body index failed:', cause instanceof Error ? cause.message : cause));
  })().finally(() => { globalThis.__aadosWarming = false; });
}

export type Job = { item: PipelineItem; pipeline: Pipeline; account: MailAccount };
/** Unique (account, message) jobs for the given items, newest first; skips paused/disconnected accounts. */
export function jobsFor(state: AadOSState, items: PipelineItem[]): Job[] {
  const pipelines = new Map(state.pipelines.map((p) => [p.id, p]));
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const seen = new Set<string>(), out: Job[] = [];
  for (const item of [...items].sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))) {
    const pipeline = pipelines.get(item.pipelineId);
    const account = accounts.get(item.accountId || pipeline?.accountId || '');
    if (!pipeline || !account || account.paused) continue;
    const k = `${account.id}\u0000${item.messageId}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ item, pipeline, account });
  }
  return out;
}

/**
 * Read-only fetch of many bodies, `concurrency` at a time. Cached bodies are reused. Tokens refreshed and Zoho
 * folders found along the way are saved once at the end.
 */
export async function fetchBodies(state: AadOSState, jobs: Job[], onBody: (job: Job, body: Body) => Promise<void> | void, opts: { concurrency?: number; inlineImages?: boolean } = {}) {
  const queue = [...jobs];
  const tokens = new Map(state.accounts.map((a) => [a.id, a.accessToken]));
  const folders = new Map<string, string>();
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { item, pipeline, account } = job, key = bodyKey(item.pipelineId, item.messageId), before = item.folderId;
      try {
        const body = cachedBody(key) ?? (account.provider === 'gmail' ? await fetchGmailBody(state, account, item, { inlineImages: opts.inlineImages ?? true }) : await fetchZohoBody(state, account, pipeline, item));
        await onBody(job, body);
        if (item.folderId && item.folderId !== before) folders.set(key, item.folderId);
      } catch { /* skip; retried on a later run, or fetched when opened */ }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? CONCURRENCY }, worker));
  const changed = state.accounts.filter((a) => a.accessToken && a.accessToken !== tokens.get(a.id));
  if (!changed.length && !folders.size) return;
  await updateState((s) => {
    for (const a of changed) { const t = s.accounts.find((x) => x.id === a.id); if (t) { t.accessToken = a.accessToken; t.expiresAt = a.expiresAt; } }
    for (const i of s.items) { const f = folders.get(bodyKey(i.pipelineId, i.messageId)); if (f) i.folderId ||= f; }
  });
}

async function run() {
  const state = await readState();
  const jobs = jobsFor(state, state.items.filter(isUnread)).filter((j) => !cachedBody(bodyKey(j.item.pipelineId, j.item.messageId)));
  await fetchBodies(state, jobs, ({ item }, body) => remember(bodyKey(item.pipelineId, item.messageId), body));
}
