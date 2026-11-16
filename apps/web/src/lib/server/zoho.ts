import { randomBytes } from 'node:crypto';
import { accountId, applyUnread, pipelineFolders, knownMessageIds, type AadOSState, type MailAccount, type PageResult, type Pipeline, type PipelineItem, type ZohoFolder } from './aados-store';
import { clean, parseMessage } from './pipeline-parser';
import { fetchRetry, needsReconnect } from './retry';
import { addFlow, consumeFlow } from './oauth-state';

const accountsHost = (dc: string) => `https://accounts.zoho.${dc || 'com'}`;
const mailHost = (dc: string) => `https://mail.zoho.${dc || 'com'}`;

async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (body.status?.code && Number(body.status.code) >= 400)) throw new Error(body.error || body.message || body.status?.description || `Zoho HTTP ${response.status}`);
  return body;
}

export const ZOHO_MAIL_SCOPE = 'ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ';
export const ZOHO_CALENDAR_SCOPE = 'ZohoCalendar.calendar.READ,ZohoCalendar.event.READ';

export function beginOAuth(state: AadOSState, redirectUri: string, opts: { calendar?: boolean } = {}) {
  const token = randomBytes(24).toString('base64url');
  addFlow((state.zoho.pending ||= {}), token);
  const query = new URLSearchParams({
    client_id: state.zoho.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: opts.calendar ? `${ZOHO_MAIL_SCOPE},${ZOHO_CALENDAR_SCOPE}` : ZOHO_MAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: token
  });
  return `${accountsHost(state.zoho.dataCenter)}/oauth/v2/auth?${query}`;
}

export async function finishOAuth(state: AadOSState, code: string, returnedState: string, redirectUri: string) {
  if (!consumeFlow((state.zoho.pending ||= {}), returnedState)) throw new Error('Zoho OAuth state is invalid or expired');
  const form = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: state.zoho.clientId, client_secret: state.zoho.clientSecret, redirect_uri: redirectUri });
  const tokens = await jsonResponse(await fetch(`${accountsHost(state.zoho.dataCenter)}/oauth/v2/token`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) }));
  // Identify the mailbox first, then add it or refresh the tokens of an existing one.
  const account: MailAccount = { id: '', provider: 'zoho', email: '', remoteId: '', accessToken: String(tokens.access_token || ''), refreshToken: String(tokens.refresh_token || ''), expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000, folders: [] };
  await discoverAccountAndFolders(state, account);
  account.id = accountId('zoho', account.email || account.remoteId);
  const existing = state.accounts.find((item) => item.id === account.id);
  account.calendar = String(tokens.scope || '').includes('ZohoCalendar');
  if (existing) Object.assign(existing, account, { refreshToken: account.refreshToken || existing.refreshToken });
  else if (!account.refreshToken) throw new Error('Zoho did not return a refresh token. Remove AadOS from Zoho connected apps and try again.');
  else state.accounts.push(account);
}

export async function zohoAccessToken(state: AadOSState, account: MailAccount) { return accessToken(state, account); }

async function accessToken(state: AadOSState, account: MailAccount) {
  if (account.accessToken && account.expiresAt > Date.now() + 60_000) return account.accessToken;
  if (!account.refreshToken) throw new Error(`Zoho account ${account.email} is not connected`);
  const form = new URLSearchParams({ refresh_token: account.refreshToken, grant_type: 'refresh_token', client_id: state.zoho.clientId, client_secret: state.zoho.clientSecret });
  let tokens: Record<string, any>;
  try { tokens = await jsonResponse(await fetchRetry(`${accountsHost(state.zoho.dataCenter)}/oauth/v2/token`, { method: 'POST', body: form }, { attempts: 3, timeoutMs: 15000 })); }
  catch (cause) { const message = cause instanceof Error ? cause.message : 'Token refresh failed'; throw new Error(needsReconnect(message) ? `Zoho sign-in for ${account.email} expired or was revoked. Reconnect it in Settings → Emails.` : message); }
  if (tokens.error) throw new Error(needsReconnect(String(tokens.error)) ? `Zoho sign-in for ${account.email} expired or was revoked. Reconnect it in Settings → Emails.` : String(tokens.error));
  account.accessToken = String(tokens.access_token || '');
  account.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  return account.accessToken;
}

async function api(state: AadOSState, account: MailAccount, path: string) {
  const call = async () => fetchRetry(`${mailHost(state.zoho.dataCenter)}/api${path}`, { headers: { Authorization: `Zoho-oauthtoken ${await accessToken(state, account)}`, Accept: 'application/json' } });
  let response = await call();
  // A revoked/rotated access token: refresh once and retry before giving up.
  if (response.status === 401 && account.refreshToken) { account.expiresAt = 0; response = await call(); }
  return jsonResponse(response);
}

export async function discoverAccountAndFolders(state: AadOSState, account: MailAccount) {
  const accounts = await api(state, account, '/accounts');
  const rows = Array.isArray(accounts.data) ? accounts.data : [];
  const emailOf = (row: Record<string, unknown>) => String(row.primaryEmailAddress || row.emailAddress || '').toLowerCase();
  // On refresh keep the mailbox already chosen; otherwise take the login's first mailbox.
  const preferred = (account.email && rows.find((row: Record<string, unknown>) => emailOf(row) === account.email.toLowerCase())) || rows[0];
  if (!preferred) throw new Error('Zoho returned no mail accounts');
  account.remoteId = String(preferred.accountId || preferred.accountID || '');
  account.email = String(preferred.primaryEmailAddress || preferred.emailAddress || '');
  const folders = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/folders`);
  account.folders = (Array.isArray(folders.data) ? folders.data : []).map((folder: Record<string, unknown>): ZohoFolder => ({
    id: String(folder.folderId || ''), name: String(folder.folderName || ''), path: String(folder.path || folder.folderName || ''), type: String(folder.folderType || '')
  })).filter((folder: ZohoFolder) => folder.id && folder.name);
}

export async function syncPipeline(state: AadOSState, pipeline: Pipeline, only?: (accountId: string) => boolean) {
  let scanned = 0;
  let added = 0;
  for (const folder of pipelineFolders(pipeline).filter((item) => item.source === 'zoho' && (!only || only(item.accountId)))) {
    const account = state.accounts.find((item) => item.id === folder.accountId && item.provider === 'zoho');
    if (!account) continue;
    const result = await syncFolder(state, account, pipeline, folder.id);
    scanned += result.scanned;
    added += result.added;
  }
  pipeline.cursor = 0;
  pipeline.lastSync = new Date().toISOString();
  pipeline.lastError = '';
  return { scanned, added };
}

// Request-bound syncs (Sync button, schedule) add at most this many per folder; the
// background full sync (sync-job.ts) has no cap.
const SYNC_BATCH = 100;
const PAGE_SIZE = 50;
const MAX_PAGES = 200;
const CONCURRENCY = 4;

async function zohoItem(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string, row: Record<string, unknown>): Promise<PipelineItem> {
  const messageId = String(row.messageId || '');
  const subject = clean(row.subject);
  const sender = clean(row.sender || row.fromAddress || row.from);
  let summary = clean(row.summary || row.snippet);
  let body = '';
  try {
    const content = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`);
    body = String(content.data?.content || content.data?.htmlContent || content.data || '');
    if (!summary) summary = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  } catch { /* A list item is still useful when Zoho withholds message content. */ }
  const parsed = parseMessage(pipeline.parser, { subject, sender, summary, body });
  const rawReceived = Number(row.receivedTime || row.receivedDate || Date.now());
  const receivedAt = new Date(Number.isFinite(rawReceived) ? rawReceived : Date.now()).toISOString();
  return { id: `${pipeline.id}:${messageId}`, pipelineId: pipeline.id, messageId, subject, sender, receivedAt, summary, kind: parsed.kind, stage: 'new', unread: String(row.status) === '0', folderId, facts: parsed.facts };
}

/** Fetch one page of a folder (cursor = page number, newest first) and store unknown messages. */
export async function syncZohoPage(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string, cursor: string, maxAdd = Infinity): Promise<PageResult> {
  const page = Number(cursor) || 0;
  const known = knownMessageIds(state, pipeline.id);
  const query = new URLSearchParams({ folderId, start: String(page * PAGE_SIZE + 1), limit: String(PAGE_SIZE) });
  const response = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/messages/view?${query}`);
  const rows: Record<string, unknown>[] = Array.isArray(response.data) ? response.data : [];
  const unknownRows = rows.filter((row) => { const id = String(row.messageId || ''); return id && !known.has(id); });
  // Refresh read state (and folder) of mail we already have, so reading it in the mailbox clears it here too.
  const mine = new Map(state.items.filter((item) => item.pipelineId === pipeline.id && (item.accountId || pipeline.accountId) === account.id).map((item) => [item.messageId, item]));
  for (const row of rows) {
    const item = mine.get(String(row.messageId || ''));
    if (!item) continue;
    item.unread = String(row.status) === '0';
    item.folderId ||= folderId;
  }
  const fresh = unknownRows.slice(0, maxAdd);
  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    const items = await Promise.all(fresh.slice(i, i + CONCURRENCY).map((row) => zohoItem(state, account, pipeline, folderId, row)));
    for (const item of items) item.accountId = account.id;
    state.items.push(...items);
  }
  return { scanned: rows.length, added: fresh.length, unknown: unknownRows.length, next: rows.length < PAGE_SIZE ? '' : String(page + 1) };
}

/**
 * Re-read the folder's unread list from Zoho and align every stored item with it, so mail read in
 * the mailbox (or never flagged) is counted correctly. Rows are re-checked by their own status, so
 * it stays correct even if Zoho ignores the status filter. Skipped (not applied) if any page fails
 * or the folder is too large to finish, so a partial list never marks unread mail as read.
 */
export async function reconcileZohoUnread(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  const unread = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ folderId, status: 'unread', start: String(page * PAGE_SIZE + 1), limit: String(PAGE_SIZE) });
    const response = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/messages/view?${query}`);
    const rows: Record<string, unknown>[] = Array.isArray(response.data) ? response.data : [];
    for (const row of rows) if (String(row.status) === '0') unread.add(String(row.messageId || ''));
    if (rows.length < PAGE_SIZE) { applyUnread(state, pipeline, folderId, unread, account.id); return; }
  }
}

// Incremental: walk from the newest page and stop at the first page that is already known.
async function syncFolder(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  let cursor = '0', scanned = 0, added = 0;
  for (let n = 0; cursor && n < MAX_PAGES && added < SYNC_BATCH; n++) {
    const result = await syncZohoPage(state, account, pipeline, folderId, cursor, SYNC_BATCH - added);
    scanned += result.scanned; added += result.added;
    if (result.unknown === 0) break;
    cursor = result.next;
  }
  await reconcileZohoUnread(state, account, pipeline, folderId);
  return { scanned, added };
}

/** Fetch one message body (HTML or text) on demand. Tries the stored folder, then the view's folders. */
export async function fetchZohoBody(state: AadOSState, account: MailAccount, pipeline: Pipeline, item: PipelineItem): Promise<{ html: string; text: string }> {
  const folders = [item.folderId, ...pipelineFolders(pipeline).filter((f) => f.accountId === account.id).map((f) => f.id)].filter((id, i, all): id is string => Boolean(id) && all.indexOf(id) === i);
  let last: unknown = new Error('Message not found');
  for (const folderId of folders) {
    try {
      const content = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(item.messageId)}/content`);
      const raw = String(content.data?.content ?? content.data?.htmlContent ?? '');
      item.folderId = folderId;
      return /<[a-z][\s\S]*>/i.test(raw) ? { html: raw, text: '' } : { html: '', text: raw };
    } catch (cause) { last = cause; }
  }
  throw last;
}
