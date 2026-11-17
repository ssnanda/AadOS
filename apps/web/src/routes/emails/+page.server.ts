import { fail, type Actions } from '@sveltejs/kit';
import { applyToMailbox } from '$lib/server/mail-actions';
import { keyAllowed, scopeState } from '$lib/server/scope';
import type { PageServerLoad } from './$types';
import { database, hasDatabase } from '$lib/server/aados-store';
import { getInsights } from '$lib/server/ai/db';
import { ensureInboxPipelines, missingInboxPipelines, readState, updateState, visiblePipelines } from '$lib/server/aados-store';
import { buildRows, folderSummary, queryInbox, type InboxQuery, type InboxView } from '$lib/server/inbox';
import { CATEGORIES } from '$lib/server/categories';
import { isUnread } from '$lib/server/search';

// Tabs: unread, recent, smart views, all. Older views (important, needs-reply, inbox, read) still work for existing links.
const VIEWS: InboxView[] = ['unread', 'recent', 'attention', 'people', 'bills', 'bulk', 'all', 'inbox', 'important', 'needs-reply', 'read'];

export const load: PageServerLoad = async ({ url, locals }) => {
  let state = await readState();
  // First visit after connecting an account: create the hidden per-account inbox feeds (never touches existing data).
  if (missingInboxPipelines(state)) { await updateState((s) => { ensureInboxPipelines(s); }); state = await readState(); }
  state = scopeState(state, locals.user);
  const p = url.searchParams;
  const view = (VIEWS as string[]).includes(p.get('view') || '') ? (p.get('view') as InboxView) : 'unread';
  const query: InboxQuery = {
    view, account: p.get('account') || '', provider: p.get('provider') || '', sender: p.get('sender') || '', from: p.get('from') || '', to: p.get('to') || '',
    read: p.get('read') === 'read' ? 'read' : p.get('read') === 'unread' ? 'unread' : '', category: (CATEGORIES as readonly string[]).includes(p.get('category') || '') ? p.get('category')! : '',
    pipeline: p.get('pipeline') || '', thread: p.get('thread') || '', folder: p.get('folder') || '', q: (p.get('q') || '').trim(), page: Number(p.get('page')) || 1, pageSize: 50
  };
  const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
  const result = queryInbox(rows, query);
  // Cached AI insights for the visible rows only (never computed here).
  const insights: Record<string, { summary: string; category: string; confidence: number; needsReply: boolean; paymentDue: string | null }> = {};
  if (hasDatabase()) for (const [k, v] of await getInsights(await database(), result.rows.map((r) => r.key)).catch(() => new Map())) if (v.status === 'done' && v.insight) insights[k] = { summary: v.insight.summary, category: v.insight.category, confidence: v.insight.confidence, needsReply: v.insight.needsReply, paymentDue: v.insight.paymentDue };
  const folderName = query.folder ? (folderSummary(state)[query.account || '']?.find((f) => f.id === query.folder)?.name || query.folder) : '';
  return {
    folderName, insights, aiAvailable: hasDatabase(),
    query, ...result,
    categories: CATEGORIES,
    accounts: state.accounts.map((a) => ({ id: a.id, provider: a.provider, email: a.email || a.id, lastSync: a.lastSync || '', lastError: a.lastError || '', total: rows.filter((r) => r.accountId === a.id).length, unread: rows.filter((r) => r.accountId === a.id && r.unread).length })),
    views: visiblePipelines(state).map((v) => ({ id: v.id, name: v.name, parser: v.parser, total: state.items.filter((i) => i.pipelineId === v.id).length, unread: state.items.filter((i) => i.pipelineId === v.id && isUnread(i)).length })),
  };
};

const account = (state: Awaited<ReturnType<typeof readState>>, item: { pipelineId: string; accountId?: string }) => item.accountId || state.pipelines.find((p) => p.id === item.pipelineId)?.accountId || '';

export const actions: Actions = {
  // Local-only review state for one source message (all its copies). The mailbox is never modified.
  mark: async ({ request, locals }) => {
    const form = await request.formData();
    const keys = [...form.getAll('key'), ...form.getAll('keys')].map(String).filter((k) => k && keyAllowed(locals.user, k));
    const op = String(form.get('op') || '');
    const value = String(form.get('value') || '');
    // Delete and read state are changed in Gmail/Zoho first; AadOS follows only where that worked.
    let errors: string[] = [];
    let applyKeys = keys;
    let tokens: Awaited<ReturnType<typeof applyToMailbox>>['tokens'] = [];
    if (op === 'delete' || op === 'mark-read' || op === 'mark-unread') {
      if (!keys.length) return fail(400, { error: 'Choose at least one email.' });
      const r = await applyToMailbox(op, keys);
      errors = r.errors; applyKeys = r.done; tokens = r.tokens;
      if (!applyKeys.length) return fail(400, { error: errors.join(' ') || 'Nothing was changed.' });
    }
    try {
      // One save: the change itself plus any token refreshed during the mailbox calls.
      await updateState((state) => {
        for (const t of tokens) { const a = state.accounts.find((x) => x.id === t.id); if (a) { a.accessToken = t.accessToken; a.expiresAt = t.expiresAt; } }
        const wanted = new Set(applyKeys);
        const copies = state.items.filter((item) => wanted.has(`${account(state, item)}:${item.messageId}`));
        if (!keys.length || !copies.length) throw new Error('Choose at least one email.');
        if (op === 'delete') {
          const gone = new Set(copies.map((item) => item.id));
          state.items = state.items.filter((item) => !gone.has(item.id));
          state.dismissed.push(...[...gone].filter((id) => !state.dismissed.includes(id)));
          return;
        }
        for (const item of copies) {
          if (op === 'mark-read') { item.seen = true; item.unread = false; }
          else if (op === 'mark-unread') { item.seen = false; item.unread = true; globalThis.__aadosSeen?.delete(`${item.pipelineId}\u0000${item.messageId}`); }
          else if (op === 'actionable' || op === 'dismissed' || op === 'reviewed') item.actionState = op;
          else if (op === 'clear-action') delete item.actionState;
          else if (op === 'follow-up') item.followUp = item.followUp || new Date().toISOString();
          else if (op === 'clear-follow-up') delete item.followUp;
          else if (op === 'importance-high' || op === 'importance-normal') item.importance = op === 'importance-high' ? 'high' : 'normal';
          else if (op === 'clear-importance') delete item.importance;
          else if (op === 'categories') { const list = value.split(',').filter((c) => (CATEGORIES as readonly string[]).includes(c)); if (list.length) item.categories = list; else delete item.categories; }
          else throw new Error('Unknown action.');
        }
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Update failed.' }); }
    return errors.length ? { marked: applyKeys, warning: errors.join(' ') } : { marked: applyKeys };
  }
};
