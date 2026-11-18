import { createHash, randomBytes } from 'node:crypto';
import { fetchRetry, needsReconnect } from './retry';
import { addFlow, consumeFlow } from './oauth-state';
import { accountId, applyUnread, pipelineFolders, knownMessageIds, pruneFolderWindow, removeFromFolder, type AadOSState, type MailAccount, type PageResult, type Pipeline, type PipelineItem } from './aados-store';
import { clean, parseMessage } from './pipeline-parser';
import { foldHistory } from './gmail-history';

async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.error?.message || body.error || `Google HTTP ${response.status}`);
  return body;
}

/** Gmail API fetch with bounded retry/backoff for rate limits and 5xx. */
export const gmailFetch = (url: string, init: RequestInit) => fetchRetry(url, init);

export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
/** Needed only to move mail to Trash and mark read/unread (never permanent delete, never send). */
export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
/** Create/delete Gmail filters (Rules). */
export const GMAIL_SETTINGS_SCOPE = 'https://www.googleapis.com/auth/gmail.settings.basic';
export const GMAIL_SCOPE = `${GMAIL_READ_SCOPE} ${GMAIL_MODIFY_SCOPE} ${GMAIL_SETTINGS_SCOPE}`;
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
/** Create/edit/delete events (requested with the read scope; calendarList itself needs the read scope). */
export const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
/** Google Contacts, read-only (People API) — names for phone numbers and addresses. */
export const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';

export function beginGmailOAuth(state: AadOSState, redirectUri: string, opts: { calendar?: boolean; contacts?: boolean; loginHint?: string; owner?: string } = {}) {
  // One entry per connect attempt, so parallel flows cannot overwrite each other. PKCE (S256): the verifier stays server-side.
  const token = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  addFlow((state.gmail.pending ||= {}), token, verifier, Date.now(), opts.owner);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: state.gmail.clientId, redirect_uri: redirectUri, response_type: 'code', scope: [GMAIL_SCOPE, ...(opts.calendar ? [CALENDAR_SCOPE, CALENDAR_WRITE_SCOPE] : []), ...(opts.contacts ? [CONTACTS_SCOPE] : [])].join(' '), access_type: 'offline', prompt: 'consent select_account', // incremental auth: a plain reconnect keeps the calendar scope already granted
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
  account.calendarWrite = String(tokens.scope || '').split(' ').includes(CALENDAR_WRITE_SCOPE);
  account.contacts = String(tokens.scope || '').split(' ').includes(CONTACTS_SCOPE);
  const granted = String(tokens.scope || '').split(' ');
  account.canModify = granted.includes(GMAIL_MODIFY_SCOPE);
  account.canSend = granted.includes(GMAIL_MODIFY_SCOPE) || granted.includes('https://www.googleapis.com/auth/gmail.send');
  account.canFilter = granted.includes(GMAIL_SETTINGS_SCOPE);
  // An account belongs to whoever linked it first; nobody else can take it over by connecting it again.
  if (existing && (existing.ownerId || '') !== (flow.owner || '')) throw new Error(`${account.email} is already connected in AadOS by someone else.`);
  if (flow.owner) account.ownerId = flow.owner;
  if (existing) Object.assign(existing, account, { refreshToken: account.refreshToken || existing.refreshToken });
  else if (!account.refreshToken) throw new Error('Google did not return a refresh token. Remove AadOS from your Google account permissions and try again.');
  else state.accounts.push(account);
  return { owner: flow.owner || '', accountId: account.id };
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
    for (const item of items) { item.accountId = account.id; item.folderId = folderId; item.threadId = threads.get(item.messageId) || undefined; }
    state.items.push(...items);
  }
  return { scanned: rows.length, added: fresh.length, unknown: unknownIds.length, next: String(list.nextPageToken || ''), ids: rows.map((row) => String(row.id || '')).filter(Boolean) };
}

/** Search the whole Gmail mailbox (Gmail search syntax, excluding Trash/Spam) and store up to 50 matches in the inbox feed. */
export async function searchGmail(state: AadOSState, account: MailAccount, pipeline: Pipeline, q: string) {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const known = knownMessageIds(state, pipeline.id);
  const list = await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: (q.match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ? `from:${q.match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/i)![0]}` : q.replace(/[<>"]/g, ' ')), maxResults: '50' })}`, { headers }));
  const rows: Record<string, unknown>[] = Array.isArray(list.messages) ? list.messages : [];
  const fresh = rows.map((r) => String(r.id || '')).filter((id) => id && !known.has(id));
  const threads = new Map(rows.map((row) => [String(row.id || ''), String(row.threadId || '')]));
  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    const items = await Promise.all(fresh.slice(i, i + CONCURRENCY).map((id) => gmailItem(headers, pipeline, id)));
    for (const item of items) { item.accountId = account.id; item.folderId ||= 'INBOX'; item.threadId = threads.get(item.messageId) || undefined; }
    state.items.push(...items);
  }
  return { added: fresh.length, found: rows.length };
}

// Unread mail older than the stored window is fetched too, so the unread list is complete (capped per run).
const UNREAD_FETCH = 200;

/**
 * Align stored read state with Gmail's UNREAD list for this label (all pages, or nothing is applied), store unread
 * mail AadOS never fetched (older than the newest page), and record the label's unread count for the sidebar.
 */
export async function reconcileGmailUnread(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const unread = new Map<string, string>();
  let pageToken = '';
  for (let n = 0; n < MAX_PAGES; n++) {
    const query = new URLSearchParams({ maxResults: '500' });
    query.append('labelIds', folderId);
    if (folderId !== 'UNREAD') query.append('labelIds', 'UNREAD');
    if (pageToken) query.set('pageToken', pageToken);
    const list = await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers }));
    for (const row of Array.isArray(list.messages) ? list.messages : []) if (row.id) unread.set(String(row.id), String(row.threadId || ''));
    pageToken = String(list.nextPageToken || '');
    if (pageToken) continue;
    const known = knownMessageIds(state, pipeline.id);
    const fresh = [...unread.keys()].filter((id) => !known.has(id)).slice(0, UNREAD_FETCH);
    for (let i = 0; i < fresh.length; i += CONCURRENCY) {
      const items = await Promise.all(fresh.slice(i, i + CONCURRENCY).map((id) => gmailItem(headers, pipeline, id)));
      for (const item of items) { item.accountId = account.id; item.folderId = folderId; item.threadId = unread.get(item.messageId) || undefined; }
      state.items.push(...items);
    }
    applyUnread(state, pipeline, folderId, new Set(unread.keys()), account.id);
    account.folders = (account.folders || []).map((f) => (f.id === folderId ? { ...f, unread: unread.size } : f));
    return { added: fresh.length };
  }
  return { added: 0 };
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
  const delta = foldHistory(pages as Record<string, any>[], folderId);
  const known = knownMessageIds(state, pipeline.id);
  const fresh = delta.added.filter((id) => !known.has(id));
  const batch = fresh.slice(0, SYNC_BATCH);
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const items = await Promise.all(batch.slice(i, i + CONCURRENCY).map((id) => gmailItem(headers, pipeline, id)));
    for (const item of items) { item.accountId = account.id; item.folderId = folderId; }
    state.items.push(...items);
  }
  // Mail that left the label in Gmail (deleted, trashed, moved — e.g. on the phone).
  const removed = removeFromFolder(state, pipeline, folderId, new Set(delta.removed), account.id);
  // Read/unread changes made in Gmail since the checkpoint.
  for (const item of state.items) if ((item.accountId || pipeline.accountId) === account.id && item.messageId in delta.unread) item.unread = delta.unread[item.messageId];
  // Only advance when everything new was ingested; otherwise the next run continues from the same point.
  if (fresh.length <= SYNC_BATCH && delta.historyId) account.historyIds![folderId] = delta.historyId;
  return { scanned: delta.added.length, added: batch.length, removed };
}

// Newest messages a live (open-folder) sync looks at. It never walks the whole label.
const LIVE_BATCH = 50;

/**
 * Live sync of one open label, the way a mail client refreshes the folder on screen: Gmail history since
 * the checkpoint, then the newest page (new mail + anything that left the label). First run per label
 * also aligns unread state and sets the history checkpoint.
 */
export async function liveGmailLabel(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  const history = await syncGmailHistory(state, account, pipeline, folderId);
  const startId = history ? '' : await currentHistoryId({ Authorization: `Bearer ${await token(state, account)}` }).catch(() => '');
  const page = await syncGmailPage(state, account, pipeline, folderId, '0', LIVE_BATCH);
  const removed = (history?.removed || 0) + pruneFolderWindow(state, pipeline, folderId, account.id, page.ids || [], !page.next);
  // Every refresh: the label's full unread list (one cheap call for most inboxes), so older unread mail shows and counts.
  const unread = await reconcileGmailUnread(state, account, pipeline, folderId);
  if (!history && startId) (account.historyIds ||= {})[folderId] = startId;
  return { scanned: page.scanned, added: (history?.added || 0) + page.added + unread.added, removed };
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

/** Move a message to Gmail's Trash (users.messages.trash; recoverable for 30 days). Requires gmail.modify. */
export async function trashGmailMessage(state: AadOSState, account: MailAccount, messageId: string): Promise<void> {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/trash`, { method: 'POST', headers }));
}
/** Mark messages read/unread in Gmail (users.messages.batchModify on the UNREAD label). Requires gmail.modify. */
export async function setGmailUnread(state: AadOSState, account: MailAccount, messageIds: string[], unread: boolean): Promise<void> {
  if (!messageIds.length) return;
  const headers = { Authorization: `Bearer ${await token(state, account)}`, 'Content-Type': 'application/json' };
  for (let i = 0; i < messageIds.length; i += 1000) {
    const body = JSON.stringify({ ids: messageIds.slice(i, i + 1000), ...(unread ? { addLabelIds: ['UNREAD'] } : { removeLabelIds: ['UNREAD'] }) });
    const res = await gmailFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', { method: 'POST', headers, body });
    if (!res.ok) await json(res); // throws with Google's message
  }
}

const HEADER_NAMES = ['From', 'To', 'Cc', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'References', 'List-Unsubscribe'];
/** Selected headers of one message (lower-case names). */
export async function gmailHeaders(state: AadOSState, account: MailAccount, messageId: string): Promise<{ headers: Record<string, string>; threadId: string }> {
  const auth = { Authorization: `Bearer ${await token(state, account)}` };
  const q = new URLSearchParams({ format: 'metadata' });
  for (const h of HEADER_NAMES) q.append('metadataHeaders', h);
  const m = await json(await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?${q}`, { headers: auth }));
  const headers: Record<string, string> = {};
  for (const h of m.payload?.headers || []) headers[String(h.name).toLowerCase()] = String(h.value || '');
  return { headers, threadId: String(m.threadId || '') };
}
/** Send a message the owner composed (users.messages.send). `threadId` keeps a reply in its conversation. */
export async function sendGmail(state: AadOSState, account: MailAccount, rawMime: string, threadId = ''): Promise<string> {
  const auth = { Authorization: `Bearer ${await token(state, account)}`, 'Content-Type': 'application/json' };
  const r = await json(await gmailFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: auth, body: JSON.stringify({ raw: Buffer.from(rawMime, 'utf8').toString('base64url'), ...(threadId ? { threadId } : {}) }) }));
  return String(r.id || '');
}
export type GmailFilter = { id: string; criteria: { from?: string; to?: string; subject?: string; query?: string }; action: { addLabelIds?: string[]; removeLabelIds?: string[] } };
/** Gmail filters (Settings → Filters) — the server-side rules. Requires gmail.settings.basic. */
export async function listGmailFilters(state: AadOSState, account: MailAccount): Promise<GmailFilter[]> {
  const r = await json(await gmailFetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/filters', { headers: { Authorization: `Bearer ${await token(state, account)}` } }));
  return Array.isArray(r.filter) ? r.filter : [];
}
export async function createGmailFilter(state: AadOSState, account: MailAccount, f: Omit<GmailFilter, 'id'>): Promise<GmailFilter> {
  return json(await gmailFetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/filters', { method: 'POST', headers: { Authorization: `Bearer ${await token(state, account)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(f) }));
}
export async function deleteGmailFilter(state: AadOSState, account: MailAccount, id: string): Promise<void> {
  const res = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/settings/filters/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await token(state, account)}` } });
  if (!res.ok && res.status !== 404) await json(res);
}

/** Google Contacts (People API, read-only): every connection's name with its phone numbers and emails. */
export async function googleContacts(state: AadOSState, account: MailAccount): Promise<{ name: string; phones: string[]; emails: string[] }[]> {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const out: { name: string; phones: string[]; emails: string[] }[] = [];
  let pageToken = '';
  for (let n = 0; n < 20; n++) {
    const q = new URLSearchParams({ personFields: 'names,phoneNumbers,emailAddresses', pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
    const body = await json(await gmailFetch(`https://people.googleapis.com/v1/people/me/connections?${q}`, { headers }));
    for (const p of body.connections || []) {
      const name = String(p.names?.[0]?.displayName || '').trim();
      if (name) out.push({ name, phones: (p.phoneNumbers || []).map((x: any) => String(x.canonicalForm || x.value || '')).filter(Boolean), emails: (p.emailAddresses || []).map((x: any) => String(x.value || '')).filter(Boolean) });
    }
    pageToken = String(body.nextPageToken || '');
    if (!pageToken) break;
  }
  return out;
}
