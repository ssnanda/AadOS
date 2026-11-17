import { createHash, randomBytes } from 'node:crypto';
import { fetchRetry, needsReconnect } from './retry';
import { addFlow, consumeFlow } from './oauth-state';
import { accountId, applyUnread, pipelineFolders, knownMessageIds, type AadOSState, type MailAccount, type PageResult, type Pipeline, type PipelineItem } from './aados-store';
import { clean, parseMessage } from './pipeline-parser';
import { foldHistory } from './gmail-history';

async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.error?.message || body.error || `Google HTTP ${response.status}`);
  return body;
}

/** Gmail API fetch with bounded retry/backoff for rate limits and 5xx. */
export const gmailFetch = (url: string, init: RequestInit) => fetchRetry(url, init);

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export function beginGmailOAuth(state: AadOSState, redirectUri: string, opts: { calendar?: boolean; loginHint?: string } = {}) {
  // One entry per connect attempt, so parallel flows cannot overwrite each other. PKCE (S256): the verifier stays server-side.
  const token = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  addFlow((state.gmail.pending ||= {}), token, verifier);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: state.gmail.clientId, redirect_uri: redirectUri, response_type: 'code', scope: opts.calendar ? `${GMAIL_SCOPE} ${CALENDAR_SCOPE}` : GMAIL_SCOPE, access_type: 'offline', prompt: 'consent select_account', // incremental auth: a plain reconnect keeps the calendar scope already granted
    include_granted_scopes: 'true', state: token, code_challenge: challenge, code_challenge_method: 'S256', ...(opts.loginHint ? { login_hint: opts.loginHint } : {}) })}`;
}

export async function finishGmailOAuth(state: AadOSState, code: string, returnedState: string, redirectUri: string) {
  const flow = consumeFlow((state.gmail.pending ||= {}), returnedState);
  if (!flow) throw new Error('Gmail OAuth state is invalid or expired');
  const tokens = await json(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: state.gmail.clientId, client_secret: state.gmail.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', ...(flow.verifier ? { code_verifier: flow.verifier } : {}) }), signal: AbortSignal.timeout(15000) }));
  // Identify the mailbox first, then add it or refresh the tokens of an existing one.
  const account: MailAccount = { id: '', provider: 'gmail', email: '', remoteId: '', accessToken: String(tokens.access_token || ''), refreshToken: String(tokens.refresh_token || ''), expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000, folders: [] };
  await discoverGmailFolders(state, account);
  account.id = accountId('gmail', account.email);
  const existing = state.accounts.find((item) => item.id === account.id);
  // Calendar access exists only if Google actually granted the scope.
  account.calendar = String(tokens.scope || '').split(' ').includes(CALENDAR_SCOPE);
  if (existing) Object.assign(existing, account, { refreshToken: account.refreshToken || existing.refreshToken });
  else if (!account.refreshToken) throw new Error('Google did not return a refresh token. Remove AadOS from your Google account permissions and try again.');
  else state.accounts.push(account);
}

export async function gmailAccessToken(state: AadOSState, account: MailAccount) { return token(state, account); }

async function token(state: AadOSState, account: MailAccount) {
  if (account.accessToken && account.expiresAt > Date.now() + 60_000) return account.accessToken;
  if (!account.refreshToken) throw new Error(`Gmail account ${account.email} is not connected`);
  let tokens: Record<string, any>;
  try { tokens = await json(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: account.refreshToken, client_id: state.gmail.clientId, client_secret: state.gmail.clientSecret, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15000) })) ; }
  catch (cause) { const message = cause instanceof Error ? cause.message : 'Token refresh failed'; throw new Error(needsReconnect(message) ? `Gmail sign-in for ${account.email} expired or was revoked. Reconnect it in Settings → Emails.` : message); }
  account.accessToken = String(tokens.access_token || ''); account.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000; return account.accessToken;
}

export async function discoverGmailFolders(state: AadOSState, account: MailAccount) {
  const access = await token(state, account);
  const headers = { Authorization: `Bearer ${access}` };
  const [profile, labels] = await Promise.all([json(await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers })), json(await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers }))]);
  account.email = String(profile.emailAddress || '');
  // User labels plus the useful system ones (Inbox, Starred, Important, Sent, Gmail's inbox categories); never Spam/Trash/Drafts.
  const SYSTEM: Record<string, string> = { INBOX: 'Inbox', STARRED: 'Starred', IMPORTANT: 'Important', SENT: 'Sent', CATEGORY_PERSONAL: 'Category: Personal', CATEGORY_UPDATES: 'Category: Updates', CATEGORY_PROMOTIONS: 'Category: Promotions', CATEGORY_SOCIAL: 'Category: Social', CATEGORY_FORUMS: 'Category: Forums' };
  account.folders = (labels.labels || []).filter((label: Record<string, unknown>) => label.type === 'user' || (label.type === 'system' && String(label.id) in SYSTEM)).map((label: Record<string, unknown>) => ({ id: String(label.id), name: label.type === 'system' ? SYSTEM[String(label.id)] : String(label.name), path: label.type === 'system' ? SYSTEM[String(label.id)] : String(label.name), type: label.type === 'system' ? 'system' : 'label' }));
}

export async function syncGmailPipeline(state: AadOSState, pipeline: Pipeline, only?: (accountId: string) => boolean) {
  let scanned = 0;
  let added = 0;
  for (const folder of pipelineFolders(pipeline).filter((item) => item.source === 'gmail' && (!only || only(item.accountId)))) {
    const account = state.accounts.find((item) => item.id === folder.accountId && item.provider === 'gmail');
    if (!account) continue;
    const result = await syncGmailLabel(state, account, pipeline, folder.id);
    scanned += result.scanned;
    added += result.added;
  }
  pipeline.lastSync = new Date().toISOString();
  pipeline.lastError = '';
  return { scanned, added };
}

// Request-bound syncs (Sync button, schedule) add at most this many per label; the
// background full sync (sync-job.ts) has no cap.
const SYNC_BATCH = 100;
const MAX_PAGES = 200;
const CONCURRENCY = 4;

async function gmailItem(headers: Record<string, string>, pipeline: Pipeline, messageId: string): Promise<PipelineItem> {
  const message = await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, { headers }));
  const messageHeaders = Array.isArray(message.payload?.headers) ? message.payload.headers : [];
  const header = (name: string) => String(messageHeaders.find((item: Record<string, unknown>) => String(item.name).toLowerCase() === name.toLowerCase())?.value || '');
  const subject = clean(header('Subject'));
  const sender = clean(header('From'));
  const summary = clean(message.snippet);
  const parsed = parseMessage(pipeline.parser, { subject, sender, summary });
  const receivedAt = new Date(Number(message.internalDate || Date.now())).toISOString();
  return { id: `${pipeline.id}:${messageId}`, pipelineId: pipeline.id, messageId, subject, sender, receivedAt, summary, kind: parsed.kind, stage: 'new', unread: Array.isArray(message.labelIds) && message.labelIds.includes('UNREAD'), threadId: message.threadId ? String(message.threadId) : undefined, facts: parsed.facts };
}

/** Fetch one page of a label (cursor '0' = first page, else Gmail's pageToken) and store unknown messages. */
export async function syncGmailPage(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string, cursor: string, maxAdd = Infinity): Promise<PageResult> {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const known = knownMessageIds(state, pipeline.id);
  const query = new URLSearchParams({ labelIds: folderId, maxResults: '100' });
  if (cursor && cursor !== '0') query.set('pageToken', cursor);
  const list = await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers }));
  const rows: Record<string, unknown>[] = Array.isArray(list.messages) ? list.messages : [];
  const unknownIds = rows.map((row) => String(row.id || '')).filter((id) => id && !known.has(id));
  const fresh = unknownIds.slice(0, maxAdd);
  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    const items = await Promise.all(fresh.slice(i, i + CONCURRENCY).map((id) => gmailItem(headers, pipeline, id)));
    const threads = new Map(rows.map((row) => [String(row.id || ''), String(row.threadId || '')]));
    for (const item of items) { item.accountId = account.id; item.threadId = threads.get(item.messageId) || undefined; }
    state.items.push(...items);
  }
  return { scanned: rows.length, added: fresh.length, unknown: unknownIds.length, next: String(list.nextPageToken || '') };
}

/** Align stored read state with Gmail's UNREAD list for this label (all pages, or nothing is applied). */
export async function reconcileGmailUnread(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const unread = new Set<string>();
  let pageToken = '';
  for (let n = 0; n < MAX_PAGES; n++) {
    const query = new URLSearchParams({ maxResults: '500' });
    query.append('labelIds', folderId);
    if (folderId !== 'UNREAD') query.append('labelIds', 'UNREAD');
    if (pageToken) query.set('pageToken', pageToken);
    const list = await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers }));
    for (const row of Array.isArray(list.messages) ? list.messages : []) unread.add(String(row.id || ''));
    pageToken = String(list.nextPageToken || '');
    if (!pageToken) { applyUnread(state, pipeline, folderId, unread, account.id); return; }
  }
}

/** Mailbox-wide history cursor (users.getProfile.historyId). */
async function currentHistoryId(headers: Record<string, string>): Promise<string> {
  const profile = await json(await gmailFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers }));
  return String(profile.historyId || '');
}

/**
 * Supported incremental path (users.history.list from the stored historyId). Returns null when there is no usable
 * checkpoint (never synced, or Gmail answered 404 because the history is too old) so the caller falls back to a scan.
 */
async function syncGmailHistory(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  const checkpoint = account.historyIds?.[folderId];
  if (!checkpoint) return null;
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const pages: Record<string, unknown>[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ startHistoryId: checkpoint, labelId: folderId, maxResults: '500' });
    for (const type of ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']) query.append('historyTypes', type);
    if (pageToken) query.set('pageToken', pageToken);
    const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/history?${query}`, { headers });
    if (response.status === 404) { delete account.historyIds![folderId]; return null; }
    const page = await json(response);
    pages.push(page); pageToken = String(page.nextPageToken || '');
  } while (pageToken);
  const delta = foldHistory(pages as Record<string, any>[]);
  const known = knownMessageIds(state, pipeline.id);
  const fresh = delta.added.filter((id) => !known.has(id));
  const batch = fresh.slice(0, SYNC_BATCH);
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const items = await Promise.all(batch.slice(i, i + CONCURRENCY).map((id) => gmailItem(headers, pipeline, id)));
    for (const item of items) item.accountId = account.id;
    state.items.push(...items);
  }
  // Read/unread changes made in Gmail since the checkpoint.
  for (const item of state.items) if ((item.accountId || pipeline.accountId) === account.id && item.messageId in delta.unread) item.unread = delta.unread[item.messageId];
  // Only advance when everything new was ingested; otherwise the next run continues from the same point.
  if (fresh.length <= SYNC_BATCH && delta.historyId) account.historyIds![folderId] = delta.historyId;
  return { scanned: delta.added.length, added: batch.length };
}

// Incremental: history API when a checkpoint exists, else walk from the newest page and stop at the first page that is already known.
async function syncGmailLabel(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  const viaHistory = await syncGmailHistory(state, account, pipeline, folderId);
  if (viaHistory) return viaHistory;
  // Capture the cursor BEFORE scanning so changes made during the scan are replayed by the next history call.
  const startId = await currentHistoryId({ Authorization: `Bearer ${await token(state, account)}` }).catch(() => '');
  let cursor = '0', scanned = 0, added = 0;
  for (let n = 0; cursor && n < MAX_PAGES && added < SYNC_BATCH; n++) {
    const result = await syncGmailPage(state, account, pipeline, folderId, cursor, SYNC_BATCH - added);
    scanned += result.scanned; added += result.added;
    if (result.unknown === 0) break;
    cursor = result.next;
  }
  await reconcileGmailUnread(state, account, pipeline, folderId);
  if (startId) (account.historyIds ||= {})[folderId] = startId;
  return { scanned, added };
}

/** Fetch one message body on demand (prefers HTML, falls back to plain text). */
export async function fetchGmailBody(state: AadOSState, account: MailAccount, item: PipelineItem): Promise<{ html: string; text: string }> {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const message = await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.messageId)}?format=full`, { headers }));
  const found: Record<string, string> = {};
  const walk = (part: Record<string, any> | undefined) => {
    if (!part) return;
    const type = String(part.mimeType || '');
    if (part.body?.data && (type === 'text/html' || type === 'text/plain') && !found[type]) found[type] = Buffer.from(String(part.body.data), 'base64url').toString('utf8');
    for (const child of part.parts || []) walk(child);
  };
  walk(message.payload);
  return { html: found['text/html'] || '', text: found['text/plain'] || '' };
}

export type AttachmentInfo = { id: string; name: string; size: number; mime: string };
/** Read-only: list a message's real attachments (users.messages.get format=full; parts with a filename + attachmentId). */
export async function listGmailAttachments(state: AadOSState, account: MailAccount, messageId: string): Promise<AttachmentInfo[]> {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const message = await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, { headers }));
  const out: AttachmentInfo[] = [];
  const walk = (part: Record<string, any> | undefined) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) out.push({ id: String(part.body.attachmentId), name: String(part.filename), size: Number(part.body.size) || 0, mime: String(part.mimeType || '') });
    for (const child of part.parts || []) walk(child);
  };
  walk(message.payload);
  return out;
}
/** Read-only: one attachment's bytes (users.messages.attachments.get; base64url data). */
export async function fetchGmailAttachment(state: AadOSState, account: MailAccount, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const body = await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers }));
  return Buffer.from(String(body.data || ''), 'base64url');
}
