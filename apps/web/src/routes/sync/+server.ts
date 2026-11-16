import { json } from '@sveltejs/kit';
import { updateState } from '$lib/server/aados-store';
import { syncPipeline } from '$lib/server/zoho';
import { syncGmailPipeline } from '$lib/server/gmail';

// Sync every enabled view now (same work as the hourly scheduler).
export const POST = async () => {
  let added = 0, failed = 0;
  await updateState(async (state) => {
    for (const pipeline of state.pipelines.filter((item) => item.enabled)) {
      if (!state.accounts.some((account) => account.id === pipeline.accountId)) continue;
      try { added += (pipeline.source === 'gmail' ? await syncGmailPipeline(state, pipeline) : await syncPipeline(state, pipeline)).added; }
      catch (cause) { failed++; pipeline.lastError = cause instanceof Error ? cause.message : 'Sync failed'; }
    }
  });
  return json({ added, failed });
};
