import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateStateDetached } from '$lib/server/aados-store';
import { syncCalendars } from '$lib/server/calendar-sync';
import { agenda, validZone } from '$lib/calendar/model';
import { bucketByDay, describeRecurrence, isDate, rangeUtc, shiftDate, todayIn, viewDays, type ViewKind } from '$lib/calendar/view';

const VIEWS: ViewKind[] = ['month', 'week', 'day', 'agenda'];
// Used only when the provider gives a calendar no colour.
const PALETTE = ['#3157de', '#d6477f', '#139488', '#c98a1d', '#7c4dde', '#2f6fe4', '#d94d43', '#6f7c94'];
const text = (html: string) => html.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);

// Read-only combined calendar (Google + Zoho). Nothing is fabricated: empty until a calendar is authorized and synced.
export const load: PageServerLoad = async ({ url }) => {
  const state = await readState();
  const tz = validZone(state.prefs.timeZone) ? state.prefs.timeZone : 'UTC';
  const p = url.searchParams;
  const view = (VIEWS as string[]).includes(p.get('view') || '') ? (p.get('view') as ViewKind) : 'month';
  const today = todayIn(tz);
  const date = isDate(p.get('date') || '') ? p.get('date')! : today;
  const account = state.accounts.some((a) => a.id === p.get('account')) ? p.get('account')! : '';
  const hidden = new Set((p.get('off') || '').split(',').filter(Boolean));
  const disabled = new Set(state.calendarDisabled);

  const calendars = state.calendars.map((c, i) => ({ id: c.id, name: c.name, accountId: c.accountId, provider: c.provider, color: /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : PALETTE[i % PALETTE.length], primary: c.primary, syncing: !disabled.has(c.id), shown: !hidden.has(c.id) && !disabled.has(c.id) && (!account || c.accountId === account) }));
  const byId = new Map(calendars.map((c) => [c.id, c]));
  const shown = new Set(calendars.filter((c) => c.shown).map((c) => c.id));

  const days = viewDays(view, date, state.prefs.weekStart);
  const { from, to } = rangeUtc(days, tz);
  const occurrences = agenda(state.events.filter((e) => shown.has(e.calendarId)), from, to);
  const buckets = bucketByDay(occurrences, days, tz);
  const month = date.slice(0, 7);
  const details = Object.fromEntries(occurrences.map((o) => {
    const c = byId.get(o.calendarId);
    return [`${o.id}|${o.occurrenceStart}`, {
      title: o.title, start: o.start, end: o.end, allDay: o.allDay, timeZone: o.timeZone, location: o.location, description: text(o.description || ''),
      organizer: o.organizer || '', attendees: (o.attendees || []).slice(0, 50), attendeeCount: (o.attendees || []).length, meetingUrl: /^https?:\/\//i.test(o.meetingUrl || '') ? o.meetingUrl! : '',
      htmlLink: /^https:\/\//i.test(o.htmlLink || '') ? o.htmlLink! : '', recurrence: describeRecurrence(o.recurrence), recurring: Boolean(o.recurrence?.length || o.recurringEventId), tentative: o.status === 'tentative',
      calendar: c?.name || '', color: c?.color || PALETTE[0], provider: o.provider
    }];
  }));
  const enabled = state.accounts.filter((a) => a.calendar);
  return {
    view, date, today, tz, weekStart: state.prefs.weekStart,
    prev: shiftDate(view, date, -1), next: shiftDate(view, date, 1),
    days: days.map((d) => ({ date: d, inMonth: view !== 'month' || d.slice(0, 7) === month, isToday: d === today, items: buckets[d].map((i) => ({ key: i.key, ref: `${i.eventId}|${i.occurrenceStart}`, title: i.title, allDay: i.allDay, start: i.start, part: i.part, color: byId.get(i.calendarId)?.color || PALETTE[0] })) })),
    details, total: occurrences.length,
    calendars, account, off: [...hidden],
    accounts: state.accounts.filter((a) => a.calendar).map((a) => ({ id: a.id, label: `${a.provider === 'gmail' ? 'Google' : 'Zoho'} · ${a.email}` })),
    enabled: enabled.length,
    errors: enabled.filter((a) => a.calendarError).map((a) => ({ id: a.id, label: `${a.provider === 'gmail' ? 'Google' : 'Zoho'} · ${a.email}`, message: a.calendarError! })),
    lastSync: enabled.map((a) => a.calendarLastSync || '').sort().pop() || ''
  };
};

export const actions: Actions = {
  sync: async () => {
    try { let r = { accounts: 0, failed: 0 }; await updateStateDetached(async (s) => { r = await syncCalendars(s); }); return { synced: r }; }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Calendar sync failed.' }); }
  }
};
