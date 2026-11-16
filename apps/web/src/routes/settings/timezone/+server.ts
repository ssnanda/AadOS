import { json } from '@sveltejs/kit';
import { updateState } from '$lib/server/aados-store';
import { validZone } from '$lib/calendar/model';

// Stores the browser-reported IANA time zone the first time only; later changes are made in Settings -> General.
export const POST = async ({ request }) => {
  const tz = String((await request.json().catch(() => ({})))?.tz || '');
  if (!tz || !validZone(tz)) return json({ error: 'Unknown time zone' }, { status: 400 });
  let stored = '';
  await updateState((s) => { if (!s.prefs.timeZone) s.prefs.timeZone = tz; stored = s.prefs.timeZone; });
  return json({ timeZone: stored });
};
