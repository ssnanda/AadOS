// Zoho Shared Mailboxes (e.g. hoa@, leads@), ported from the Toolbox. Read live, never stored.
// - Discovery: there is no list endpoint. Candidates are the account's group send-as identities (/api/accounts →
//   sendMailDetails with mode "group", grouped by display name since one box has several aliases); each is probed with
//   GET /api/v2/sharedmailbox/{address}/counts and only HTTP 200 ones are real boxes the user can read.
// - Messages: /api/v2/sharedmailbox/{address}/messages/{all|unread}; fields are nested, so they are looked up by key.
// - Body: V2 message detail supplies the shared message's owning account and folder. Use those identifiers with the
//   normal content endpoint; shared mail intentionally is not duplicated into each member's personal inbox.
import type { AadOSState, MailAccount } from './aados-store';
import { zohoRequest } from './zoho';

type Raw = Record<string, any>;
export type SharedBox = { address: string; name: string; total: number; unread: number };
export type SharedMessage = { id: string; subject: string; from: string; to: string; summary: string; at: number; unread: boolean; attachments: boolean };

function deepFind(root: unknown, key: string): unknown {
  const queue: unknown[] = [root];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const d = node as Raw;
    if (d[key] !== undefined && d[key] !== null) return d[key];
    for (const v of Object.values(d)) if (v && typeof v === 'object' && !Array.isArray(v)) queue.push(v);
  }
  return undefined;
}
const deepStr = (root: unknown, keys: string[]) => { for (const k of keys) { const v = deepFind(root, k); if (typeof v === 'string' && v) return v; if (typeof v === 'number') return String(v); } return ''; };
const entities = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const time = (v: unknown) => { const n = Number(v); if (Number.isFinite(n) && n > 0) return n > 1e11 ? n : n * 1000; const t = Date.parse(String(v || '')); return Number.isNaN(t) ? 0 : t; };
const bool = (v: unknown) => v === true || v === 1 || v === 'true' || v === '1';

declare global { var __aadosSharedBoxes: Map<string, { at: number; boxes: SharedBox[] }> | undefined; var __aadosSharedMsgs: Map<string, SharedMessage> | undefined; }
const msgCache = () => (globalThis.__aadosSharedMsgs ??= new Map());

/** Shared mailboxes this Zoho account can read (cached 10 minutes; `fresh` re-probes for live unread counts). */
export async function sharedBoxes(state: AadOSState, account: MailAccount, fresh = false): Promise<SharedBox[]> {
  const cache = (globalThis.__aadosSharedBoxes ??= new Map());
  const hit = cache.get(account.id);
  if (!fresh && hit && Date.now() - hit.at < 600_000) return hit.boxes;
  const accounts = await zohoRequest(state, account, 'GET', '/accounts');
  const me = (Array.isArray(accounts.data) ? accounts.data : []).find((a: Raw) => String(a.accountId) === account.remoteId) || accounts.data?.[0] || {};
  const byName = new Map<string, string[]>();
  for (const e of Array.isArray(me.sendMailDetails) ? me.sendMailDetails : []) {
    if (e?.mode !== 'group' || !e.fromAddress) continue;
    const name = String(e.displayName || e.fromAddress), address = String(e.fromAddress).toLowerCase();
    const list = byName.get(name) || []; if (!list.includes(address)) list.push(address); byName.set(name, list);
  }
  const boxes: SharedBox[] = [];
  await Promise.all([...byName].map(async ([name, addresses]) => {
    for (const address of addresses) {
      try {
        const c = (await zohoRequest(state, account, 'GET', `/v2/sharedmailbox/${encodeURIComponent(address)}/counts`)).data || {};
        boxes.push({ address, name, total: Number(c.total || 0), unread: Number(c.unread || 0) });
        return; // first alias that answers is the box
      } catch { /* not a shared mailbox (or no access): try the next alias */ }
    }
  }));
  boxes.sort((a, b) => a.name.localeCompare(b.name));
  cache.set(account.id, { at: Date.now(), boxes });
  return boxes;
}

export async function sharedMessages(state: AadOSState, account: MailAccount, address: string, unreadOnly: boolean, start = 0, limit = 50): Promise<{ messages: SharedMessage[]; next: number | null }> {
  const body = await zohoRequest(state, account, 'GET', `/v2/sharedmailbox/${encodeURIComponent(address)}/messages/${unreadOnly ? 'unread' : 'all'}?start=${start}&limit=${limit}`);
  const items: Raw[] = Array.isArray(body.data?.messages) ? body.data.messages : [];
  const messages = items.map((i) => ({
    id: deepStr(i, ['messageId']), subject: entities(deepStr(i, ['title', 'subject']) || '(no subject)'), from: entities(deepStr(i, ['fromAddress', 'senderName'])), to: entities(deepStr(i, ['toAddress'])),
    summary: entities(deepStr(i, ['summary'])), at: time(deepFind(i, 'createdAt')), unread: bool(deepFind(i, 'unread')), attachments: bool(deepFind(i, 'hasAttachments'))
  })).filter((m) => m.id);
  for (const m of messages) msgCache().set(`${account.id}|${m.id}`, m);
  return { messages, next: items.length === limit ? start + limit : null };
}

/** Full body from the shared message's underlying Zoho mail record. */
export async function sharedBody(state: AadOSState, account: MailAccount, address: string, id: string): Promise<{ html: string; text: string; note: string }> {
  const m = msgCache().get(`${account.id}|${id}`);
  if (!m) return { html: '', text: '', note: 'Reload the list and open the message again.' };
  const failures: string[] = [];
  try {
    const detail = await zohoRequest(state, account, 'GET', `/v2/sharedmailbox/${encodeURIComponent(address)}/messages/${encodeURIComponent(id)}`);
    const folderId = deepStr(detail.data, ['folderId']);
    const sharedIds = deepFind(detail.data, 'sharedMailIds');
    const messageIds = [...new Set([...(Array.isArray(sharedIds) ? sharedIds.map(String) : []), deepStr(detail.data, ['lastMessageId']), deepStr(detail.data, ['entityId']), id].filter(Boolean))];
    const accountIds = [...new Set([deepStr(detail.data, ['accountId']), deepStr(detail.data, ['mailSpaceId']), account.remoteId].filter(Boolean))];
    if (folderId) {
      for (const accountId of accountIds) for (const messageId of messageIds) {
        try {
          const full = await zohoRequest(state, account, 'GET', `/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`);
          const raw = typeof full.data?.content === 'string' ? full.data.content : deepStr(full.data, ['htmlContent', 'content']);
          if (raw) return /<[a-z][\s\S]*>/i.test(raw) ? { html: raw, text: '', note: '' } : { html: '', text: raw, note: '' };
        } catch (e) { failures.push(e instanceof Error ? e.message : 'content request failed'); }
      }
    }
    const content = deepStr(detail.data, ['htmlContent', 'messageBody', 'body', 'content']);
    if (content && content !== m.summary) return /<[a-z][\s\S]*>/i.test(content) ? { html: content, text: '', note: '' } : { html: '', text: content, note: '' };
  } catch (e) { failures.push(e instanceof Error ? e.message : 'message detail request failed'); }
  console.warn('[aados] Zoho shared-mailbox content unavailable:', [...new Set(failures)].join('; ').slice(0, 500));
  return { html: '', text: m.summary, note: 'Full body unavailable — Zoho did not return content for this shared message; showing the summary.' };
}

export async function setSharedRead(state: AadOSState, account: MailAccount, address: string, id: string, read: boolean) {
  await zohoRequest(state, account, 'PUT', `/v2/sharedmailbox/${encodeURIComponent(address)}/messages/${encodeURIComponent(id)}/${read ? 'read' : 'unread'}`);
  const m = msgCache().get(`${account.id}|${id}`); if (m) m.unread = !read;
}
export async function trashShared(state: AadOSState, account: MailAccount, address: string, id: string) {
  await zohoRequest(state, account, 'PUT', `/v2/sharedmailbox/${encodeURIComponent(address)}/messages/${encodeURIComponent(id)}/trash`);
}
