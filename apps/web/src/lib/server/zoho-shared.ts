// Zoho Shared Mailboxes (e.g. hoa@, leads@), ported from the Toolbox. Read live, never stored.
// - Discovery: there is no list endpoint. Candidates are the account's group send-as identities (/api/accounts →
//   sendMailDetails with mode "group", grouped by display name since one box has several aliases); each is probed with
//   GET /api/v2/sharedmailbox/{address}/counts and only HTTP 200 ones are real boxes the user can read.
// - Messages: /api/v2/sharedmailbox/{address}/messages/{all|unread}; fields are nested, so they are looked up by key.
// - Body: V2 "Get a message" returns data.message.content as {summary, title, htmlSummary?} — documented as a summary
//   only, with no folder/account ids. So: use a detail field if it is clearly longer than the summary, otherwise read
//   the member's own delivered copy (v1 search by subject + nearest time → /folders/{f}/messages/{m}/content).
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

const isHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);
const asBody = (raw: string) => (isHtml(raw) ? { html: raw, text: '', note: '' } : { html: '', text: raw, note: '' });
const normSubject = (s: string) => entities(s).toLowerCase().replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();
const plainLen = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().replace(/(\.\.\.|…)$/, '').length;

/** Zoho v2 "Get a message": `data.message.content` is an object ({summary, title, htmlSummary, …}), never a string.
 *  The docs only promise a truncated `summary`; take any content string clearly longer than it (HTML preferred). */
function bodyFromDetail(detail: Raw, summary: string): string {
  const content = detail?.data?.message?.content;
  if (!content || typeof content !== 'object') return '';
  const floor = plainLen(summary) + 20;
  const strings = ['htmlContent', 'content', 'body', 'messageBody', 'htmlSummary', 'summary']
    .map((k) => content[k]).filter((v): v is string => typeof v === 'string' && plainLen(v) > floor);
  return strings.find(isHtml) || strings[0] || '';
}

/** Group mail is also delivered to each member's own mailbox. Find that copy (same subject, closest receive time,
 *  within 6 h) via the v1 search API and read it through the normal content endpoint — the Toolbox's approach. */
async function bodyFromOwnCopy(state: AadOSState, account: MailAccount, m: SharedMessage): Promise<{ html: string; text: string } | string> {
  const wanted = normSubject(m.subject);
  if (!wanted || wanted === '(no subject)') return 'no subject to match on';
  const key = wanted.replace(/[:"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const q = new URLSearchParams({ searchKey: `subject:${key}`, limit: '50', start: '1' });
  const found = await zohoRequest(state, account, 'GET', `/accounts/${encodeURIComponent(account.remoteId)}/messages/search?${q}`);
  const rows: Raw[] = (Array.isArray(found.data) ? found.data : []).filter((r: Raw) => r.messageId && r.folderId);
  const same = rows.filter((r) => { const s = normSubject(String(r.subject || '')); return s === wanted || s.includes(wanted) || wanted.includes(s); });
  const at = m.at || Date.now();
  const best = same.map((r) => ({ r, diff: Math.abs(time(r.receivedTime ?? r.sentDateInGMT) - at) })).sort((a, b) => a.diff - b.diff)[0];
  if (!best) return `search returned ${rows.length} message(s), none with this subject in ${account.email}`;
  if (best.diff > 6 * 3600_000) return `closest same-subject copy is ${Math.round(best.diff / 60_000)} min off`;
  const full = await zohoRequest(state, account, 'GET', `/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(String(best.r.folderId))}/messages/${encodeURIComponent(String(best.r.messageId))}/content`);
  const raw = typeof full.data?.content === 'string' ? full.data.content : '';
  if (!raw) return `copy ${best.r.messageId} returned no content`;
  const b = asBody(raw); return { html: b.html, text: b.text };
}

/** Full body for a shared-mailbox message: v2 detail first, then the member's own delivered copy, else the summary. */
export async function sharedBody(state: AadOSState, account: MailAccount, address: string, id: string): Promise<{ html: string; text: string; note: string }> {
  const m = msgCache().get(`${account.id}|${id}`);
  if (!m) return { html: '', text: '', note: 'Reload the list and open the message again.' };
  const reasons: string[] = [];
  try {
    const detail = await zohoRequest(state, account, 'GET', `/v2/sharedmailbox/${encodeURIComponent(address)}/messages/${encodeURIComponent(id)}`);
    const raw = bodyFromDetail(detail, m.summary);
    if (raw) return asBody(raw);
    const c = detail?.data?.message?.content;
    reasons.push(`v2 detail content keys: ${c && typeof c === 'object' ? Object.keys(c).join(',') || 'none' : typeof c}`);
  } catch (e) { reasons.push(`v2 detail failed: ${e instanceof Error ? e.message : 'error'}`); }
  try {
    const copy = await bodyFromOwnCopy(state, account, m);
    if (typeof copy !== 'string') return { ...copy, note: '' };
    reasons.push(copy);
  } catch (e) { reasons.push(`own-copy lookup failed: ${e instanceof Error ? e.message : 'error'}`); }
  console.warn('[aados] Zoho shared-mailbox body unavailable:', address, id, reasons.join(' | ').slice(0, 600));
  return { html: '', text: m.summary, note: `Full body unavailable (${reasons[reasons.length - 1]}); showing the summary.` };
}

export async function setSharedRead(state: AadOSState, account: MailAccount, address: string, id: string, read: boolean) {
  await zohoRequest(state, account, 'PUT', `/v2/sharedmailbox/${encodeURIComponent(address)}/messages/${encodeURIComponent(id)}/${read ? 'read' : 'unread'}`);
  const m = msgCache().get(`${account.id}|${id}`); if (m) m.unread = !read;
}
export async function trashShared(state: AadOSState, account: MailAccount, address: string, id: string) {
  await zohoRequest(state, account, 'PUT', `/v2/sharedmailbox/${encodeURIComponent(address)}/messages/${encodeURIComponent(id)}/trash`);
}
