import { json } from '@sveltejs/kit';
import { hasAccount, updateStateDetached } from '$lib/server/aados-store';
import { syncView } from '$lib/server/pipeline-sync';

// Sync every enabled view now (same work as the scheduled 15-minute sync).
export const POST = async () => {
  let added = 0, failed = 0;
  await updateStateDetached(async (state) => {
    for (const pipeline of state.pipelines.filter((item) => item.enabled)) {
      if (!hasAccount(state, pipeline)) continue;
      try { added += (await syncView(state, pipeline, { scheduled: true })).added; }
      catch (cause) { failed++; pipeline.lastError = cause instanceof Error ? cause.message : 'Sync failed'; }
    }
  });
  return json({ added, failed });
};
