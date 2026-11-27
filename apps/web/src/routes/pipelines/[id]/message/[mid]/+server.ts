import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readState, updateState, type MailAccount } from '$lib/server/aados-store';
import { fetchZohoBody, setZohoUnread } from '$lib/server/zoho';
import { fetchGmailBody, setGmailUnread } from '$lib/server/gmail';
import { canSeeAccount } from '$lib/server/auth';
import { bodyKey, cachedBody, remember, type Body } from '$lib/server/email-bodies';
import { recordUndo } from '$lib/server/mail-undo';

// Fetches one email body from the mailbox on demand (read-only) and marks it seen in AadOS.
// The mailbox call runs WITHOUT the state lock (it used to hold it, so every preview queued behind
// syncs, deletes and other previews); "seen" and any refreshed token are saved afterwards, in the
// background. Bodies never change, so they are cached in memory and in the browser.
// `?prefetch=1` warms the cache for the next email without marking it seen.
declare global { var __aadosSeen: Set<string> | undefined; }
const headers = { 'cache-control': 'private, max-age=600' };

/** Background save: item seen (+ folder found by the Zoho lookup) and a token refreshed during the fetch. */
function persist(pipelineId: string, messageId: string, change: { seen: boolean; folderId?: string; account?: MailAccount }) {
  updateState((state) => {
    const item = state.items.find((entry) => entry.pipelineId === pipelineId && entry.messageId === messageId);
    if (item && change.seen) {
      item.seen = true;
      // Read right away on screen (every copy); the mailbox is marked read in the background and the next sync confirms it.
      const acct = item.accountId || state.pipelines.find((p) => p.id === pipelineId)?.accountId;
      for (const i of state.items) if (i.messageId === messageId && (i.accountId || state.pipelines.find((p) => p.id === i.pipelineId)?.accountId) === acct) i.unread = false;
    }
    if (item && change.folderId) item.folderId ||= change.folderId;
    const target = change.account && state.accounts.find((entry) => entry.id === change.account!.id);
    if (target && change.account!.accessToken && target.accessToken !== change.account!.accessToken) { target.accessToken = change.account!.accessToken; target.expiresAt = change.account!.expiresAt; }
  }).catch((cause) => console.warn('[aados] saving preview state failed:', cause instanceof Error ? cause.message : cause));
}

/**
 * Opening an email reads it in the mailbox too (like any mail client), so Gmail/Zoho and other apps stop counting it
 * unread. Background, best effort; only accounts that granted change access. All stored copies follow.
 */
async function markReadInMailbox(pipelineId: string, messageId: string) {
  const state = await readState();
  const pipeline = state.pipelines.find((p) => p.id === pipelineId);
  const item = state.items.find((i) => i.pipelineId === pipelineId && i.messageId === messageId);
  const account = item && state.accounts.find((a) => a.id === (item.accountId || pipeline?.accountId));
  if (!item || !account?.canModify || item.unread === false) return;
  const token = account.accessToken;
  await (account.provider === 'gmail' ? setGmailUnread : setZohoUnread)(state, account, [messageId], false);
  await updateState((s) => {
    const a = s.accounts.find((x) => x.id === account.id);
    if (!a) return;
    if (account.accessToken !== token) { a.accessToken = account.accessToken; a.expiresAt = account.expiresAt; }
    const owner = new Map(s.pipelines.map((p) => [p.id, p.accountId]));
    const folders = new Set<string>();
    const flipped = s.items.filter((i) => i.messageId === messageId && (i.accountId || owner.get(i.pipelineId)) === a.id && i.unread !== false);
    // Opening marked it read: undoable like any mark read (Undo / shake to undo).
    if (flipped.length) recordUndo(s, 'mark-read', [`${a.id}:${messageId}`], flipped);
    for (const i of flipped) { i.unread = false; if (i.folderId) folders.add(i.folderId); }
    a.folders = (a.folders || []).map((f) => (folders.has(f.id) && f.unread ? { ...f, unread: f.unread - 1 } : f));
  });
}
const readInMailbox = (pipelineId: string, messageId: string) =>
  void markReadInMailbox(pipelineId, messageId).catch((cause) => console.warn('[aados] mark read in mailbox failed:', cause instanceof Error ? cause.message : cause));

export const GET: RequestHandler = async ({ params, url, locals }) => {
  // Family members: only mail from mailboxes they were given.
  if (!locals.user?.owner) {
    const s = await readState(), p = s.pipelines.find((x) => x.id === params.id), it = s.items.find((x) => x.pipelineId === params.id && x.messageId === params.mid);
    if (!it || !canSeeAccount(locals.user, it.accountId || p?.accountId || '')) throw error(404, 'Email not found');
  }
  const prefetch = url.searchParams.has('prefetch');
  const key = bodyKey(params.id, params.mid);
  const seen = (globalThis.__aadosSeen ??= new Set());
  const cached = cachedBody(key);
  if (cached) {
    if (!prefetch && !seen.has(key)) { seen.add(key); persist(params.id, params.mid, { seen: true }); readInMailbox(params.id, params.mid); }
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
    const markSeen = !prefetch && (!item.seen || item.unread !== false);
    const tokenChanged = account.accessToken !== token, folderFound = item.folderId !== folderId ? item.folderId : undefined;
    if (markSeen || tokenChanged || folderFound) persist(params.id, params.mid, { seen: markSeen, folderId: folderFound, account: tokenChanged ? account : undefined });
    if (markSeen) readInMailbox(params.id, params.mid);
    if (!prefetch) seen.add(key);
  } catch (cause) {
    throw error(502, cause instanceof Error ? cause.message : 'Could not load this email.');
  }
  remember(key, body);
  return json(body, { headers });
};
