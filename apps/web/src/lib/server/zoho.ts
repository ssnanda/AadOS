import { randomBytes } from 'node:crypto';
import { accountId, type AadOSState, type MailAccount, type Pipeline, type PipelineItem, type ZohoFolder } from './aados-store';
import { parseMessage } from './pipeline-parser';

const accountsHost = (dc: string) => `https://accounts.zoho.${dc || 'com'}`;
const mailHost = (dc: string) => `https://mail.zoho.${dc || 'com'}`;

async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (body.status?.code && Number(body.status.code) >= 400)) throw new Error(body.error || body.message || body.status?.description || `Zoho HTTP ${response.status}`);
  return body;
}

export function beginOAuth(state: AadOSState, redirectUri: string) {
  state.zoho.oauthState = randomBytes(24).toString('base64url');
  state.zoho.oauthStateExpiresAt = Date.now() + 10 * 60 * 1000;
  const query = new URLSearchParams({
    client_id: state.zoho.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ',
    access_type: 'offline',
    prompt: 'consent',
    state: state.zoho.oauthState
  });
  return `${accountsHost(state.zoho.dataCenter)}/oauth/v2/auth?${query}`;
}

export async function finishOAuth(state: AadOSState, code: string, returnedState: string, redirectUri: string) {
  if (!state.zoho.oauthState || returnedState !== state.zoho.oauthState || state.zoho.oauthStateExpiresAt < Date.now()) throw new Error('Zoho OAuth state is invalid or expired');
  const form = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: state.zoho.clientId, client_secret: state.zoho.clientSecret, redirect_uri: redirectUri });
  const tokens = await jsonResponse(await fetch(`${accountsHost(state.zoho.dataCenter)}/oauth/v2/token`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) }));
  state.zoho.oauthState = '';
  state.zoho.oauthStateExpiresAt = 0;
  // Identify the mailbox first, then add it or refresh the tokens of an existing one.
  const account: MailAccount = { id: '', provider: 'zoho', email: '', remoteId: '', accessToken: String(tokens.access_token || ''), refreshToken: String(tokens.refresh_token || ''), expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000, folders: [] };
  await discoverAccountAndFolders(state, account);
  account.id = accountId('zoho', account.email || account.remoteId);
  const existing = state.accounts.find((item) => item.id === account.id);
  if (existing) Object.assign(existing, account, { refreshToken: account.refreshToken || existing.refreshToken });
  else if (!account.refreshToken) throw new Error('Zoho did not return a refresh token. Remove AadOS from Zoho connected apps and try again.');
  else state.accounts.push(account);
}

async function accessToken(state: AadOSState, account: MailAccount) {
  if (account.accessToken && account.expiresAt > Date.now() + 60_000) return account.accessToken;
  if (!account.refreshToken) throw new Error(`Zoho account ${account.email} is not connected`);
  const form = new URLSearchParams({ refresh_token: account.refreshToken, grant_type: 'refresh_token', client_id: state.zoho.clientId, client_secret: state.zoho.clientSecret });
  const tokens = await jsonResponse(await fetch(`${accountsHost(state.zoho.dataCenter)}/oauth/v2/token`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) }));
  account.accessToken = String(tokens.access_token || '');
  account.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  return account.accessToken;
}

async function api(state: AadOSState, account: MailAccount, path: string) {
  const token = await accessToken(state, account);
  return jsonResponse(await fetch(`${mailHost(state.zoho.dataCenter)}/api${path}`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }));
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

export async function syncPipeline(state: AadOSState, pipeline: Pipeline) {
  const account = state.accounts.find((item) => item.id === pipeline.accountId && item.provider === 'zoho');
  if (!account) throw new Error('The Zoho account for this view is no longer connected.');
  let scanned = 0;
  let added = 0;
  for (const folder of pipeline.folders?.length ? pipeline.folders : [{ id: pipeline.folderId, name: pipeline.folderName }]) {
    const result = await syncFolder(state, account, pipeline, folder.id);
    scanned += result.scanned;
    added += result.added;
  }
  pipeline.cursor = 0;
  pipeline.lastSync = new Date().toISOString();
  pipeline.lastError = '';
  return { scanned, added };
}

// New messages added per folder per sync. Each one costs a content fetch, so keep a
// run short enough for the web request; repeated syncs keep backfilling older mail.
const SYNC_BATCH = 100;
const PAGE_SIZE = 50;
const MAX_PAGES = 200;

async function syncFolder(state: AadOSState, account: MailAccount, pipeline: Pipeline, folderId: string) {
  const known = new Set(state.items.filter((item) => item.pipelineId === pipeline.id).map((item) => item.messageId));
  let scanned = 0;
  let added = 0;
  // Page back through the folder (newest first), skipping messages already stored.
  for (let page = 0; page < MAX_PAGES && added < SYNC_BATCH; page++) {
    const query = new URLSearchParams({ folderId, start: String(page * PAGE_SIZE + 1), limit: String(PAGE_SIZE) });
    const response = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/messages/view?${query}`);
    const rows = Array.isArray(response.data) ? response.data : [];
    scanned += rows.length;
    for (const row of rows) {
      const messageId = String(row.messageId || '');
      if (!messageId || known.has(messageId)) continue;
      if (added >= SYNC_BATCH) break;
      const subject = String(row.subject || '');
      const sender = String(row.sender || row.fromAddress || row.from || '');
      let summary = String(row.summary || row.snippet || '');
      let body = '';
      try {
        const content = await api(state, account, `/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`);
        body = String(content.data?.content || content.data?.htmlContent || content.data || '');
        if (!summary) summary = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
      } catch { /* A list item is still useful when Zoho withholds message content. */ }
      const parsed = parseMessage(pipeline.parser, { subject, sender, summary, body });
      const rawReceived = Number(row.receivedTime || row.receivedDate || Date.now());
      const receivedAt = new Date(Number.isFinite(rawReceived) ? rawReceived : Date.now()).toISOString();
      const item: PipelineItem = { id: `${pipeline.id}:${messageId}`, pipelineId: pipeline.id, messageId, subject, sender, receivedAt, summary, kind: parsed.kind, stage: 'new', facts: parsed.facts };
      state.items.push(item);
      known.add(messageId);
      added++;
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return { scanned, added };
}
