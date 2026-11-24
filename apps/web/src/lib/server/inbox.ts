// Unified inbox: one row per source message across every connected account and view.
// Pure module (type-only imports) so it can be tested with `node --test`.
import type { MailAccount, Pipeline, PipelineItem } from './aados-store';
import { classify, couponExpiry, detectAction, importance, type ActionKind } from './categories.ts';
import { recipients } from '../recipients.ts';

export type InboxView = 'inbox' | 'all' | 'unread' | 'important' | 'needs-reply' | 'recent' | 'read' | 'attention' | 'people' | 'bills' | 'bulk';
export type InboxQuery = {
  view?: InboxView; account?: string; provider?: string; sender?: string; from?: string; to?: string;
  read?: 'read' | 'unread' | ''; category?: string; importance?: 'high' | ''; pipeline?: string; thread?: string; folder?: string;
  /** Parsed kind of the copy in `pipeline` (Shopping: order, shipping, return, coupon, other). */
  kind?: string;
  /** Saved value on the message (Shopping tiles: Coupons, Gift Cards). */
  saved?: 'coupon' | 'gift-card' | '';
  q?: string; page?: number; pageSize?: number;
};
export type InboxRow = {
  key: string; id: string; pipelineId: string; messageId: string; subject: string; sender: string; receivedAt: string; summary: string;
  /** Addresses the message was sent to (lower-case; aliases included). */
  to: string[];
  unread: boolean; accountId: string; accountEmail: string; provider: 'zoho' | 'gmail' | ''; categories: string[];
  importance: 'high' | 'normal'; action: ActionKind | null; actionReason: string; due: string; reviewed: boolean; followUp: string;
  savedKind: 'coupon' | 'gift-card' | ''; savedExpiry: string;
  /** `${pipelineId}:${kind}` for each view copy (the parsed kind differs per view parser). */
  kinds: string[];
  inInbox: boolean; threadId: string; threadCount: number; pipelines: string[]; copyIds: string[]; folders: string[];
};
export type InboxResult = {
  rows: InboxRow[]; total: number; page: number; pageSize: number; pages: number;
  counts: { inbox: number; all: number; unread: number; important: number; needsReply: number; recent: number; read: number; attention: number; people: number; bills: number; bulk: number; categories: Record<string, number>; accounts: Record<string, number> };
};

export const RECENT_DAYS = 7;
/** Mailbox unread state (the provider is the source of truth; a local "seen" no longer hides unread mail). */
export const itemUnread = (item: Pick<PipelineItem, 'unread' | 'seen'>) => item.unread !== false;
export const messageKey = (accountId: string, messageId: string) => `${accountId}:${messageId}`;

/** Mailbox folder (Zoho folder / Gmail label) a stored copy came from: its recorded folder, else its view's only folder in that account. */
export function itemFolder(item: Pick<PipelineItem, 'folderId' | 'accountId'>, pipeline?: Pick<Pipeline, 'accountId' | 'folderId' | 'folders'>) {
  if (item.folderId) return item.folderId;
  if (!pipeline) return '';
  const account = item.accountId || pipeline.accountId;
  const list = (pipeline.folders?.length ? pipeline.folders : [{ id: pipeline.folderId, accountId: pipeline.accountId }]).filter((f) => (f.accountId || pipeline.accountId) === account);
  return list.length === 1 ? list[0].id : '';
}

/** Per-account folders with message and unread counts (each message counted once per folder). */
export function folderSummary(input: { pipelines: Pipeline[]; accounts: MailAccount[]; items: PipelineItem[] }) {
  const byPipeline = new Map(input.pipelines.map((p) => [p.id, p]));
  const seen = new Map<string, { total: Set<string>; unread: Set<string>; read: Set<string> }>();
  for (const item of input.items) {
    const pipeline = byPipeline.get(item.pipelineId);
    const account = item.accountId || pipeline?.accountId || '';
    const folder = itemFolder(item, pipeline);
    if (!account || !folder) continue;
    const k = `${account}\u0000${folder}`;
    let e = seen.get(k); if (!e) seen.set(k, (e = { total: new Set(), unread: new Set(), read: new Set() }));
    e.total.add(item.messageId);
    if (itemUnread(item)) e.unread.add(item.messageId); else e.read.add(item.messageId);
  }
  const names = new Map<string, string>();
  for (const p of input.pipelines) for (const f of p.folders?.length ? p.folders : [{ id: p.folderId, name: p.folderName, accountId: p.accountId }]) names.set(`${f.accountId || p.accountId}\u0000${f.id}`, f.name);
  for (const a of input.accounts) for (const f of a.folders || []) names.set(`${a.id}\u0000${f.id}`, f.name);
  const out: Record<string, { id: string; name: string; total: number; unread: number }[]> = {};
  for (const [k, e] of seen) {
    const [account, id] = k.split('\u0000');
    // A message read in any copy counts as read (same rule as the inbox rows).
    const unread = [...e.unread].filter((m) => !e.read.has(m)).length;
    (out[account] ||= []).push({ id, name: names.get(k) || id, total: e.total.size, unread });
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.name.toLowerCase() === 'inbox' ? -1 : b.name.toLowerCase() === 'inbox' ? 1 : a.name.localeCompare(b.name)));
  return out;
}

/** Collapse copies of the same source message (several views / labels) into one row. */
export function buildRows(input: { pipelines: Pipeline[]; accounts: MailAccount[]; items: PipelineItem[]; familyNames?: string[]; now?: Date }): InboxRow[] {
  const byPipeline = new Map(input.pipelines.map((p) => [p.id, p]));
  const byAccount = new Map(input.accounts.map((a) => [a.id, a]));
  const groups = new Map<string, PipelineItem[]>();
  for (const item of input.items) {
    const pipeline = byPipeline.get(item.pipelineId);
    const accountId = item.accountId || pipeline?.accountId || '';
    const key = messageKey(accountId, item.messageId);
    const list = groups.get(key);
    if (list) list.push(item); else groups.set(key, [item]);
  }
  const rows: InboxRow[] = [];
  const threads = new Map<string, number>();
  for (const [key, copies] of groups) {
    const first = copies.find((c) => c.folderId) || copies[0];
    const pipeline = byPipeline.get(first.pipelineId);
    const accountId = first.accountId || pipeline?.accountId || '';
    const account = byAccount.get(accountId);
    // Local state set on any copy applies to the message.
    const merged = {
      ...first,
      categories: copies.find((c) => c.categories?.length)?.categories,
      importance: copies.find((c) => c.importance)?.importance,
      actionState: copies.find((c) => c.actionState)?.actionState,
      followUp: copies.find((c) => c.followUp)?.followUp,
      savedValue: copies.find((c) => c.savedValue)?.savedValue,
      savedValueDismissed: copies.some((c) => c.savedValueDismissed)
    };
    const ctx = { accountEmail: account?.email, familyNames: input.familyNames, now: input.now };
    const categories = classify(merged, ctx);
    const suggestion = detectAction(merged, ctx);
    const automaticCouponExpiry = couponExpiry(merged, ctx);
    const threadId = copies.find((c) => c.threadId)?.threadId || '';
    if (threadId) threads.set(`${accountId}:${threadId}`, (threads.get(`${accountId}:${threadId}`) || 0) + 1);
    rows.push({
      key, id: first.id, pipelineId: first.pipelineId, messageId: first.messageId, subject: first.subject, sender: first.sender,
      to: recipients(copies.find((c) => c.to)?.to),
      receivedAt: first.receivedAt, summary: first.summary,
      // Opened in AadOS on any copy counts as read; otherwise unread only if every synced copy says unread.
      unread: copies.every((c) => c.unread !== false),
      accountId, accountEmail: account?.email || '', provider: account?.provider || '', categories,
      importance: importance(merged, categories, ctx), action: suggestion?.kind || null, actionReason: suggestion?.reason || '', due: suggestion?.due || '',
      reviewed: merged.actionState === 'reviewed', followUp: merged.followUp || '',
      savedKind: merged.savedValue?.kind || (automaticCouponExpiry ? 'coupon' : ''), savedExpiry: merged.savedValue?.expiresOn || automaticCouponExpiry,
      inInbox: copies.some((c) => byPipeline.get(c.pipelineId)?.system), threadId, threadCount: 1,
      pipelines: [...new Set(copies.map((c) => byPipeline.get(c.pipelineId)).filter((p): p is Pipeline => Boolean(p && !p.system)).map((p) => p.name))],
      copyIds: copies.map((c) => c.id),
      kinds: [...new Set(copies.filter((c) => c.kind).map((c) => `${c.pipelineId}:${c.kind}`))],
      folders: [...new Set(copies.map((c) => itemFolder(c, byPipeline.get(c.pipelineId))).filter(Boolean))]
    });
  }
  for (const row of rows) if (row.threadId) row.threadCount = threads.get(`${row.accountId}:${row.threadId}`) || 1;
  return rows.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.key.localeCompare(b.key));
}

const needsReply = (row: InboxRow) => row.action === 'reply' && !row.reviewed;
// Smart views. Recent = the newest 10 messages.
export const RECENT_COUNT = 10;
const BULK = ['Newsletters', 'Promotions', 'Notifications'];
const isBulk = (r: InboxRow) => r.categories.some((c) => BULK.includes(c)) && !r.categories.some((c) => c === 'Personal' || c === 'Family');
const within = (r: InboxRow, days: number, now: number) => now - Date.parse(r.receivedAt) <= days * 86_400_000;
/** Real people writing to you (not newsletters, promotions or automated notifications). */
const isPeople = (r: InboxRow) => r.categories.some((c) => c === 'Personal' || c === 'Family') && !isBulk(r);
/** Needs attention: important, a reply, a payment or an appointment — recent (14 days), not reviewed, not bulk. */
const isAttention = (r: InboxRow, now: number) => !r.reviewed && !isBulk(r) && within(r, 14, now) && (r.importance === 'high' || r.action === 'reply' || r.action === 'financial' || r.action === 'appointment');
/** Bills & renewals: billing/subscription mail from the last 45 days, or with a due date still ahead. */
const isBills = (r: InboxRow, now: number) => r.categories.some((c) => c === 'Bills' || c === 'Payments' || c === 'Renewals' || c === 'Subscriptions') && (within(r, 45, now) || (r.due !== '' && Date.parse(r.due) >= now - 86_400_000));

/** Every search word must appear in subject, sender, preview, account, provider, categories or view names. */
function matchesText(row: InboxRow, terms: string[]) {
  if (!terms.length) return true;
  const hay = `${row.subject} ${row.sender} ${row.to.join(' ')} ${row.summary} ${row.accountEmail} ${row.provider} ${row.categories.join(' ')} ${row.pipelines.join(' ')}`.toLowerCase().replace(/['’`]/g, '');
  // Older Zoho mail was stored with the sender's name only; a pasted "Name <address>" still finds it by the name.
  const noAddress = !row.sender.includes('@');
  return terms.every((term) => hay.includes(term) || (noAddress && term.includes('@')));
}

export function queryInbox(rows: InboxRow[], query: InboxQuery, now = Date.now()): InboxResult {
  const view = query.view || 'all';
  // Pasted senders (\"Dunkin' Rewards <noreply@…>\") search as words: brackets, quotes and commas are ignored.
  const terms = (query.q || '').toLowerCase().replace(/['’`]/g, '').replace(/[<>"(),;!?]/g, ' ').split(/\s+/).filter(Boolean);
  const sender = (query.sender || '').toLowerCase();
  const from = query.from ? Date.parse(query.from) : NaN;
  const to = query.to ? Date.parse(query.to) + 86_399_999 : NaN;
  const pageSize = Math.min(Math.max(Math.floor(query.pageSize || 50), 1), 200);

  // Counts reflect the whole (deduplicated) mailbox, narrowed only by account/provider scope.
  const scoped = rows.filter((r) => (!query.account || r.accountId === query.account) && (!query.provider || r.provider === query.provider) && (!query.folder || r.folders.includes(query.folder)));
  const counts: InboxResult['counts'] = { inbox: 0, all: scoped.length, unread: 0, important: 0, needsReply: 0, recent: 0, read: 0, attention: 0, people: 0, bills: 0, bulk: 0, categories: {}, accounts: {} };
  for (const r of scoped) {
    if (r.inInbox) counts.inbox++;
    if (r.unread) counts.unread++;
    if (r.importance === 'high') counts.important++;
    if (needsReply(r)) counts.needsReply++;
    if (!r.unread) counts.read++;
    if (isAttention(r, now)) counts.attention++;
    if (isPeople(r)) counts.people++;
    if (isBills(r, now)) counts.bills++;
    if (isBulk(r)) counts.bulk++;
    for (const c of r.categories) counts.categories[c] = (counts.categories[c] || 0) + 1;
  }
  counts.recent = Math.min(RECENT_COUNT, scoped.length);
  for (const r of rows) counts.accounts[r.accountId] = (counts.accounts[r.accountId] || 0) + 1;

  // Searching works like a mail client: the whole account (or all inboxes), every folder and tab — not just the tab/folder on screen.
  const searching = terms.length > 0;
  const pool = searching ? rows.filter((r) => (!query.account || r.accountId === query.account) && (!query.provider || r.provider === query.provider)) : scoped;
  const filtered = pool.filter((r) => searching ? matchesText(r, terms) : (
    (view !== 'inbox' || r.inInbox) && (view !== 'unread' || r.unread) && (view !== 'important' || r.importance === 'high') && (view !== 'needs-reply' || needsReply(r))
    && (view !== 'read' || !r.unread)
    && (view !== 'attention' || isAttention(r, now)) && (view !== 'people' || isPeople(r)) && (view !== 'bills' || isBills(r, now)) && (view !== 'bulk' || isBulk(r))
    && (!sender || r.sender.toLowerCase().includes(sender))
    && (Number.isNaN(from) || Date.parse(r.receivedAt) >= from) && (Number.isNaN(to) || Date.parse(r.receivedAt) <= to)
    && (query.read !== 'unread' || r.unread) && (query.read !== 'read' || !r.unread)
    && (!query.category || r.categories.includes(query.category))
    && (query.importance !== 'high' || r.importance === 'high')
    && (!query.pipeline || r.copyIds.some((id) => id.startsWith(`${query.pipeline}:`)))
    && (!query.thread || r.threadId === query.thread)
    && (!query.kind || r.kinds.some((k) => query.pipeline ? k === `${query.pipeline}:${query.kind}` : k.endsWith(`:${query.kind}`)))
    && (!query.saved || r.savedKind === query.saved)
    && matchesText(r, terms)));
  // Saved coupons: soonest expiry first.
  if (query.saved === 'coupon') filtered.sort((a, b) => a.savedExpiry.localeCompare(b.savedExpiry));
  // Recent is simply the newest messages, no paging.
  if (view === 'recent') { const rows = filtered.slice(0, RECENT_COUNT); return { rows, total: rows.length, page: 1, pageSize: RECENT_COUNT, pages: 1, counts: { ...counts, recent: Math.min(RECENT_COUNT, filtered.length) } }; }
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(Math.floor(query.page || 1), 1), pages);
  return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, pages, counts };
}
