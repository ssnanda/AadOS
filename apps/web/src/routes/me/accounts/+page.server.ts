import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { beginGmailOAuth } from '$lib/server/gmail';
import { beginOAuth as beginZoho } from '$lib/server/zoho';
import { clearCalendarData } from '$lib/server/calendar-sync';

// My accounts: a family member links their own Gmail / Zoho (mail + calendar). Those accounts are private to them.
// Uses the owner's OAuth apps (Settings → Emails & Calendar); only reachable for members allowed to link accounts.
export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user || locals.user.owner) throw redirect(303, '/settings/emails');
  const s = await readState(), me = locals.user.id;
  const mine = s.accounts.filter((a) => a.ownerId === me);
  return {
    name: locals.user.name, error: url.searchParams.get('error') || '', connected: url.searchParams.has('connected'),
    canGmail: Boolean(s.gmail.clientId && s.gmail.clientSecret), canZoho: Boolean(s.zoho.clientId && s.zoho.clientSecret),
    accounts: mine.map((a) => ({ id: a.id, email: a.email, provider: a.provider, paused: Boolean(a.paused), calendar: Boolean(a.calendar), calendarOff: Boolean(a.calendarOff), calendarWrite: Boolean(a.calendarWrite), lastError: a.lastError || '', calendarError: a.calendarError || '' })),
    calendars: s.calendars.filter((c) => mine.some((a) => a.id === c.accountId)).map((c) => ({ id: c.id, name: c.name, accountId: c.accountId, color: c.color, enabled: !s.calendarDisabled.includes(c.id) }))
  };
};

/** The account must belong to the signed-in member. */
async function own(locals: App.Locals, id: string) {
  const s = await readState();
  const a = s.accounts.find((x) => x.id === id);
  if (!locals.user || locals.user.owner || !a || a.ownerId !== locals.user.id) throw error(404, 'Account not found');
  return a;
}

export const actions: Actions = {
  connectGmail: async ({ url, locals }) => {
    let target = '';
    await updateState((s) => { if (!s.gmail.clientId || !s.gmail.clientSecret) throw error(400, 'Gmail is not set up yet — ask the owner.'); target = beginGmailOAuth(s, `${url.origin}/oauth/gmail/callback`, { calendar: true, owner: locals.user!.id }); });
    throw redirect(303, target);
  },
  connectZoho: async ({ url, locals }) => {
    let target = '';
    await updateState((s) => { if (!s.zoho.clientId || !s.zoho.clientSecret) throw error(400, 'Zoho is not set up yet — ask the owner.'); target = beginZoho(s, `${url.origin}/oauth/zoho/callback`, { calendar: true, owner: locals.user!.id }); });
    throw redirect(303, target);
  },
  setSync: async ({ request, locals }) => {
    const f = await request.formData();
    const a = await own(locals, String(f.get('id') || '')), on = f.get('on') === 'true', kind = String(f.get('kind') || '');
    await updateState((s) => { const x = s.accounts.find((y) => y.id === a.id); if (!x) return; if (kind === 'mail') x.paused = !on; if (kind === 'calendar') x.calendarOff = !on; });
    return { saved: true };
  },
  toggleCalendar: async ({ request, locals }) => {
    const f = await request.formData();
    const id = String(f.get('id') || ''), on = f.get('on') === 'true';
    const s0 = await readState(); const cal = s0.calendars.find((c) => c.id === id);
    if (!cal) return fail(404, { error: 'Calendar not found.' });
    await own(locals, cal.accountId);
    await updateState((s) => {
      if (on) s.calendarDisabled = s.calendarDisabled.filter((x) => x !== id);
      else if (!s.calendarDisabled.includes(id)) { s.calendarDisabled.push(id); s.events = s.events.filter((e) => e.calendarId !== id); delete s.calendarSync[id]; }
    });
    return { saved: true };
  },
  disconnect: async ({ request, locals }) => {
    const a = await own(locals, String((await request.formData()).get('id') || ''));
    // Their account and everything AadOS held for it: mail copies, its inbox feed, calendars.
    await updateState((s) => {
      s.items = s.items.filter((i) => (i.accountId || s.pipelines.find((p) => p.id === i.pipelineId)?.accountId) !== a.id);
      s.pipelines = s.pipelines.filter((p) => !(p.system && p.accountId === a.id));
      clearCalendarData(s, a.id);
      s.accounts = s.accounts.filter((x) => x.id !== a.id);
    });
    return { disconnected: true };
  }
};
