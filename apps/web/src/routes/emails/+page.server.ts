import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ensureInboxPipelines, missingInboxPipelines, readState, updateState, visiblePipelines } from '$lib/server/aados-store';
import { buildRows, queryInbox, type InboxQuery, type InboxView } from '$lib/server/inbox';
import { CATEGORIES } from '$lib/server/categories';

const VIEWS: InboxView[] = ['inbox', 'all', 'unread', 'important', 'needs-reply', 'recent', 'read'];

export const load: PageServerLoad = async ({ url }) => {
  let state = await readState();
  // First visit after connecting an account: create the hidden per-account inbox feeds (never touches existing data).
  if (missingInboxPipelines(state)) { await updateState((s) => { ensureInboxPipelines(s); }); state = await readState(); }
  const p = url.searchParams;
  const view = (VIEWS as string[]).includes(p.get('view') || '') ? (p.get('view') as InboxView) : 'inbox';
  const query: InboxQuery = {
    view, account: p.get('account') || '', provider: p.get('provider') || '', sender: p.get('sender') || '', from: p.get('from') || '', to: p.get('to') || '',
    read: p.get('read') === 'read' ? 'read' : p.get('read') === 'unread' ? 'unread' : '', category: (CATEGORIES as readonly string[]).includes(p.get('category') || '') ? p.get('category')! : '',
    pipeline: p.get('pipeline') || '', thread: p.get('thread') || '', q: (p.get('q') || '').trim(), page: Number(p.get('page')) || 1, pageSize: 50
  };
  const result = queryInbox(buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items }), query);
  return {
    query, ...result,
    categories: CATEGORIES,
    accounts: state.accounts.map((a) => ({ id: a.id, provider: a.provider, email: a.email || a.id, lastSync: a.lastSync || '', lastError: a.lastError || '' })),
    views: visiblePipelines(state).map((v) => ({ id: v.id, name: v.name })),
    inboxIds: state.pipelines.filter((v) => v.system).map((v) => v.id)
  };
};

const account = (state: Awaited<ReturnType<typeof readState>>, item: { pipelineId: string; accountId?: string }) => item.accountId || state.pipelines.find((p) => p.id === item.pipelineId)?.accountId || '';

export const actions: Actions = {
  // Local-only review state for one source message (all its copies). The mailbox is never modified.
  mark: async ({ request }) => {
    const form = await request.formData();
    const key = String(form.get('key') || '');
    const op = String(form.get('op') || '');
    const value = String(form.get('value') || '');
    try {
      await updateState((state) => {
        const copies = state.items.filter((item) => `${account(state, item)}:${item.messageId}` === key);
        if (!copies.length) throw new Error('Email not found.');
        for (const item of copies) {
          if (op === 'actionable' || op === 'dismissed' || op === 'reviewed') item.actionState = op;
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
    return { marked: key };
  }
};
