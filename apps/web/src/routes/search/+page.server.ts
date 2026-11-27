import { scopeState } from '$lib/server/scope';
import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { filterItems } from '$lib/server/search';
import { messageKey } from '$lib/server/inbox';
import { bodyMatches } from '$lib/server/body-index';

export const load: PageServerLoad = async ({ url, locals }) => {
  const q = (url.searchParams.get('q') || '').trim();
  const state = scopeState(await readState(), locals.user);
  const pipelines = new Map(state.pipelines.map((p) => [p.id, p]));
  // Also match email body text (full-text index); metadata matches come first in the same list.
  const body = q ? await bodyMatches(q) : new Set<string>();
  const meta = q ? new Set(filterItems(state.items, { q }).map((i) => i.id)) : new Set<string>();
  const hits = q ? state.items.filter((i) => meta.has(i.id) || body.has(`${i.accountId || pipelines.get(i.pipelineId)?.accountId || ''}\u0000${i.messageId}`)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) : [];
  return { q, total: state.items.length, matched: hits.length, items: hits.slice(0, 300).map((item) => { const accountId = item.accountId || pipelines.get(item.pipelineId)?.accountId || ''; return { ...item, accountId, key: messageKey(accountId, item.messageId) }; }), names: Object.fromEntries(state.pipelines.map((p) => [p.id, p.name])) };
};

export const actions: Actions = {
  // Remove from AadOS only; ids are remembered so syncs skip them. all=1 removes every match of q.
  remove: async ({ request }) => {
    const form = await request.formData();
    let removed = 0;
    try {
      await updateState((state) => {
        const wanted = new Set(form.getAll('ids').map(String));
        const victims = form.get('all') === '1'
          ? filterItems(state.items, { q: String(form.get('q') || '') })
          : state.items.filter((item) => wanted.has(item.id));
        const gone = new Set(victims.map((item) => item.id));
        state.items = state.items.filter((item) => !gone.has(item.id));
        state.dismissed.push(...gone);
        removed = gone.size;
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Delete failed.' }); }
    return { removed };
  }
};
