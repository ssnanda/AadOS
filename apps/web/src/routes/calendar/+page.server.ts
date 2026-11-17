import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import { agenda, validZone } from '$lib/calendar/model';
import { bucketByDay, describeRecurrence, isDate, rangeUtc, shiftDate, todayIn, viewDays, type ViewKind } from '$lib/calendar/view';
import { calendarAccounts } from '$lib/server/scope';

const VIEWS: ViewKind[] = ['month', 'week', 'day', 'agenda'];
// Used only when the provider gives a calendar no colour.
const PALETTE = ['#3157de', '#d6477f', '#139488', '#c98a1d', '#7c4dde', '#2f6fe4', '#d94d43', '#6f7c94'];
const text = (html: string) => html.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);

// Read-only combined calendar (Google + Zoho). Nothing is fabricated: empty until a calendar is authorized and synced.
export const load: PageServerLoad = async ({ url, locals }) => {
  const state = await readState();
  const tz = validZone(state.prefs.timeZone) ? state.prefs.timeZone : 'UTC';
  const p = url.searchParams;
  const view = (VIEWS as string[]).includes(p.get('view') || '') ? (p.get('view') as ViewKind) : 'month';
  const today = todayIn(tz);
  const date = isDate(p.get('date') || '') ? p.get('date')! : today;
  const account = state.accounts.some((a) => a.id === p.get('account')) ? p.get('account')! : '';
  const hidden = new Set((p.get('off') || '').split(',').filter(Boolean));
  // Calendar checkbox off in Settings: that account's calendars are neither synced nor shown.
  // Plus accounts this user may not see (another family member's own, or the owner's without the Calendar permission).
  const mine = calendarAccounts(state, locals.user);
  const calOff = new Set(state.accounts.filter((a) => a.calendarOff || !mine.has(a.id)).map((a) => a.id));
  const disabled = new Set([...state.calendarDisabled, ...state.calendars.filter((c) => calOff.has(c.accountId)).map((c) => c.id)]);

  const writable = new Set(state.accounts.filter((a) => a.calendarWrite).map((a) => a.id));
  const calendars = state.calendars.map((c, i) => ({ id: c.id, name: c.name, accountId: c.accountId, writable: writable.has(c.accountId), provider: c.provider, color: /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : PALETTE[i % PALETTE.length], primary: c.primary, syncing: !disabled.has(c.id), shown: !hidden.has(c.id) && !disabled.has(c.id) && (!account || c.accountId === account) }));
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
      calendar: c?.name || '', color: c?.color || PALETTE[0], provider: o.provider,
      // For editing: the stored event (a series for repeating events), its calendar and the raw text fields.
      eventId: o.id, calendarId: o.calendarId, writable: writable.has(o.accountId), rawDescription: (o.description || '').slice(0, 8000)
    }];
  }));
  const enabled = state.accounts.filter((a) => a.calendar && !calOff.has(a.id));
  return {
    view, date, today, tz, weekStart: state.prefs.weekStart,
    prev: shiftDate(view, date, -1), next: shiftDate(view, date, 1),
    days: days.map((d) => ({ date: d, inMonth: view !== 'month' || d.slice(0, 7) === month, isToday: d === today, items: buckets[d].map((i) => ({ key: i.key, ref: `${i.eventId}|${i.occurrenceStart}`, title: i.title, allDay: i.allDay, start: i.start, part: i.part, color: byId.get(i.calendarId)?.color || PALETTE[0] })) })),
    details, total: occurrences.length,
    calendars, account, off: [...hidden],
    accounts: state.accounts.filter((a) => a.calendar && !calOff.has(a.id)).map((a) => ({ id: a.id, label: `${a.provider === 'gmail' ? 'Google' : 'Zoho'} · ${a.email}` })),
    enabled: enabled.length,
    canEditAny: enabled.some((a) => a.calendarWrite),
    errors: enabled.filter((a) => a.calendarError).map((a) => ({ id: a.id, label: `${a.provider === 'gmail' ? 'Google' : 'Zoho'} · ${a.email}`, message: a.calendarError! })),
    lastSync: enabled.map((a) => a.calendarLastSync || '').sort().pop() || ''
  };
};
