import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { calendarAccounts } from '$lib/server/scope';
import { agenda, validZone } from '$lib/calendar/model';
import { todayIn } from '$lib/calendar/view';

// Conference Room: one picked calendar (e.g. a Zoho group calendar), its current status and the next 14 days of bookings.
export const load: PageServerLoad = async ({ locals }) => {
  const state = await readState();
  const tz = validZone(state.prefs.timeZone) ? state.prefs.timeZone : 'UTC';
  const visible = calendarAccounts(state, locals.user);
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const calendars = state.calendars.filter((c) => visible.has(c.accountId) && !accounts.get(c.accountId)?.calendarOff && !state.calendarDisabled.includes(c.id))
    .map((c) => ({ id: c.id, name: c.name, provider: c.provider, color: c.color, primary: c.primary, writable: Boolean(accounts.get(c.accountId)?.calendarWrite), account: accounts.get(c.accountId)?.email || '' }));
  // Default: a calendar whose name says it is a room.
  const selected = calendars.find((c) => c.id === state.prefs.roomCalendarId) || calendars.find((c) => /conference|room|meeting/i.test(c.name)) || null;
  const now = Date.now(), from = new Date(now - 12 * 3_600_000).toISOString(), to = new Date(now + 14 * 86_400_000).toISOString();
  const bookings = selected ? agenda(state.events, from, to, { calendarIds: [selected.id] }).filter((o) => o.status !== 'cancelled').map((o) => ({
    key: `${o.id}|${o.occurrenceStart}`, eventId: o.id, calendarId: o.calendarId, title: o.title, start: o.start, end: o.end, allDay: o.allDay, location: o.location,
    organizer: o.organizer || '', rawDescription: (o.description || '').slice(0, 4000), recurring: Boolean(o.recurrence?.length || o.recurringEventId)
  })).sort((a, b) => a.start.localeCompare(b.start)) : [];
  return { tz, today: todayIn(tz), calendars, selected, bookings, lastSync: state.accounts.map((a) => a.calendarLastSync || '').sort().pop() || '' };
};

export const actions: Actions = {
  pick: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    const state = await readState();
    if (id && !state.calendars.some((c) => c.id === id)) return fail(400, { error: 'Calendar not found.' });
    await updateState((s) => { s.prefs.roomCalendarId = id || undefined; });
    return { picked: id };
  }
};
