import { json } from '@sveltejs/kit';
import { readState, updateState } from '$lib/server/aados-store';
import { startFullSync, syncJob } from '$lib/server/sync-job';

// Wipes every stored email (and the removed-email memory) in all views, then starts a full sync.
// Accounts, views and settings are kept. Refused while a sync is running.
export const POST = async () => {
  if (syncJob().running) return json({ error: 'A sync is running. Stop it first.' }, { status: 409 });
  const purged = (await readState()).items.length;
  await updateState((state) => { state.items = []; state.dismissed = []; for (const pipeline of state.pipelines) { pipeline.lastSync = ''; pipeline.lastError = ''; } });
  const state = await readState();
  const ids = state.pipelines.filter((item) => state.accounts.some((account) => account.id === item.accountId)).map((item) => item.id);
  if (ids.length) startFullSync(ids);
  return json({ purged, started: ids.length > 0 });
};
