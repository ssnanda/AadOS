import { json } from '@sveltejs/kit';
import { readState } from '$lib/server/aados-store';
import { cancelFullSync, startFullSync, syncJob } from '$lib/server/sync-job';

export const GET = () => json(syncJob());

// POST {ids?: string[]} starts a background full sync (all views by default); {cancel: true} stops it.
export const POST = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  if (body?.cancel) { cancelFullSync(); return json(syncJob()); }
  const state = await readState();
  const wanted: string[] = Array.isArray(body?.ids) && body.ids.length ? body.ids.map(String) : state.pipelines.map((item) => item.id);
  const ids = wanted.filter((id) => state.pipelines.some((item) => item.id === id && state.accounts.some((account) => account.id === item.accountId)));
  if (!ids.length) return json({ ...syncJob(), error: 'No connected views to sync.' }, { status: 400 });
  startFullSync(ids);
  return json(syncJob());
};
