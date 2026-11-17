import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readState, updateState, type MailAccount } from '$lib/server/aados-store';
import { fetchZohoBody } from '$lib/server/zoho';
import { fetchGmailBody } from '$lib/server/gmail';
import { canSeeAccount } from '$lib/server/auth';

// Fetches one email body from the mailbox on demand (read-only) and marks it seen in AadOS.
// The mailbox call runs WITHOUT the state lock (it used to hold it, so every preview queued behind
// syncs, deletes and other previews); "seen" and any refreshed token are saved afterwards, in the
// background. Bodies never change, so they are cached in memory and in the browser.
// `?prefetch=1` warms the cache for the next email without marking it seen.
type Body = { html: string; text: string };
declare global { var __aadosBodies: Map<string, Body> | undefined; var __aadosSeen: Set<string> | undefined; }
const MAX_CACHED = 100, MAX_CACHED_BYTES = 1_000_000;
const headers = { 'cache-control': 'private, max-age=600' };

function remember(key: string, body: Body) {
  const cache = (globalThis.__aadosBodies ??= new Map());
  if (body.html.length + body.text.length > MAX_CACHED_BYTES) return;
  cache.delete(key); cache.set(key, body);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

/** Background save: item seen (+ folder found by the Zoho lookup) and a token refreshed during the fetch. */
function persist(pipelineId: string, messageId: string, change: { seen: boolean; folderId?: string; account?: MailAccount }) {
  updateState((state) => {
    const item = state.items.find((entry) => entry.pipelineId === pipelineId && entry.messageId === messageId);
    if (item && change.seen) item.seen = true;
    if (item && change.folderId) item.folderId ||= change.folderId;
    const target = change.account && state.accounts.find((entry) => entry.id === change.account!.id);
    if (target && change.account!.accessToken && target.accessToken !== change.account!.accessToken) { target.accessToken = change.account!.accessToken; target.expiresAt = change.account!.expiresAt; }
  }).catch((cause) => console.warn('[aados] saving preview state failed:', cause instanceof Error ? cause.message : cause));
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
  // Family members: only mail from mailboxes they were given.
  if (!locals.user?.owner) {
    const s = await readState(), p = s.pipelines.find((x) => x.id === params.id), it = s.items.find((x) => x.pipelineId === params.id && x.messageId === params.mid);
    if (!it || !canSeeAccount(locals.user, it.accountId || p?.accountId || '')) throw error(404, 'Email not found');
  }
  const prefetch = url.searchParams.has('prefetch');
  const key = `${params.id}\u0000${params.mid}`;
  const seen = (globalThis.__aadosSeen ??= new Set());
  const cached = globalThis.__aadosBodies?.get(key);
  if (cached) {
    if (!prefetch && !seen.has(key)) { seen.add(key); persist(params.id, params.mid, { seen: true }); }
    return json(cached, { headers });
  }
  let body: Body;
  try {
    const state = await readState();
    const pipeline = state.pipelines.find((item) => item.id === params.id);
    const item = state.items.find((entry) => entry.pipelineId === params.id && entry.messageId === params.mid);
    if (!pipeline || !item) throw new Error('Email not found');
    const account = state.accounts.find((entry) => entry.id === (item.accountId || pipeline.accountId));
    if (!account) throw new Error('The account for this view is no longer connected.');
    const token = account.accessToken, folderId = item.folderId;
    body = account.provider === 'gmail' ? await fetchGmailBody(state, account, item) : await fetchZohoBody(state, account, pipeline, item);
    const markSeen = !prefetch && !item.seen;
    const tokenChanged = account.accessToken !== token, folderFound = item.folderId !== folderId ? item.folderId : undefined;
    if (markSeen || tokenChanged || folderFound) persist(params.id, params.mid, { seen: markSeen, folderId: folderFound, account: tokenChanged ? account : undefined });
    if (!prefetch) seen.add(key);
  } catch (cause) {
    throw error(502, cause instanceof Error ? cause.message : 'Could not load this email.');
  }
  remember(key, body);
  return json(body, { headers });
};
