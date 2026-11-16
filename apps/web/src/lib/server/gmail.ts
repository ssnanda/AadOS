import { randomBytes } from 'node:crypto';
import { accountId, knownMessageIds, type AadOSState, type MailAccount, type PageResult, type Pipeline, type PipelineItem } from './aados-store';
import { clean, parseMessage } from './pipeline-parser';

async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.error?.message || body.error || `Google HTTP ${response.status}`);
  return body;
}

export function beginGmailOAuth(state: AadOSState, redirectUri: string) {
  state.gmail.oauthState = randomBytes(24).toString('base64url');
  state.gmail.oauthStateExpiresAt = Date.now() + 10 * 60 * 1000;
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: state.gmail.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.readonly', access_type: 'offline', prompt: 'consent select_account', state: state.gmail.oauthState })}`;
}

export async function finishGmailOAuth(state: AadOSState, code: string, returnedState: string, redirectUri: string) {
  if (!state.gmail.oauthState || returnedState !== state.gmail.oauthState || state.gmail.oauthStateExpiresAt < Date.now()) throw new Error('Gmail OAuth state is invalid or expired');
  const tokens = await json(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: state.gmail.clientId, client_secret: state.gmail.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(15000) }));
  state.gmail.oauthState = ''; state.gmail.oauthStateExpiresAt = 0;
  // Identify the mailbox first, then add it or refresh the tokens of an existing one.
  const account: MailAccount = { id: '', provider: 'gmail', email: '', remoteId: '', accessToken: String(tokens.access_token || ''), refreshToken: String(tokens.refresh_token || ''), expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000, folders: [] };
  await discoverGmailFolders(state, account);
  account.id = accountId('gmail', account.email);
  const existing = state.accounts.find((item) => item.id === account.id);
  if (existing) Object.assign(existing, account, { refreshToken: account.refreshToken || existing.refreshToken });
  else if (!account.refreshToken) throw new Error('Google did not return a refresh token. Remove AadOS from your Google account permissions and try again.');
  else state.accounts.push(account);
}

async function token(state: AadOSState, account: MailAccount) {
  if (account.accessToken && account.expiresAt > Date.now() + 60_000) return account.accessToken;
  if (!account.refreshToken) throw new Error(`Gmail account ${account.email} is not connected`);
  const tokens = await json(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: account.refreshToken, client_id: state.gmail.clientId, client_secret: state.gmail.clientSecret, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15000) }));
  account.accessToken = String(tokens.access_token || ''); account.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000; return account.accessToken;
}

export async function discoverGmailFolders(state: AadOSState, account: MailAccount) {
  const access = await token(state, account);
  const headers = { Authorization: `Bearer ${access}` };
  const [profile, labels] = await Promise.all([json(await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers })), json(await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers }))]);
  account.email = String(profile.emailAddress || '');
  account.folders = (labels.labels || []).filter((label: Record<string, unknown>) => label.type === 'user').map((label: Record<string, unknown>) => ({ id: String(label.id), name: String(label.name), path: String(label.name), type: 'label' }));
}

export async function syncGmailPipeline(state: AadOSState, pipeline: Pipeline) {
  const account = state.accounts.find((item) => item.id === pipeline.accountId && item.provider === 'gmail');
  if (!account) throw new Error('The Gmail account for this view is no longer connected.');
  let scanned = 0;
  let added = 0;
  for (const folder of pipeline.folders?.length ? pipeline.folders : [{ id: pipeline.folderId, name: pipeline.folderName }]) {
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
  const message = await json(await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, { headers, signal: AbortSignal.timeout(20000) }));
  const messageHeaders = Array.isArray(message.payload?.headers) ? message.payload.headers : [];
  const header = (name: string) => String(messageHeaders.find((item: Record<string, unknown>) => String(item.name).toLowerCase() === name.toLowerCase())?.value || '');
  const subject = clean(header('Subject'));
  const sender = clean(header('From'));
  const summary = clean(message.snippet);
  const parsed = parseMessage(pipeline.parser, { subject, sender, summary });
  const receivedAt = new Date(Number(message.internalDate || Date.now())).toISOString();
  return { id: `${pipeline.id}:${messageId}`, pipelineId: pipeline.id, messageId, subject, sender, receivedAt, summary, kind: parsed.kind, stage: 'new', unread: Array.isArray(message.labelIds) && message.labelIds.includes('UNREAD'), facts: parsed.facts };
}

/** Fetch one page of a label (cursor '0' = first page, else Gmail's pageToken) and store unknown messages. */
export async function syncGmailPage(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string, cursor: string, maxAdd = Infinity): Promise<PageResult> {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const known = knownMessageIds(state, pipeline.id);
  const query = new URLSearchParams({ labelIds: folderId, maxResults: '100' });
  if (cursor && cursor !== '0') query.set('pageToken', cursor);
  const list = await json(await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers, signal: AbortSignal.timeout(20000) }));
  const rows: Record<string, unknown>[] = Array.isArray(list.messages) ? list.messages : [];
  const unknownIds = rows.map((row) => String(row.id || '')).filter((id) => id && !known.has(id));
  const fresh = unknownIds.slice(0, maxAdd);
  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    const items = await Promise.all(fresh.slice(i, i + CONCURRENCY).map((id) => gmailItem(headers, pipeline, id)));
    state.items.push(...items);
  }
  return { scanned: rows.length, added: fresh.length, unknown: unknownIds.length, next: String(list.nextPageToken || '') };
}

// Incremental: walk from the newest page and stop at the first page that is already known.
async function syncGmailLabel(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  let cursor = '0', scanned = 0, added = 0;
  for (let n = 0; cursor && n < MAX_PAGES && added < SYNC_BATCH; n++) {
    const result = await syncGmailPage(state, account, pipeline, folderId, cursor, SYNC_BATCH - added);
    scanned += result.scanned; added += result.added;
    if (result.unknown === 0) break;
    cursor = result.next;
  }
  return { scanned, added };
}

/** Fetch one message body on demand (prefers HTML, falls back to plain text). */
export async function fetchGmailBody(state: AadOSState, account: MailAccount, item: PipelineItem): Promise<{ html: string; text: string }> {
  const headers = { Authorization: `Bearer ${await token(state, account)}` };
  const message = await json(await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.messageId)}?format=full`, { headers, signal: AbortSignal.timeout(20000) }));
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
