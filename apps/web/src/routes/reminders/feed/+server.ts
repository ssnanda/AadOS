import { json } from '@sveltejs/kit';
import { readState, updateState } from '$lib/server/aados-store';

// Fired, unread reminders for browser notifications. The browser de-duplicates by id; `since` stops a burst of
// old notifications after a restart or a new device (only reminders fired after `since` are returned).
export const GET = async ({ url }) => {
  const state = await readState();
  const since = Date.parse(url.searchParams.get('since') || '') || Date.now() - 10 * 60_000;
  const items = state.reminders.filter((r) => r.status === 'fired' && !r.readAt && Date.parse(r.firedAt || r.at) >= since).slice(0, 20)
    .map((r) => ({ id: r.id, title: r.title, firedAt: r.firedAt || r.at, link: r.source.type === 'task' ? '/tasks' : r.source.type === 'event' ? `/calendar?view=day&date=${r.source.occurrenceStart.slice(0, 10)}` : '/reminders' }));
  return json({ enabled: state.notify.browser, items, now: new Date().toISOString() });
};

// Preference: browser notifications on/off (the permission itself is the browser's).
export const POST = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  await updateState((s) => { s.notify = { ...s.notify, browser: body?.browser === true }; });
  return json({ ok: true });
};
