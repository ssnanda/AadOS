import { randomBytes } from 'node:crypto';
import type { AadOSState, Pipeline, PipelineItem } from './aados-store';
import { parseMessage } from './pipeline-parser';

async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.error?.message || body.error || `Google HTTP ${response.status}`);
  return body;
}

export function beginGmailOAuth(state: AadOSState, redirectUri: string) {
  state.gmail.oauthState = randomBytes(24).toString('base64url');
  state.gmail.oauthStateExpiresAt = Date.now() + 10 * 60 * 1000;
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: state.gmail.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.readonly', access_type: 'offline', prompt: 'consent', state: state.gmail.oauthState })}`;
}

export async function finishGmailOAuth(state: AadOSState, code: string, returnedState: string, redirectUri: string) {
  if (!state.gmail.oauthState || returnedState !== state.gmail.oauthState || state.gmail.oauthStateExpiresAt < Date.now()) throw new Error('Gmail OAuth state is invalid or expired');
  const tokens = await json(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: state.gmail.clientId, client_secret: state.gmail.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(15000) }));
  state.gmail.accessToken = String(tokens.access_token || ''); state.gmail.refreshToken = String(tokens.refresh_token || state.gmail.refreshToken || ''); state.gmail.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  state.gmail.oauthState = ''; state.gmail.oauthStateExpiresAt = 0;
  await discoverGmailFolders(state);
}

async function token(state: AadOSState) {
  if (state.gmail.accessToken && state.gmail.expiresAt > Date.now() + 60_000) return state.gmail.accessToken;
  const tokens = await json(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: state.gmail.refreshToken, client_id: state.gmail.clientId, client_secret: state.gmail.clientSecret, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15000) }));
  state.gmail.accessToken = String(tokens.access_token || ''); state.gmail.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000; return state.gmail.accessToken;
}

export async function discoverGmailFolders(state: AadOSState) {
  const access = await token(state);
  const headers = { Authorization: `Bearer ${access}` };
  const [profile, labels] = await Promise.all([json(await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers })), json(await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers }))]);
  state.gmail.connectedEmail = String(profile.emailAddress || '');
  state.gmail.folders = (labels.labels || []).filter((label: Record<string, unknown>) => label.type === 'user').map((label: Record<string, unknown>) => ({ id: String(label.id), name: String(label.name), path: String(label.name), type: 'label' }));
}

export async function syncGmailPipeline(state: AadOSState, pipeline: Pipeline) {
  const access = await token(state);
  const headers = { Authorization: `Bearer ${access}` };
  const query = new URLSearchParams({ labelIds: pipeline.folderId, maxResults: '50' });
  const list = await json(await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers, signal: AbortSignal.timeout(20000) }));
  const rows = Array.isArray(list.messages) ? list.messages : [];
  const known = new Set(state.items.filter((item) => item.pipelineId === pipeline.id).map((item) => item.messageId));
  let added = 0;
  for (const row of rows) {
    const messageId = String(row.id || '');
    if (!messageId || known.has(messageId)) continue;
    if (added >= 20) break;
    const message = await json(await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, { headers, signal: AbortSignal.timeout(20000) }));
    const messageHeaders = Array.isArray(message.payload?.headers) ? message.payload.headers : [];
    const header = (name: string) => String(messageHeaders.find((item: Record<string, unknown>) => String(item.name).toLowerCase() === name.toLowerCase())?.value || '');
    const subject = header('Subject');
    const sender = header('From');
    const summary = String(message.snippet || '');
    const parsed = parseMessage(pipeline.parser, { subject, sender, summary });
    const receivedAt = new Date(Number(message.internalDate || Date.now())).toISOString();
    const item: PipelineItem = { id: `${pipeline.id}:${messageId}`, pipelineId: pipeline.id, messageId, subject, sender, receivedAt, summary, kind: parsed.kind, stage: 'new', facts: parsed.facts };
    state.items.push(item);
    added++;
  }
  pipeline.lastSync = new Date().toISOString();
  pipeline.lastError = '';
  return { scanned: rows.length, added };
}
