// BlueBubbles client (iMessage through the owner's Mac). Everything is read live from the BlueBubbles server, like
// email: AadOS keeps only the server URL + password (encrypted with the other integration secrets) and, per chat, when it
// was last opened (for unread). Endpoints follow the BlueBubbles REST API (/api/v1, `password` query auth).
import { randomBytes } from 'node:crypto';
import { readState, updateState, type AadOSState } from './aados-store';
import { addressKey, smsGuid, toChat, toMessage, type Chat, type Message } from '$lib/messages-model';
import { googleContactNames } from './contacts';

export class BBError extends Error { constructor(message: string, public status = 0) { super(message); } }
export type BBConn = { url: string; password: string };

export const bbConfigured = (s: Pick<AadOSState, 'integrations'>) => Boolean(s.integrations.bluebubbles?.url && s.integrations.bluebubbles?.password);
export async function bbConnection(): Promise<BBConn> {
  const s = await readState();
  if (!bbConfigured(s)) throw new BBError('Messages are not connected. Settings → Messages.', 401);
  const b = s.integrations.bluebubbles;
  return { url: b.url.replace(/\/+$/, ''), password: b.password };
}

async function call(c: BBConn, method: string, path: string, opts: { query?: Record<string, string | number>; body?: unknown; raw?: boolean; timeoutMs?: number } = {}): Promise<any> {
  const url = new URL(`${c.url}/api/v1${path}`);
  url.searchParams.set('password', c.password);
  for (const [k, v] of Object.entries(opts.query || {})) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { accept: 'application/json', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000) });
  } catch (e) { throw new BBError(`Cannot reach the BlueBubbles server (${e instanceof Error ? e.message : 'network error'}). Is the Mac on and the URL right?`); }
  // Cloudflare answers 52x/530 when the tunnel is not connected — almost always a quick-tunnel URL that changed.
  const tunnelDown = (status: number) => status === 530 || (status >= 520 && status <= 527) || status === 1033;
  if (tunnelDown(res.status)) throw new BBError(`The BlueBubbles tunnel at ${c.url} is not connected (HTTP ${res.status}). If BlueBubbles restarted, its Cloudflare URL changed — copy the current Server URL from BlueBubbles into Settings → Messages.`, res.status);
  if (opts.raw) { if (!res.ok) throw new BBError(`BlueBubbles HTTP ${res.status}`, res.status); return res; }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (typeof body.status === 'number' && body.status >= 400)) throw new BBError(res.status === 401 ? 'BlueBubbles rejected the password.' : body.error?.error || body.message || `BlueBubbles HTTP ${res.status}`, res.status);
  return body.data;
}

export async function ping(c: BBConn) { await call(c, 'GET', '/ping', { timeoutMs: 8000 }); return call(c, 'GET', '/server/info', { timeoutMs: 8000 }).catch(() => ({})); }

// Contacts from the Mac (names for numbers). Cached for an hour; failure just means numbers are shown.
declare global { var __aadosBBContacts: { at: number; names: Map<string, string> } | undefined; var __aadosBBUnread: number | undefined; }
/** Contact names for numbers/emails — Google Contacts only (the owner does not use Mac contacts). */
export async function contactNames(_c?: BBConn): Promise<Map<string, string>> { return googleContactNames().catch(() => new Map<string, string>()); }

/** Conversations plus the names used for them (Google Contacts) and how many names were available. */
export async function chatsWithNames(c: BBConn, limit = 150): Promise<{ chats: Chat[]; names: Map<string, string>; sources: { google: number } }> {
  const [raw, names] = await Promise.all([call(c, 'POST', '/chat/query', { body: { limit, offset: 0, with: ['lastMessage', 'participants'], sort: 'lastmessage' } }), contactNames()]);
  const list = (Array.isArray(raw) ? raw : []).map((x) => toChat(x, names)).filter((x) => x.guid).sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
  return { chats: list, names, sources: { google: names.size } };
}
export async function chats(c: BBConn, limit = 100): Promise<Chat[]> {
  const [raw, names] = await Promise.all([call(c, 'POST', '/chat/query', { body: { limit, offset: 0, with: ['lastMessage', 'participants'], sort: 'lastmessage' } }), contactNames()]);
  return (Array.isArray(raw) ? raw : []).map((x) => toChat(x, names)).filter((x) => x.guid).sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
}

export async function thread(c: BBConn, chatGuid: string, limit = 60, before = 0): Promise<Message[]> {
  const raw = await call(c, 'GET', `/chat/${encodeURIComponent(chatGuid)}/message`, { query: { limit, offset: 0, with: 'attachment,handle', sort: 'DESC', ...(before ? { before } : {}) } });
  return (Array.isArray(raw) ? raw : []).map((m) => toMessage(m, chatGuid)).filter((m) => m.guid).reverse();
}

export async function sendText(c: BBConn, chatGuid: string, text: string): Promise<Message | null> {
  // "apple-script" works on every server; "private-api" adds reactions/typing when the owner enabled it on the Mac.
  const data = await call(c, 'POST', '/message/text', { body: { chatGuid, tempGuid: `aados-${randomBytes(8).toString('hex')}`, message: text, method: 'apple-script' }, timeoutMs: 30_000 });
  return data?.guid ? toMessage(data, chatGuid) : null;
}

/** Send as SMS to one person. The "SMS;-;<number>" chat may not exist (newer macOS files 1:1 chats as "any;-;…"), so
 *  fall back to starting the chat with service SMS. */
export async function sendSms(c: BBConn, address: string, text: string): Promise<Message | null> {
  try { return await sendText(c, smsGuid(address), text); }
  catch (first) {
    try {
      const data = await call(c, 'POST', '/chat/new', { body: { addresses: [address.trim()], message: text, service: 'SMS', method: 'apple-script' }, timeoutMs: 30_000 });
      return data?.lastMessage ? toMessage(data.lastMessage, String(data.guid || smsGuid(address))) : null;
    } catch { throw first; }
  }
}

/** Start a conversation with one address (phone/email). Needs the Private API on most servers. */
export async function newChat(c: BBConn, address: string, text: string) {
  try { return await call(c, 'POST', '/chat/new', { body: { addresses: [address], message: text, method: 'apple-script' }, timeoutMs: 30_000 }); }
  catch (first) {
    // Without the Private API, Messages can still send to a 1:1 thread addressed by service + handle.
    const handle = address.includes('@') ? address.trim() : `+${addressKey(address).length === 10 ? '1' : ''}${addressKey(address)}`;
    for (const service of ['iMessage', 'SMS']) { try { return await sendText(c, `${service};-;${handle}`, text); } catch { /* try the next service */ } }
    throw first;
  }
}

export async function markRead(c: BBConn, chatGuid: string) { await call(c, 'POST', `/chat/${encodeURIComponent(chatGuid)}/read`).catch(() => undefined); } // Private API only; local unread works regardless
export async function attachment(c: BBConn, guid: string): Promise<Response> { return call(c, 'GET', `/attachment/${encodeURIComponent(guid)}/download`, { raw: true, timeoutMs: 60_000 }); }

/** Register (or re-register) AadOS's webhook so new messages arrive instantly. */
export async function registerWebhook(c: BBConn, origin: string): Promise<string> {
  let secret = '';
  await updateState((s) => { s.integrations.bluebubbles.hookSecret ||= randomBytes(24).toString('base64url'); secret = s.integrations.bluebubbles.hookSecret; });
  const url = `${origin.replace(/\/+$/, '')}/messages/hook?token=${secret}`;
  const existing: any[] = await call(c, 'GET', '/webhook').catch(() => []);
  if (!(Array.isArray(existing) && existing.some((w) => String(w.url || '').startsWith(`${origin.replace(/\/+$/, '')}/messages/hook`)))) await call(c, 'POST', '/webhook', { body: { url, events: ['*'] } });
  return url;
}

/** Unread chats (for the menu badge): computed on Messages loads and webhook events, kept in memory. */
export const unreadBadge = () => globalThis.__aadosBBUnread || 0;
export const setUnreadBadge = (n: number) => { globalThis.__aadosBBUnread = n; };
