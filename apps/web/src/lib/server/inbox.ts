// Unified inbox: one row per source message across every connected account and view.
// Pure module (type-only imports) so it can be tested with `node --test`.
import type { MailAccount, Pipeline, PipelineItem } from './aados-store';
import { classify, detectAction, importance, type ActionKind } from './categories.ts';

export type InboxView = 'inbox' | 'all' | 'unread' | 'important' | 'needs-reply' | 'recent' | 'read';
export type InboxQuery = {
  view?: InboxView; account?: string; provider?: string; sender?: string; from?: string; to?: string;
  read?: 'read' | 'unread' | ''; category?: string; importance?: 'high' | ''; pipeline?: string; thread?: string;
  q?: string; page?: number; pageSize?: number;
};
export type InboxRow = {
  key: string; id: string; pipelineId: string; messageId: string; subject: string; sender: string; receivedAt: string; summary: string;
  unread: boolean; accountId: string; accountEmail: string; provider: 'zoho' | 'gmail' | ''; categories: string[];
  importance: 'high' | 'normal'; action: ActionKind | null; actionReason: string; due: string; reviewed: boolean; followUp: string;
  inInbox: boolean; threadId: string; threadCount: number; pipelines: string[]; copyIds: string[];
};
export type InboxResult = {
  rows: InboxRow[]; total: number; page: number; pageSize: number; pages: number;
  counts: { inbox: number; all: number; unread: number; important: number; needsReply: number; recent: number; read: number; categories: Record<string, number>; accounts: Record<string, number> };
};

export const RECENT_DAYS = 7;
/** Mailbox unread state, unless the owner already opened it in AadOS. */
export const itemUnread = (item: Pick<PipelineItem, 'unread' | 'seen'>) => item.unread !== false && !item.seen;
export const messageKey = (accountId: string, messageId: string) => `${accountId}:${messageId}`;

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
      followUp: copies.find((c) => c.followUp)?.followUp
    };
    const ctx = { accountEmail: account?.email, familyNames: input.familyNames, now: input.now };
    const categories = classify(merged, ctx);
    const suggestion = detectAction(merged, ctx);
    const threadId = copies.find((c) => c.threadId)?.threadId || '';
    if (threadId) threads.set(`${accountId}:${threadId}`, (threads.get(`${accountId}:${threadId}`) || 0) + 1);
    rows.push({
      key, id: first.id, pipelineId: first.pipelineId, messageId: first.messageId, subject: first.subject, sender: first.sender,
      receivedAt: first.receivedAt, summary: first.summary,
      // Opened in AadOS on any copy counts as read; otherwise unread only if every synced copy says unread.
      unread: !copies.some((c) => c.seen) && copies.every((c) => c.unread !== false),
      accountId, accountEmail: account?.email || '', provider: account?.provider || '', categories,
      importance: importance(merged, categories, ctx), action: suggestion?.kind || null, actionReason: suggestion?.reason || '', due: suggestion?.due || '',
      reviewed: merged.actionState === 'reviewed', followUp: merged.followUp || '',
      inInbox: copies.some((c) => byPipeline.get(c.pipelineId)?.system), threadId, threadCount: 1,
      pipelines: [...new Set(copies.map((c) => byPipeline.get(c.pipelineId)).filter((p): p is Pipeline => Boolean(p && !p.system)).map((p) => p.name))],
      copyIds: copies.map((c) => c.id)
    });
  }
  for (const row of rows) if (row.threadId) row.threadCount = threads.get(`${row.accountId}:${row.threadId}`) || 1;
  return rows.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.key.localeCompare(b.key));
}

const needsReply = (row: InboxRow) => row.action === 'reply' && !row.reviewed;
const isRecent = (row: InboxRow, now: number) => now - Date.parse(row.receivedAt) <= RECENT_DAYS * 86_400_000;

/** Every search word must appear in subject, sender, preview, account, provider, categories or view names. */
function matchesText(row: InboxRow, terms: string[]) {
  if (!terms.length) return true;
  const hay = `${row.subject} ${row.sender} ${row.summary} ${row.accountEmail} ${row.provider} ${row.categories.join(' ')} ${row.pipelines.join(' ')}`.toLowerCase();
  return terms.every((term) => hay.includes(term));
}

export function queryInbox(rows: InboxRow[], query: InboxQuery, now = Date.now()): InboxResult {
  const view = query.view || 'all';
  const terms = (query.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const sender = (query.sender || '').toLowerCase();
  const from = query.from ? Date.parse(query.from) : NaN;
  const to = query.to ? Date.parse(query.to) + 86_399_999 : NaN;
  const pageSize = Math.min(Math.max(Math.floor(query.pageSize || 50), 1), 200);

  // Counts reflect the whole (deduplicated) mailbox, narrowed only by account/provider scope.
  const scoped = rows.filter((r) => (!query.account || r.accountId === query.account) && (!query.provider || r.provider === query.provider));
  const counts: InboxResult['counts'] = { inbox: 0, all: scoped.length, unread: 0, important: 0, needsReply: 0, recent: 0, read: 0, categories: {}, accounts: {} };
  for (const r of scoped) {
    if (r.inInbox) counts.inbox++;
    if (r.unread) counts.unread++;
    if (r.importance === 'high') counts.important++;
    if (needsReply(r)) counts.needsReply++;
    if (isRecent(r, now)) counts.recent++;
    if (!r.unread) counts.read++;
    for (const c of r.categories) counts.categories[c] = (counts.categories[c] || 0) + 1;
  }
  for (const r of rows) counts.accounts[r.accountId] = (counts.accounts[r.accountId] || 0) + 1;

  const filtered = scoped.filter((r) =>
    (view !== 'inbox' || r.inInbox) && (view !== 'unread' || r.unread) && (view !== 'important' || r.importance === 'high') && (view !== 'needs-reply' || needsReply(r))
    && (view !== 'recent' || isRecent(r, now)) && (view !== 'read' || !r.unread)
    && (!sender || r.sender.toLowerCase().includes(sender))
    && (Number.isNaN(from) || Date.parse(r.receivedAt) >= from) && (Number.isNaN(to) || Date.parse(r.receivedAt) <= to)
    && (query.read !== 'unread' || r.unread) && (query.read !== 'read' || !r.unread)
    && (!query.category || r.categories.includes(query.category))
    && (query.importance !== 'high' || r.importance === 'high')
    && (!query.pipeline || r.copyIds.some((id) => id.startsWith(`${query.pipeline}:`)))
    && (!query.thread || r.threadId === query.thread)
    && matchesText(r, terms));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(Math.floor(query.page || 1), 1), pages);
  return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, pages, counts };
}
