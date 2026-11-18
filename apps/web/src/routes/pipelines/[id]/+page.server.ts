import { scopeState } from '$lib/server/scope';
import { error, fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { clean, parseMessage } from '$lib/server/pipeline-parser';
import { filterItems, isUnread } from '$lib/server/search';
import { digestView, markDigestItem, runDigest } from '$lib/server/ai/weekly-digest-service';

const count = (values: string[]) => {
  const map = new Map<string, number>();
  for (const value of values) if (value) map.set(value, (map.get(value) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const state = scopeState(await readState(), locals.user);
  const pipeline = state.pipelines.find((item) => item.id === params.id);
  if (!pipeline) throw error(404, 'Pipeline not found');
  const all = state.items.filter((item) => item.pipelineId === pipeline.id);
  const kind = url.searchParams.get('kind') || '';
  const store = url.searchParams.get('store') || '';
  const q = (url.searchParams.get('q') || '').trim();
  // View mode shows every email in the view by default; ?view=unread narrows to unread.
  const view = url.searchParams.get('view') === 'unread' ? 'unread' : 'all';
  const unread = view === 'unread';
  const matching = filterItems(all, { q });
  const unreadCount = matching.filter(isUnread).length;
  // Tiles and store chips count what matches the search + read filter, so they narrow as you type.
  const searched = filterItems(matching, { unread });
  const shown = filterItems(searched, { kind, store }).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return {
    pipeline,
    total: all.length,
    searched: searched.length,
    kinds: count(searched.map((item) => item.kind)),
    stores: count(searched.map((item) => String(item.facts.store || ''))).slice(0, 14),
    kind, store, q, view, unreadCount, allCount: matching.length,
    matched: shown.length,
    items: shown.slice(0, 250),
    // Weekly review views: AI review of the last 7 days + tutoring session trends.
    review: pipeline.parser === 'digest' ? digestView(state, pipeline) : null
  };
};

export const actions: Actions = {
  // Weekly review: start in the background (the page polls progress); only new/changed emails are read.
  review: async ({ params }) => { void runDigest(params.id); return { reviewing: true }; },
  reviewMark: async ({ params, request }) => {
    const f = await request.formData(), op = String(f.get('op') || '') as 'done' | 'dismissed' | 'clear' | 'task';
    if (!['done', 'dismissed', 'clear', 'task'].includes(op)) return fail(400, { error: 'Unknown action.' });
    try { const task = await markDigestItem(params.id, String(f.get('item') || ''), op); return { marked: op, task }; }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Update failed.' }); }
  },
  // Re-run the parser over stored fields (subject, sender, summary) without re-syncing.
  reparse: async ({ params }) => {
    let changed = 0;
    try {
      await updateState((state) => {
        const pipeline = state.pipelines.find((item) => item.id === params.id);
        if (!pipeline) throw new Error('Pipeline not found');
        for (const item of state.items.filter((entry) => entry.pipelineId === pipeline.id)) {
          item.subject = clean(item.subject); item.sender = clean(item.sender); item.summary = clean(item.summary);
          const parsed = parseMessage(pipeline.parser, item);
          if (item.kind !== parsed.kind) changed++;
          item.kind = parsed.kind;
          item.facts = parsed.facts;
        }
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Re-parse failed.' }); }
    return { reparsed: changed };
  },
  // Remove from AadOS only (mailbox access is read-only). Ids are remembered so syncs skip them.
  // all=1 removes everything matching the current filters, not just the rows on screen.
  remove: async ({ params, request }) => {
    const form = await request.formData();
    let removed = 0;
    try {
      await updateState((state) => {
        const pipeline = state.pipelines.find((item) => item.id === params.id);
        if (!pipeline) throw new Error('Pipeline not found');
        const mine = state.items.filter((item) => item.pipelineId === pipeline.id);
        const wanted = new Set(form.getAll('ids').map(String));
        const victims = form.get('all') === '1'
          ? filterItems(mine, { kind: String(form.get('kind') || ''), store: String(form.get('store') || ''), q: String(form.get('q') || ''), unread: form.get('unread') === '1' })
          : mine.filter((item) => wanted.has(item.id));
        const gone = new Set(victims.map((item) => item.id));
        state.items = state.items.filter((item) => !gone.has(item.id));
        state.dismissed.push(...gone);
        removed = gone.size;
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Delete failed.' }); }
    return { removed };
  }
};
