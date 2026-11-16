import { randomBytes } from 'node:crypto';
import type { AadOSState, Pipeline, PipelineItem, ZohoFolder } from './aados-store';
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
  state.zoho.accessToken = String(tokens.access_token || '');
  state.zoho.refreshToken = String(tokens.refresh_token || state.zoho.refreshToken || '');
  state.zoho.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  state.zoho.apiDomain = String(tokens.api_domain || '');
  state.zoho.oauthState = '';
  state.zoho.oauthStateExpiresAt = 0;
  await discoverAccountAndFolders(state);
}

async function accessToken(state: AadOSState) {
  if (state.zoho.accessToken && state.zoho.expiresAt > Date.now() + 60_000) return state.zoho.accessToken;
  if (!state.zoho.refreshToken) throw new Error('Zoho is not connected');
  const form = new URLSearchParams({ refresh_token: state.zoho.refreshToken, grant_type: 'refresh_token', client_id: state.zoho.clientId, client_secret: state.zoho.clientSecret });
  const tokens = await jsonResponse(await fetch(`${accountsHost(state.zoho.dataCenter)}/oauth/v2/token`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) }));
  state.zoho.accessToken = String(tokens.access_token || '');
  state.zoho.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  return state.zoho.accessToken;
}

async function api(state: AadOSState, path: string) {
  const token = await accessToken(state);
  return jsonResponse(await fetch(`${mailHost(state.zoho.dataCenter)}/api${path}`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }));
}

export async function discoverAccountAndFolders(state: AadOSState) {
  const accounts = await api(state, '/accounts');
  const rows = Array.isArray(accounts.data) ? accounts.data : [];
  const preferred = rows.find((row: Record<string, unknown>) => String(row.primaryEmailAddress || row.emailAddress || '').toLowerCase() === 'sandip@itspector.com') || rows[0];
  if (!preferred) throw new Error('Zoho returned no mail accounts');
  state.zoho.accountId = String(preferred.accountId || preferred.accountID || '');
  state.zoho.connectedEmail = String(preferred.primaryEmailAddress || preferred.emailAddress || '');
  const folders = await api(state, `/accounts/${encodeURIComponent(state.zoho.accountId)}/folders`);
  state.zoho.folders = (Array.isArray(folders.data) ? folders.data : []).map((folder: Record<string, unknown>): ZohoFolder => ({
    id: String(folder.folderId || ''), name: String(folder.folderName || ''), path: String(folder.path || folder.folderName || ''), type: String(folder.folderType || '')
  })).filter((folder: ZohoFolder) => folder.id && folder.name);
}

export async function syncPipeline(state: AadOSState, pipeline: Pipeline) {
  const query = new URLSearchParams({ folderId: pipeline.folderId, start: String(pipeline.cursor || 0), limit: '50' });
  const response = await api(state, `/accounts/${encodeURIComponent(state.zoho.accountId)}/messages/view?${query}`);
  const rows = Array.isArray(response.data) ? response.data : [];
  const known = new Set(state.items.filter((item) => item.pipelineId === pipeline.id).map((item) => item.messageId));
  let added = 0;
  for (const row of rows) {
    const messageId = String(row.messageId || '');
    if (!messageId || known.has(messageId)) continue;
    if (added >= 20) break;
    const subject = String(row.subject || '');
    const sender = String(row.sender || row.fromAddress || row.from || '');
    let summary = String(row.summary || row.snippet || '');
    let body = '';
    try {
      const content = await api(state, `/accounts/${encodeURIComponent(state.zoho.accountId)}/folders/${encodeURIComponent(pipeline.folderId)}/messages/${encodeURIComponent(messageId)}/content`);
      body = String(content.data?.content || content.data?.htmlContent || content.data || '');
      if (!summary) summary = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
    } catch { /* A list item is still useful when Zoho withholds message content. */ }
    const parsed = parseMessage(pipeline.parser, { subject, sender, summary, body });
    const rawReceived = Number(row.receivedTime || row.receivedDate || Date.now());
    const receivedAt = new Date(Number.isFinite(rawReceived) ? rawReceived : Date.now()).toISOString();
    const item: PipelineItem = { id: `${pipeline.id}:${messageId}`, pipelineId: pipeline.id, messageId, subject, sender, receivedAt, summary, kind: parsed.kind, stage: 'new', facts: parsed.facts };
    state.items.push(item);
    added++;
  }
  pipeline.cursor = 0;
  pipeline.lastSync = new Date().toISOString();
  pipeline.lastError = '';
  return { scanned: rows.length, added };
}
