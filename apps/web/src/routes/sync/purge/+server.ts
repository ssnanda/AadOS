import { json } from '@sveltejs/kit';
import { readState, updateState } from '$lib/server/aados-store';
import { syncJob } from '$lib/server/sync-job';

// Wipes every stored email (and the removed-email memory) in all views. Nothing is re-fetched here:
// open folders re-sync on their own (newest mail only). Accounts, views and settings are kept.
// Gmail history checkpoints are cleared so the next live sync starts from a fresh scan.
export const POST = async () => {
  if (syncJob().running) return json({ error: 'A sync is running. Stop it first.' }, { status: 409 });
  const purged = (await readState()).items.length;
  await updateState((state) => {
    state.items = []; state.dismissed = [];
    for (const pipeline of state.pipelines) { pipeline.lastSync = ''; pipeline.lastError = ''; }
    for (const account of state.accounts) delete account.historyIds;
  });
  return json({ purged });
};
