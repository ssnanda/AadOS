import { error, fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { clean, parseMessage } from '$lib/server/pipeline-parser';

const count = (values: string[]) => {
  const map = new Map<string, number>();
  for (const value of values) if (value) map.set(value, (map.get(value) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

export const load: PageServerLoad = async ({ params, url }) => {
  const state = await readState();
  const pipeline = state.pipelines.find((item) => item.id === params.id);
  if (!pipeline) throw error(404, 'Pipeline not found');
  const all = state.items.filter((item) => item.pipelineId === pipeline.id);
  const kind = url.searchParams.get('kind') || '';
  const store = url.searchParams.get('store') || '';
  const shown = all
    .filter((item) => (!kind || item.kind === kind) && (!store || item.facts.store === store))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return {
    pipeline,
    total: all.length,
    kinds: count(all.map((item) => item.kind)),
    stores: count(all.map((item) => String(item.facts.store || ''))).slice(0, 14),
    kind, store,
    matched: shown.length,
    items: shown.slice(0, 250)
  };
};

export const actions: Actions = {
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
  }
};
