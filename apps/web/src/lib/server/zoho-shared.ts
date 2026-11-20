// Zoho Shared Mailboxes (e.g. hoa@, leads@), ported from the Toolbox. Read live, never stored.
// - Discovery: there is no list endpoint. Candidates are the account's group send-as identities (/api/accounts →
//   sendMailDetails with mode "group", grouped by display name since one box has several aliases); each is probed with
//   GET /api/v2/sharedmailbox/{address}/counts and only HTTP 200 ones are real boxes the user can read.
// - Messages: /api/v2/sharedmailbox/{address}/messages/{all|unread}; fields are nested, so they are looked up by key.
// - Body: the shared API returns none. Group mail is also delivered to the member's own mailbox, so the copy with the
//   same subject closest in time (≤ 6 h) is read through the normal endpoints; else the summary is shown.
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

const norm = (s: string) => s.toLowerCase().replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();
// Zoho does not accept a phrase with spaces after `subject:`. Each word must be its own
// clause joined with `::` (the same syntax used by the normal Zoho mailbox search).
const subjectSearchKey = (subject: string) => norm(subject).split(/\s+/).map((word) => word.replace(/["<>:]/g, '').trim()).filter((word) => /[\p{L}\p{N}]/u.test(word)).map((word) => `subject:${word}`).join('::');
/** Full body from the member's own copy (same subject, closest time within 6 h); else the summary with a note. */
export async function sharedBody(state: AadOSState, account: MailAccount, id: string): Promise<{ html: string; text: string; note: string }> {
  const m = msgCache().get(`${account.id}|${id}`);
  if (!m) return { html: '', text: '', note: 'Reload the list and open the message again.' };
  try {
    const searchKey = subjectSearchKey(m.subject);
    if (!searchKey) return { html: '', text: m.summary, note: 'Full body unavailable — this message has no searchable subject.' };
    const query = new URLSearchParams({ searchKey, limit: '50', start: '1', includeto: 'true' });
    const found = await zohoRequest(state, account, 'GET', `/accounts/${encodeURIComponent(account.remoteId)}/messages/search?${query}`);
    const rows: Raw[] = Array.isArray(found.data) ? found.data : [];
    const want = norm(m.subject);
    const best = rows.filter((r) => r.folderId && (norm(String(r.subject || '')) === want || norm(String(r.subject || '')).includes(want) || want.includes(norm(String(r.subject || '')))))
      .map((r) => ({ r, diff: Math.abs(time(r.receivedTime || r.sentDateInGMT) - m.at) })).sort((a, b) => a.diff - b.diff)[0];
    if (best && best.diff < 6 * 3_600_000) {
      const c = await zohoRequest(state, account, 'GET', `/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(best.r.folderId)}/messages/${encodeURIComponent(best.r.messageId)}/content`);
      const raw = String(c.data?.content ?? '');
      return /<[a-z][\s\S]*>/i.test(raw) ? { html: raw, text: '', note: '' } : { html: '', text: raw, note: '' };
    }
    return { html: '', text: m.summary, note: 'Full body unavailable — no matching copy in your own mailbox; showing the summary.' };
  } catch (e) { return { html: '', text: m.summary, note: `Full body unavailable (${e instanceof Error ? e.message : 'error'}); showing the summary.` }; }
}

export async function setSharedRead(state: AadOSState, account: MailAccount, address: string, id: string, read: boolean) {
  await zohoRequest(state, account, 'PUT', `/v2/sharedmailbox/${encodeURIComponent(address)}/messages/${encodeURIComponent(id)}/${read ? 'read' : 'unread'}`);
  const m = msgCache().get(`${account.id}|${id}`); if (m) m.unread = !read;
}
export async function trashShared(state: AadOSState, account: MailAccount, address: string, id: string) {
  await zohoRequest(state, account, 'PUT', `/v2/sharedmailbox/${encodeURIComponent(address)}/messages/${encodeURIComponent(id)}/trash`);
}
