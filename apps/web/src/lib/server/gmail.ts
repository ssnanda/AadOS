import { randomBytes } from 'node:crypto';
import { accountId, type AadOSState, type MailAccount, type Pipeline, type PipelineItem } from './aados-store';
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

// New messages added per label per sync; repeated syncs keep backfilling older mail.
const SYNC_BATCH = 100;
const MAX_PAGES = 200;

async function syncGmailLabel(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  const access = await token(state, account);
  const headers = { Authorization: `Bearer ${access}` };
  const known = new Set(state.items.filter((item) => item.pipelineId === pipeline.id).map((item) => item.messageId));
  let scanned = 0;
  let added = 0;
  let pageToken = '';
  // Page back through the label (newest first), skipping messages already stored.
  for (let page = 0; page < MAX_PAGES && added < SYNC_BATCH; page++) {
    const query = new URLSearchParams({ labelIds: folderId, maxResults: '100' });
    if (pageToken) query.set('pageToken', pageToken);
    const list = await json(await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers, signal: AbortSignal.timeout(20000) }));
    const rows = Array.isArray(list.messages) ? list.messages : [];
    scanned += rows.length;
    for (const row of rows) {
      const messageId = String(row.id || '');
      if (!messageId || known.has(messageId)) continue;
      if (added >= SYNC_BATCH) break;
      const message = await json(await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, { headers, signal: AbortSignal.timeout(20000) }));
      const messageHeaders = Array.isArray(message.payload?.headers) ? message.payload.headers : [];
      const header = (name: string) => String(messageHeaders.find((item: Record<string, unknown>) => String(item.name).toLowerCase() === name.toLowerCase())?.value || '');
      const subject = clean(header('Subject'));
      const sender = clean(header('From'));
      const summary = clean(message.snippet);
      const parsed = parseMessage(pipeline.parser, { subject, sender, summary });
      const receivedAt = new Date(Number(message.internalDate || Date.now())).toISOString();
      const item: PipelineItem = { id: `${pipeline.id}:${messageId}`, pipelineId: pipeline.id, messageId, subject, sender, receivedAt, summary, kind: parsed.kind, stage: 'new', facts: parsed.facts };
      state.items.push(item);
      known.add(messageId);
      added++;
    }
    pageToken = String(list.nextPageToken || '');
    if (!pageToken) break;
  }
  return { scanned, added };
}
