// Reader tools: message details (From/To/unsubscribe), reply/reply-all/forward (sent only when the owner clicks
// Send), "More from this sender", and Gmail filters (Rules).
import { readState, updateStateDetached, type AadOSState, type MailAccount } from './aados-store';
import { buildRows, type InboxRow } from './inbox';
import { createGmailFilter, deleteGmailFilter, fetchGmailAttachment, fetchGmailBody, gmailHeaders, listGmailAttachments, listGmailFilters, sendGmail, type GmailFilter } from './gmail';
import { fetchZohoBody, replyZoho, sendZoho, zohoHeaders, zohoRequest } from './zoho';
import { addresses, buildMime, quote, recipients, subjectFor, threading, unsubscribeFromHeader, unsubscribeFromHtml, validAddressList, type Attachment, type Headers, type Mode } from './compose';
import { htmlToText } from './ai/email-ai';

const rowsOf = (s: AadOSState) => buildRows({ pipelines: s.pipelines, accounts: s.accounts, items: s.items });
function locate(s: AadOSState, key: string) {
  const row = rowsOf(s).find((r) => r.key === key);
  if (!row) throw new Error('Email not found.');
  const item = s.items.find((i) => i.id === row.id)!;
  const pipeline = s.pipelines.find((p) => p.id === row.pipelineId)!;
  const account = s.accounts.find((a) => a.id === row.accountId);
  if (!account) throw new Error('This account is no longer connected.');
  return { row, item, pipeline, account };
}

export type Details = { from: string; to: string; cc: string; replyTo: string; subject: string; date: string; account: string; provider: string; unsubscribe: { url: string; mailto: string }; canSend: boolean; canFilter: boolean; canModify: boolean; text: string; headers: Headers; threadId: string };

/** Headers + plain text of one message (read-only provider calls; token refreshes are saved). */
export async function details(key: string): Promise<Details> {
  let out: Details | null = null;
  await updateStateDetached(async (s) => {
    const { item, pipeline, account } = locate(s, key);
    let headers: Headers = {}, threadId = '', html = '', text = '';
    if (account.provider === 'gmail') {
      const h = await gmailHeaders(s, account, item.messageId); headers = h.headers; threadId = h.threadId;
      const b = await fetchGmailBody(s, account, item); html = b.html; text = b.text;
    } else {
      headers = await zohoHeaders(s, account, item.folderId || '', item.messageId).catch(() => ({}));
      const b = await fetchZohoBody(s, account, pipeline, item); html = b.html; text = b.text;
    }
    const unsub = unsubscribeFromHeader(headers['list-unsubscribe']);
    if (!unsub.url && html) unsub.url = unsubscribeFromHtml(html);
    out = { from: headers.from || item.sender, to: headers.to || '', cc: headers.cc || '', replyTo: headers['reply-to'] || '', subject: headers.subject || item.subject, date: headers.date || item.receivedAt, account: account.email, provider: account.provider,
      unsubscribe: unsub, canSend: Boolean(account.canSend), canFilter: Boolean(account.canFilter), canModify: Boolean(account.canModify), text: (text || htmlToText(html)).slice(0, 20000), headers, threadId };
  });
  return out!;
}

/** Defaults for the compose form. */
export async function prepare(key: string, mode: Mode) {
  const d = await details(key);
  const r = recipients(mode, d.headers.from ? d.headers : { ...d.headers, from: d.from }, d.account);
  return { mode, from: d.account, to: r.to.join(', '), cc: r.cc.join(', '), subject: subjectFor(mode, d.subject), quoted: quote(mode, { ...d.headers, from: d.from, subject: d.subject, date: d.date }, d.text), canSend: d.canSend, provider: d.provider };
}

const RESIDENTIAL_ADDRESS = 'leads@intlord.com';
const RESIDENTIAL_TEMPLATE = 'Schedule Your Showing – Text Us Directly';

/** Toolbox-compatible residential reply: use the real saved Zoho template and the leads alias. */
export async function prepareResidential(key: string) {
  const reply = await prepare(key, 'reply');
  let template = '';
  await updateStateDetached(async (s) => {
    const { account } = locate(s, key);
    if (account.provider !== 'zoho') throw new Error('Residential templates are available for Zoho email.');
    if (!account.email.toLowerCase().endsWith('@intlord.com')) throw new Error('Residential templates are available for Intlord mailboxes.');
    const folder = account.folders.find((f) => f.name.toLowerCase() === 'templates' || f.type.toLowerCase() === 'templates');
    if (!folder) throw new Error('No Zoho Templates folder was found for this account.');
    const q = new URLSearchParams({ folderId: folder.id, start: '1', limit: '200' });
    const page = await zohoRequest(s, account, 'GET', `/accounts/${encodeURIComponent(account.remoteId)}/messages/view?${q}`);
    const row = (Array.isArray(page.data) ? page.data : []).find((m: Record<string, unknown>) => String(m.subject || '').localeCompare(RESIDENTIAL_TEMPLATE, undefined, { sensitivity: 'accent' }) === 0);
    if (!row) throw new Error(`Couldn't find the saved Zoho template “${RESIDENTIAL_TEMPLATE}”.`);
    const messageId = String(row.messageId || '');
    const body = await zohoRequest(s, account, 'GET', `/accounts/${encodeURIComponent(account.remoteId)}/folders/${encodeURIComponent(folder.id)}/messages/${encodeURIComponent(messageId)}/content`);
    template = htmlToText(String(body.data?.content || body.data?.htmlContent || '')).trim();
    if (!template) throw new Error(`The saved Zoho template “${RESIDENTIAL_TEMPLATE}” is empty.`);
  });
  const cc = Array.from(new Set([...list(reply.cc), RESIDENTIAL_ADDRESS])).join(', ');
  return { ...reply, from: RESIDENTIAL_ADDRESS, cc, template, templateTitle: RESIDENTIAL_TEMPLATE, residential: true };
}

const list = (v: string) => v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
const MAX_FORWARD_BYTES = 20 * 1024 * 1024;

/** Send what the owner wrote. Reply/reply-all stay in the original thread; Gmail forwards can carry the attachments. */
export async function send(key: string, m: { mode: Mode; to: string; cc: string; bcc: string; subject: string; text: string; attachments: boolean; residential?: boolean }) {
  for (const [label, v] of [['To', m.to], ['Cc', m.cc], ['Bcc', m.bcc]] as const) if (v.trim() && !validAddressList(v)) throw new Error(`${label} contains an invalid address.`);
  if (!list(m.to).length && !list(m.cc).length && !list(m.bcc).length) throw new Error('Add at least one recipient.');
  if (!m.subject.trim()) throw new Error('Add a subject.');
  let note = '';
  await updateStateDetached(async (s) => {
    const { item, account } = locate(s, key);
    if (!account.canSend) throw new Error(`${account.email}: AadOS may not send from this account yet. Settings → Emails → “Allow changes”.`);
    if (account.provider === 'gmail') {
      const { headers, threadId } = await gmailHeaders(s, account, item.messageId);
      const files: Attachment[] = [];
      if (m.mode === 'forward' && m.attachments) {
        let total = 0;
        for (const a of await listGmailAttachments(s, account, item.messageId)) {
          if ((total += a.size) > MAX_FORWARD_BYTES) { note = 'Some attachments were too large to forward.'; break; }
          files.push({ filename: a.name, mime: a.mime, data: await fetchGmailAttachment(s, account, item.messageId, a.id) });
        }
      }
      const t = m.mode === 'forward' ? { inReplyTo: '', references: '' } : threading(headers);
      const raw = buildMime({ from: account.email, to: list(m.to), cc: list(m.cc), bcc: list(m.bcc), subject: m.subject, text: m.text, inReplyTo: t.inReplyTo, references: t.references, attachments: files });
      await sendGmail(s, account, raw, m.mode === 'forward' ? '' : threadId);
    } else {
      const residential = m.residential === true;
      if (residential && !account.email.toLowerCase().endsWith('@intlord.com')) throw new Error('Residential templates are available for Intlord mailboxes.');
      const cc = list(m.cc);
      if (residential && !cc.some((a) => a.toLowerCase() === RESIDENTIAL_ADDRESS)) cc.push(RESIDENTIAL_ADDRESS);
      const out = { from: residential ? RESIDENTIAL_ADDRESS : account.email, to: list(m.to), cc, bcc: list(m.bcc), subject: m.subject, text: m.text };
      if (m.mode === 'forward') { await sendZoho(s, account, out); if (m.attachments) note = 'Zoho forwards are sent without the original attachments.'; }
      else await replyZoho(s, account, item.messageId, out);
    }
  });
  return { sent: true, note };
}

const normSubject = (s: string) => s.toLowerCase().replace(/^\s*((re|fwd?|fw|aw|wg)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();
/** Other messages from the same sender (or domain), optionally only the same conversation subject. */
export async function related(key: string, scope: 'sender' | 'domain', sameSubject: boolean) {
  const s = await readState();
  const rows = rowsOf(s);
  const me = rows.find((r) => r.key === key);
  if (!me) throw new Error('Email not found.');
  // Zoho lists give only the display name ("Dunkin' Rewards"), so older stored mail may have no address: read it from
  // the message header. Never match "no address" to "no address" — that listed every such email as the same sender.
  let addr = addresses(me.sender)[0] || '';
  if (!addr && me.provider === 'zoho' && me.folders[0]) {
    await updateStateDetached(async (st) => {
      const acct = st.accounts.find((a) => a.id === me.accountId);
      if (acct) addr = addresses((await zohoHeaders(st, acct, me.folders[0], me.messageId).catch(() => ({} as Record<string, string>))).from)[0] || '';
    }).catch(() => undefined);
  }
  const domain = addr.split('@')[1] || '';
  const subj = normSubject(me.subject);
  const nameOf = (v: string) => v.replace(/<[^>]*>/g, '').replace(/["'’`]/g, '').trim().toLowerCase();
  const myName = nameOf(me.sender);
  const match = (r: InboxRow) => {
    const a = addresses(r.sender)[0] || '';
    if (a) return scope === 'domain' ? Boolean(domain) && a.endsWith(`@${domain}`) : Boolean(addr) && a === addr;
    return Boolean(myName) && nameOf(r.sender) === myName; // no address stored: same display name only
  };
  const hits = rows.filter((r) => r.key !== key && r.accountId === me.accountId && match(r) && (!sameSubject || normSubject(r.subject) === subj));
  return { sender: addr, domain, total: hits.length, rows: hits.slice(0, 50).map((r) => ({ key: r.key, subject: r.subject, summary: r.summary, sender: r.sender, receivedAt: r.receivedAt, unread: r.unread, pipelineId: r.pipelineId, messageId: r.messageId, accountEmail: r.accountEmail, provider: r.provider })) };
}

// ---- Rules (Gmail filters) ----
function gmailAccount(s: AadOSState, id: string): MailAccount {
  const a = s.accounts.find((x) => x.id === id);
  if (!a) throw new Error('Account not found.');
  if (a.provider !== 'gmail') throw new Error('Rules are available for Gmail accounts.');
  if (!a.canFilter) throw new Error(`${a.email}: AadOS may not manage Gmail filters yet. Settings → Emails → “Allow changes”.`);
  return a;
}
export async function rules(accountId: string) {
  let filters: GmailFilter[] = [], labels: { id: string; name: string }[] = [];
  await updateStateDetached(async (s) => { const a = gmailAccount(s, accountId); filters = await listGmailFilters(s, a); labels = a.folders.filter((f) => f.type === 'label').map((f) => ({ id: f.id, name: f.name })); });
  return { filters, labels };
}
export async function createRule(accountId: string, r: { field: 'from' | 'subject'; text: string; labelId: string; markRead: boolean; archive: boolean }) {
  const text = r.text.trim().slice(0, 200);
  if (!text) throw new Error('Enter what to match.');
  if (!r.labelId && !r.markRead && !r.archive) throw new Error('Choose at least one action.');
  let created: GmailFilter | null = null;
  await updateStateDetached(async (s) => {
    const a = gmailAccount(s, accountId);
    if (r.labelId && !a.folders.some((f) => f.id === r.labelId)) throw new Error('Unknown label.');
    const remove = [...(r.markRead ? ['UNREAD'] : []), ...(r.archive ? ['INBOX'] : [])];
    created = await createGmailFilter(s, a, { criteria: { [r.field]: text }, action: { ...(r.labelId ? { addLabelIds: [r.labelId] } : {}), ...(remove.length ? { removeLabelIds: remove } : {}) } });
  });
  return created;
}
/** Gmail filter from several criteria (all must match; `query` = Gmail search words, used for body text). */
export async function createRuleCriteria(accountId: string, criteria: { from?: string; to?: string; subject?: string; query?: string }, act: { markRead: boolean; archive: boolean; labelId?: string }) {
  if (!Object.values(criteria).some(Boolean)) throw new Error('Enter what to match.');
  if (!act.markRead && !act.archive && !act.labelId) throw new Error('Choose at least one action.');
  let created: GmailFilter | null = null;
  await updateStateDetached(async (s) => {
    const a = gmailAccount(s, accountId);
    const remove = [...(act.markRead ? ['UNREAD'] : []), ...(act.archive ? ['INBOX'] : [])];
    created = await createGmailFilter(s, a, { criteria, action: { ...(act.labelId ? { addLabelIds: [act.labelId] } : {}), ...(remove.length ? { removeLabelIds: remove } : {}) } });
  });
  return created;
}
export async function removeRule(accountId: string, id: string) {
  await updateStateDetached(async (s) => { await deleteGmailFilter(s, gmailAccount(s, accountId), id); });
}
