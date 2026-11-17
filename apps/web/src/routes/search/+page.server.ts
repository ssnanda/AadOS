import { scopeState } from '$lib/server/scope';
import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { filterItems } from '$lib/server/search';

export const load: PageServerLoad = async ({ url, locals }) => {
  const q = (url.searchParams.get('q') || '').trim();
  const state = scopeState(await readState(), locals.user);
  const hits = q ? filterItems(state.items, { q }).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) : [];
  return { q, total: state.items.length, matched: hits.length, items: hits.slice(0, 300), names: Object.fromEntries(state.pipelines.map((p) => [p.id, p.name])) };
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
