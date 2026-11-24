import { json } from '@sveltejs/kit';
import { readState, updateState } from '$lib/server/aados-store';
import { load } from '../+page.server';

// Conference Room data as JSON for the mobile app (same load as the page), and POST {id} to pick the room calendar
// (the page's `pick` form action, which the app cannot call without a form post).
export const GET = async (event) => json(await load(event as any), { headers: { 'cache-control': 'no-store' } });

export const POST = async ({ request }) => {
  const id = String((await request.json().catch(() => ({})))?.id || '').slice(0, 300);
  const state = await readState();
  if (id && !state.calendars.some((c) => c.id === id)) return json({ error: 'Calendar not found.' }, { status: 400 });
  await updateState((s) => { s.prefs.roomCalendarId = id || undefined; });
  return json({ picked: id });
};
