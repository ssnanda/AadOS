import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import { agenda } from '$lib/calendar/model';

// Read-only agenda from synced calendar events (Google / Zoho). Nothing is fabricated: empty until a calendar is authorized.
export const load: PageServerLoad = async ({ url }) => {
  const state = await readState();
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 14, 1), 90);
  const from = new Date(); from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86_400_000);
  const names = new Map(state.calendars.map((c) => [c.id, c]));
  const items = agenda(state.events, from.toISOString(), to.toISOString()).map((o) => ({
    key: `${o.id}:${o.occurrenceStart}`, title: o.title, start: o.start, end: o.end, allDay: o.allDay, location: o.location, timeZone: o.timeZone,
    calendar: names.get(o.calendarId)?.name || '', provider: o.provider, tentative: o.status === 'tentative'
  }));
  return { items, days, calendars: state.calendars.length, accounts: state.accounts.filter((a) => a.provider === 'gmail' || a.provider === 'zoho').length };
};
