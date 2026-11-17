import { json } from '@sveltejs/kit';
import { readState, updateStateDetached } from '$lib/server/aados-store';
import { gmailAccessToken } from '$lib/server/gmail';
import { zohoAccessToken } from '$lib/server/zoho';
import { syncCalendars } from '$lib/server/calendar-sync';
import { googleWrite, zohoWrite, normalize, type EventInput } from '$lib/calendar/write';
import { validZone } from '$lib/calendar/model';
import { calendarAccounts } from '$lib/server/scope';

// Create / edit / delete one event at Google or Zoho, then re-sync that account so the calendar shows the change.
// Needs the account's calendar edit grant (Settings → Emails → "Allow calendar editing").
const s = (v: unknown, max = 5000) => String(v ?? '').slice(0, max);

export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => ({}));
  const op = s(b.op, 10) as 'create' | 'update' | 'delete';
  if (!['create', 'update', 'delete'].includes(op)) return json({ error: 'Unknown action.' }, { status: 400 });
  const state = await readState();
  const tz = validZone(state.prefs.timeZone) ? state.prefs.timeZone : 'UTC';
  const event = op === 'create' ? undefined : state.events.find((e) => e.id === s(b.eventId, 300));
  if (op !== 'create' && !event) return json({ error: 'Event not found — it may have changed; reload the calendar.' }, { status: 404 });
  const calendar = state.calendars.find((c) => c.id === (event?.calendarId || s(b.calendarId, 300)));
  if (!calendar) return json({ error: 'Choose a calendar.' }, { status: 400 });
  if (!calendarAccounts(state, locals.user).has(calendar.accountId)) return json({ error: 'Calendar not found.' }, { status: 404 });
  const account = state.accounts.find((a) => a.id === calendar.accountId);
  if (!account?.calendarWrite) return json({ error: `AadOS may not edit ${account?.email || 'this'} calendar yet. Settings → Emails → “Allow calendar editing”.` }, { status: 403 });
  const i = b.input || {};
  const input: EventInput | undefined = op === 'delete' ? undefined : { title: s(i.title, 500), description: s(i.description, 8000), location: s(i.location, 500), allDay: i.allDay === true, startDate: s(i.startDate, 10), startTime: s(i.startTime, 5), endDate: s(i.endDate, 10), endTime: s(i.endTime, 5), timeZone: tz };
  try {
    if (input) normalize(input); // validate before calling the provider
    await updateStateDetached(async (st) => {
      const acct = st.accounts.find((a) => a.id === account.id)!;
      if (acct.provider === 'gmail') await googleWrite(fetch, await gmailAccessToken(st, acct), op, calendar, event, input);
      else await zohoWrite(fetch, st.zoho.dataCenter, await zohoAccessToken(st, acct), op, calendar, event, input);
      await syncCalendars(st, acct.id);
    });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Calendar update failed.' }, { status: 400 });
  }
};
