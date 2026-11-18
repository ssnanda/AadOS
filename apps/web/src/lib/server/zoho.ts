import { randomBytes } from 'node:crypto';
import { accountId, applyUnread, pipelineFolders, knownMessageIds, pruneFolderWindow, type AadOSState, type MailAccount, type PageResult, type Pipeline, type PipelineItem, type ZohoFolder } from './aados-store';
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

export const ZOHO_MAIL_SCOPE = 'ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.UPDATE,ZohoMail.messages.DELETE,ZohoMail.messages.CREATE';
export const ZOHO_CALENDAR_SCOPE = 'ZohoCalendar.calendar.READ,ZohoCalendar.event.READ,ZohoCalendar.event.CREATE,ZohoCalendar.event.UPDATE,ZohoCalendar.event.DELETE';

export function beginOAuth(state: AadOSState, redirectUri: string, opts: { calendar?: boolean; owner?: string } = {}) {
  const token = randomBytes(24).toString('base64url');
  addFlow((state.zoho.pending ||= {}), token, undefined, Date.now(), opts.owner);
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
  const flow = consumeFlow((state.zoho.pending ||= {}), returnedState);
  if (!flow) throw new Error('Zoho OAuth state is invalid or expired');
  const form = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: state.zoho.clientId, client_secret: state.zoho.clientSecret, redirect_uri: redirectUri });
  const tokens = await jsonResponse(await fetch(`${accountsHost(state.zoho.dataCenter)}/oauth/v2/token`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) }));
  // Identify the mailbox first, then add it or refresh the tokens of an existing one.
  const account: MailAccount = { id: '', provider: 'zoho', email: '', remoteId: '', accessToken: String(tokens.access_token || ''), refreshToken: String(tokens.refresh_token || ''), expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000, folders: [] };
  await discoverAccountAndFolders(state, account);
  account.id = accountId('zoho', account.email || account.remoteId);
  const existing = state.accounts.find((item) => item.id === account.id);
  account.calendar = String(tokens.scope || '').includes('ZohoCalendar');
  account.calendarWrite = /ZohoCalendar\.event\.(ALL|CREATE)/.test(String(tokens.scope || ''));
  account.canSend = /messages\.(ALL|CREATE)/.test(String(tokens.scope || ''));
  account.canModify = /messages\.(ALL|UPDATE)/.test(String(tokens.scope || '')) && /messages\.(ALL|DELETE)/.test(String(tokens.scope || ''));
  if (existing && (existing.ownerId || '') !== (flow.owner || '')) throw new Error(`${account.email} is already connected in AadOS by someone else.`);
  if (flow.owner) account.ownerId = flow.owner;
  if (existing) Object.assign(existing, account, { refreshToken: account.refreshToken || existing.refreshToken });
  else if (!account.refreshToken) throw new Error('Zoho did not return a refresh token. Remove AadOS from Zoho connected apps and try again.');
  else state.accounts.push(account);
  return { owner: flow.owner || '', accountId: account.id };
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

/** Any Zoho Mail API call (path after /api), refreshing the token once on 401. Used by the shared-mailbox client. */
export async function zohoRequest(state: AadOSState, account: MailAccount, method: string, path: string): Promise<any> {
  const call = async () => fetchRetry(`${mailHost(state.zoho.dataCenter)}/api${path}`, { method, headers: { Authorization: `Zoho-oauthtoken ${await accessToken(state, account)}`, Accept: 'application/json' } });
  let response = await call();
  if (response.status === 401 && account.refreshToken) { account.expiresAt = 0; response = await call(); }
  return jsonResponse(response);
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

/** "Name <address>" (Zoho's list has the name in `sender` and the address in `fromAddress`). */
const zohoSender = (row: Record<string, unknown>) => {
  const name = clean(row.sender || row.from), addr = clean(row.fromAddress);
  return addr && !name.toLowerCase().includes(addr.toLowerCase()) ? (name ? `${name} <${addr}>` : addr) : name || addr;
};

async function zohoItem(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string, row: Record<string, unknown>): Promise<PipelineItem> {
  const messageId = String(row.messageId || '');
  const subject = clean(row.subject);
  const sender = zohoSender(row);
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
export async function syncZohoPage(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string, cursor: string, maxAdd = Infinity, unreadOnly = false): Promise<PageResult> {
  const page = Number(cursor) || 0;
  const known = knownMessageIds(state, pipeline.id);
  const query = new URLSearchParams({ folderId, start: String(page * PAGE_SIZE + 1), limit: String(PAGE_SIZE), ...(unreadOnly ? { status: 'unread' } : {}) });
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
    if (!item.sender.includes('@') && row.fromAddress) item.sender = zohoSender(row); // repair mail stored name-only
  }
  const fresh = unknownRows.slice(0, maxAdd);
  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    const items = await Promise.all(fresh.slice(i, i + CONCURRENCY).map((row) => zohoItem(state, account, pipeline, folderId, row)));
    for (const item of items) item.accountId = account.id;
    state.items.push(...items);
  }
  return { scanned: rows.length, added: fresh.length, unknown: unknownRows.length, next: rows.length < PAGE_SIZE ? '' : String(page + 1), ids: rows.map((row) => String(row.messageId || '')).filter(Boolean) };
}

// Folders whose mail never belongs in an unread list.
const SKIP_UNREAD = /^(trash|spam|sent|drafts|outbox|templates|snoozed)$/i;

/**
 * Unread mail in every folder (not just Inbox), like Zoho's own "Unread" view (and the Toolbox). Zoho's folder list has
 * NO unread count, so each folder is asked for its unread messages (status=unread), 3 folders at a time to stay under
 * Zoho's rolling rate limit. Unread messages are stored in the account's inbox feed tagged with their folder; the count
 * per folder (up to 200, then "200+") feeds the sidebar. A folder whose whole unread list was read also has its read
 * state aligned (read elsewhere → read here). Full scans run at most every 10 minutes per account.
 */
declare global { var __aadosZohoUnreadScan: Map<string, number> | undefined; }
const UNREAD_SCAN_MS = 10 * 60_000, UNREAD_PAGES = 4;
export async function liveZohoUnread(state: AadOSState, account: MailAccount, pipeline: Pipeline, force = false) {
  const scans = (globalThis.__aadosZohoUnreadScan ??= new Map());
  if (!force && Date.now() - (scans.get(account.id) || 0) < UNREAD_SCAN_MS) return { added: 0 };
  scans.set(account.id, Date.now());
  const list = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/folders`);
  const folders = (Array.isArray(list.data) ? list.data : []).map((f: Record<string, unknown>) => ({ id: String(f.folderId || ''), name: String(f.folderName || ''), type: String(f.folderType || '') }))
    .filter((f: { id: string; name: string; type: string }) => f.id && !SKIP_UNREAD.test(f.type) && !SKIP_UNREAD.test(f.name));
  let added = 0, next = 0;
  const counts = new Map<string, number>();
  await Promise.all(Array.from({ length: Math.min(3, folders.length) }, async () => {
    while (next < folders.length) {
      const f = folders[next++];
      try {
        const ids: string[] = []; let complete = false;
        for (let page = 0; page < UNREAD_PAGES; page++) {
          const r = await syncZohoPage(state, account, pipeline, f.id, String(page), 50, true);
          added += r.added; ids.push(...(r.ids || []));
          if (!r.next) { complete = true; break; }
        }
        counts.set(f.id, ids.length);
        if (complete) applyUnread(state, pipeline, f.id, new Set(ids), account.id);
      } catch { /* one folder failing (or rate-limited) never stops the others */ }
    }
  }));
  account.folders = account.folders.map((f) => (counts.has(f.id) ? { ...f, unread: counts.get(f.id) } : f));
  return { added };
}

/**
 * Search the whole Zoho mailbox (not only mail stored in AadOS) and store the matches in the account's inbox feed,
 * so the normal inbox search finds old mail too. Zoho search syntax: entire:<text> matches subject, sender and body.
 */
export async function searchZoho(state: AadOSState, account: MailAccount, pipeline: Pipeline, q: string) {
  // A pasted address searches by sender; anything else searches subject, sender and body.
  const addr = q.match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
  const query = new URLSearchParams({ searchKey: addr ? `sender:${addr}` : `entire:${q.replace(/[<>"]/g, ' ').replace(/::/g, ' ').trim()}`, limit: '50', start: '1' });
  const response = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/messages/search?${query}`);
  const rows: Record<string, unknown>[] = (Array.isArray(response.data) ? response.data : []).filter((r: Record<string, unknown>) => r.messageId && r.folderId);
  const mine = new Map(state.items.filter((i) => (i.accountId || pipeline.accountId) === account.id).map((i) => [i.messageId, i]));
  for (const row of rows) { const item = mine.get(String(row.messageId)); if (item) item.unread = String(row.status) === '0'; }
  const fresh = rows.filter((r) => !mine.has(String(r.messageId))).slice(0, 50);
  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    const items = await Promise.all(fresh.slice(i, i + CONCURRENCY).map((row) => zohoItem(state, account, pipeline, String(row.folderId), row)));
    for (const item of items) item.accountId = account.id;
    state.items.push(...items);
  }
  return { added: fresh.length, found: rows.length };
}

/** Live sync of one open folder: the newest page only (new mail, read state, anything that left the folder). */
export async function liveZohoFolder(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  const page = await syncZohoPage(state, account, pipeline, folderId, '0');
  const removed = pruneFolderWindow(state, pipeline, folderId, account.id, page.ids || [], !page.next);
  // Opening a folder also re-counts its unread mail (Zoho's folder list has no count), so the sidebar number and
  // read state are current on every click / reload, not only after the 10-minute all-folder scan.
  let added = page.added;
  try {
    const ids: string[] = []; let complete = false;
    for (let p = 0; p < UNREAD_PAGES; p++) {
      const r = await syncZohoPage(state, account, pipeline, folderId, String(p), 50, true);
      added += r.added; ids.push(...(r.ids || []));
      if (!r.next) { complete = true; break; }
    }
    if (complete) applyUnread(state, pipeline, folderId, new Set(ids), account.id);
    account.folders = account.folders.map((f) => (f.id === folderId ? { ...f, unread: ids.length } : f));
  } catch { /* the page above already synced; the count catches up on the next scan */ }
  return { scanned: page.scanned, added, removed };
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

/** Read-only (documented): GET .../messages/{messageId}/attachmentinfo -> data.attachments[{attachmentId, attachmentName, attachmentSize}]. */
export async function listZohoAttachments(state: AadOSState, account: MailAccount, folderId: string, messageId: string): Promise<{ id: string; name: string; size: number; mime: string }[]> {
  const r = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/attachmentinfo`);
  return (Array.isArray(r.data?.attachments) ? r.data.attachments : []).map((a: Record<string, unknown>) => ({ id: String(a.attachmentId || ''), name: String(a.attachmentName || 'attachment'), size: Number(a.attachmentSize) || 0, mime: '' })).filter((a: { id: string }) => a.id);
}
/** Read-only (documented): GET .../attachments/{attachmentId} returns the raw bytes. */
export async function fetchZohoAttachment(state: AadOSState, account: MailAccount, folderId: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const token = await accessToken(state, account);
  const res = await fetchRetry(`${mailHost(state.zoho.dataCenter)}/api/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/octet-stream' } });
  if (!res.ok) throw new Error(`Zoho attachment HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Documented: DELETE .../folders/{folderId}/messages/{messageId} (expunge=false) moves the email to Trash. */
export async function trashZohoMessage(state: AadOSState, account: MailAccount, folderId: string, messageId: string): Promise<void> {
  if (!folderId) throw new Error('Zoho folder unknown for this email; sync it again first');
  const token = await accessToken(state, account);
  const res = await fetchRetry(`${mailHost(state.zoho.dataCenter)}/api/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}?expunge=false`, { method: 'DELETE', headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json' } });
  await jsonResponse(res);
}
/** Documented: PUT .../updatemessage {mode: markAsRead|markAsUnread, messageId: [long]}. IDs exceed 2^53, so they are written as raw digits. */
export async function setZohoUnread(state: AadOSState, account: MailAccount, messageIds: string[], unread: boolean): Promise<void> {
  const ids = messageIds.filter((id) => /^\d{1,20}$/.test(id));
  if (!ids.length) return;
  const token = await accessToken(state, account);
  const body = `{"mode":"${unread ? 'markAsUnread' : 'markAsRead'}","messageId":[${ids.join(',')}]}`;
  const res = await fetchRetry(`${mailHost(state.zoho.dataCenter)}/api/accounts/${encodeURIComponent(account.remoteId)}/updatemessage`, { method: 'PUT', headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body });
  await jsonResponse(res);
}

/** Documented: GET .../messages/{id}/header?raw=false -> data.headerContent {Name: [values]}. Names lower-cased here. */
export async function zohoHeaders(state: AadOSState, account: MailAccount, folderId: string, messageId: string): Promise<Record<string, string>> {
  if (!folderId) return {};
  const r = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/header?raw=false`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.data?.headerContent || {})) out[k.toLowerCase()] = Array.isArray(v) ? v.map(String).join(', ') : String(v ?? '');
  return out;
}
type ZohoOutgoing = { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string };
const zohoBody = (m: ZohoOutgoing) => ({ fromAddress: m.from, toAddress: m.to.join(','), ...(m.cc.length ? { ccAddress: m.cc.join(',') } : {}), ...(m.bcc.length ? { bccAddress: m.bcc.join(',') } : {}), subject: m.subject, content: m.text, mailFormat: 'plaintext' });
async function zohoPost(state: AadOSState, account: MailAccount, path: string, body: unknown) {
  const token = await accessToken(state, account);
  const res = await fetchRetry(`${mailHost(state.zoho.dataCenter)}/api${path}`, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { attempts: 1 });
  return jsonResponse(res);
}
/** Documented: POST /accounts/{id}/messages (new message, used for forwards). */
export async function sendZoho(state: AadOSState, account: MailAccount, m: ZohoOutgoing): Promise<void> { await zohoPost(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/messages`, zohoBody(m)); }
/** Documented: POST /accounts/{id}/messages/{messageId} with action "Reply" (reply-all = reply with the other recipients in To/Cc). */
export async function replyZoho(state: AadOSState, account: MailAccount, messageId: string, m: ZohoOutgoing): Promise<void> {
  if (!/^\d{1,20}$/.test(messageId)) throw new Error('Unexpected Zoho message id');
  await zohoPost(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/messages/${messageId}`, { ...zohoBody(m), action: 'Reply' });
}
