import { resetContactCache } from '$lib/server/contacts';
import { security } from '$lib/server/auth';
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasAccount, pipelineFolders, publicState, readState, updateState, type PipelineParser } from '$lib/server/aados-store';
import { beginOAuth as beginZoho, discoverAccountAndFolders } from '$lib/server/zoho';
import { beginGmailOAuth, discoverGmailFolders } from '$lib/server/gmail';
import { clearCalendarData } from '$lib/server/calendar-sync';

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const load: PageServerLoad = async ({ url }) => { const state = await readState(); return { ...publicState(state), memberNames: Object.fromEntries(security().members().map((m) => [m.id, m.name])), calendars: state.calendars.map((c) => ({ id: c.id, name: c.name, accountId: c.accountId, color: c.color, enabled: !state.calendarDisabled.includes(c.id) })), zohoRedirect: `${url.origin}/oauth/zoho/callback`, gmailRedirect: `${url.origin}/oauth/gmail/callback`, error: url.searchParams.get('error') || '' }; };
export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    // Each choice is `accountId|folderId`, so one view can mix folders from several accounts.
    const picks = form.getAll('folder').map(String).filter(Boolean).map((value) => { const at = value.indexOf('|'); return { accountId: value.slice(0, at), folderId: value.slice(at + 1) }; });
    const parser = String(form.get('parser') || '') as PipelineParser;
    const name = String(form.get('name') || '').trim();
    if (!['shop', 'health', 'generic'].includes(parser)) return fail(400, { error: 'Choose a view type.' });
    try { await updateState((state) => {
      const selected = picks.map((pick) => {
        const account = state.accounts.find((item) => item.id === pick.accountId);
        const folder = account?.folders.find((item) => item.id === pick.folderId);
        return account && folder ? { id: folder.id, name: folder.path || folder.name, accountId: account.id, source: account.provider } : undefined;
      }).filter((item) => item !== undefined);
      if (!selected.length || selected.length !== picks.length) throw new Error('Choose at least one regular folder or label.');
      const first = selected[0];
      const accountIds = new Set(selected.map((folder) => folder.accountId));
      const id = slug(`${accountIds.size > 1 ? 'multi' : first.accountId}-${name || parser}`);
      if (state.pipelines.some((item) => item.id === id)) throw new Error('That view name is already configured.');
      const defaultName = parser === 'shop' ? 'Shopping' : parser === 'health' ? 'Health' : first.name;
      state.pipelines.push({ id, name: name || defaultName, source: first.source, accountId: first.accountId, folderId: first.id, folderName: selected.map((folder) => folder.name).join(', '), folders: selected, parser, enabled: true, cursor: 0, lastSync: '', lastError: '' });
    }); return { created: true }; }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not create workflow.' }); }
  },
  toggle: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    try { await updateState((state) => { const workflow = state.pipelines.find((item) => item.id === id); if (!workflow) throw new Error('Email workflow not found.'); workflow.enabled = !workflow.enabled; }); }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not update workflow.' }); }
    return { toggled: id };
  },
  saveZoho: async ({ request }) => { const f=await request.formData(), id=String(f.get('clientId')||'').trim(), secret=String(f.get('clientSecret')||'').trim(); if(!id)return fail(400,{error:'Zoho Client ID is required.'}); await updateState((s)=>{s.zoho.clientId=id;if(secret)s.zoho.clientSecret=secret;s.zoho.dataCenter=String(f.get('dataCenter')||'com');}); return {saved:'zoho'}; },
  connectZoho: async ({ url }) => { let target=''; await updateState((s)=>{if(!s.zoho.clientId||!s.zoho.clientSecret)throw new Error('Save Zoho credentials first.');target=beginZoho(s,`${url.origin}/oauth/zoho/callback`,{calendar:s.accounts.some((a)=>a.provider==='zoho'&&a.calendar)});}); throw redirect(303,target); },
  saveGmail: async ({ request }) => {
    const form = await request.formData();
    const clientId = String(form.get('clientId') || '').trim();
    const clientSecret = String(form.get('clientSecret') || '').trim();
    if (!clientId) return fail(400, { error: 'Gmail Client ID is required.' });
    await updateState((state) => {
      state.gmail.clientId = clientId;
      if (clientSecret) state.gmail.clientSecret = clientSecret;
    });
    return { saved: 'gmail' };
  },
  connectGmail: async ({ url }) => {
    let target = '';
    try {
      await updateState((state) => {
        if (!state.gmail.clientId || !state.gmail.clientSecret) throw new Error('Save Gmail credentials first.');
        target = beginGmailOAuth(state, `${url.origin}/oauth/gmail/callback`);
      });
    } catch (cause) {
      return fail(400, { error: cause instanceof Error ? cause.message : 'Could not start Gmail connection.' });
    }
    throw redirect(303, target);
  },
  refreshAccount: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    try { await updateState(async (s)=>{ const account=s.accounts.find((item)=>item.id===id); if(!account)throw new Error('Account not found.'); if(account.provider==='zoho')await discoverAccountAndFolders(s,account); else await discoverGmailFolders(s,account); }); return {refreshed:id}; }
    catch(c){return fail(400,{error:c instanceof Error?c.message:'Refresh failed.'});}
  },
  // Sync every view/inbox feed that reads this account (only this account's folders).
  // Re-consent with the read-only calendar scope for an existing account (Google: incremental auth, same login).
  // Google Contacts (read-only): one-time Google approval, keeping the calendar grant the account already has.
  enableContacts: async ({ request, url }) => {
    const id = String((await request.formData()).get('id') || '');
    let target = '';
    try {
      await updateState((s) => {
        const a = s.accounts.find((item) => item.id === id && item.provider === 'gmail');
        if (!a) throw new Error('Gmail account not found.');
        if (!s.gmail.clientId || !s.gmail.clientSecret) throw new Error('Save Gmail credentials first.');
        target = beginGmailOAuth(s, `${url.origin}/oauth/gmail/callback`, { calendar: Boolean(a.calendar), contacts: true, loginHint: a.email });
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not start contacts authorization.' }); }
    resetContactCache();
    throw redirect(303, target);
  },
  enableCalendar: async ({ request, url }) => {
    const id = String((await request.formData()).get('id') || '');
    let target = '';
    try {
      await updateState((s) => {
        const a = s.accounts.find((item) => item.id === id);
        if (!a) throw new Error('Account not found.');
        if (a.provider === 'gmail') { if (!s.gmail.clientId || !s.gmail.clientSecret) throw new Error('Save Gmail credentials first.'); target = beginGmailOAuth(s, `${url.origin}/oauth/gmail/callback`, { calendar: true, loginHint: a.email }); }
        else { if (!s.zoho.clientId || !s.zoho.clientSecret) throw new Error('Save Zoho credentials first.'); target = beginZoho(s, `${url.origin}/oauth/zoho/callback`, { calendar: true }); }
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not start calendar authorization.' }); }
    throw redirect(303, target);
  },
  // Re-consent with change access (Gmail gmail.modify; Zoho messages UPDATE+DELETE): delete to Trash and mark read/unread.
  allowChanges: async ({ request, url }) => {
    const id = String((await request.formData()).get('id') || '');
    let target = '';
    try {
      await updateState((s) => {
        const a = s.accounts.find((item) => item.id === id);
        if (!a) throw new Error('Account not found.');
        target = a.provider === 'gmail' ? beginGmailOAuth(s, `${url.origin}/oauth/gmail/callback`, { calendar: Boolean(a.calendar), loginHint: a.email }) : beginZoho(s, `${url.origin}/oauth/zoho/callback`, { calendar: Boolean(a.calendar) });
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not start authorization.' }); }
    throw redirect(303, target);
  },
  // Per-calendar on/off: a disabled calendar stays listed but is not synced or shown.
  // Checkbox (auto-saved): `on` sets the state explicitly, so a repeated submit never flips it back.
  toggleCalendar: async ({ request }) => {
    const f = await request.formData();
    const id = String(f.get('id') || ''), on = f.get('on') === 'true';
    await updateState((s) => {
      if (!s.calendars.some((c) => c.id === id)) return;
      if (on) s.calendarDisabled = s.calendarDisabled.filter((x) => x !== id);
      else if (!s.calendarDisabled.includes(id)) { s.calendarDisabled.push(id); s.events = s.events.filter((e) => e.calendarId !== id); delete s.calendarSync[id]; }
    });
    return { calendarToggled: id };
  },
  clearCalendar: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { clearCalendarData(s, id); });
    return { calendarCleared: id };
  },
  // Per-account checkboxes (auto-saved): Email = mail syncs and shows in AadOS (`paused` = off); Calendar = its calendars
  // sync and show (`calendarOff`, keeping the grant). Turning Calendar on without a grant goes through enableCalendar.
  setSync: async ({ request }) => {
    const f = await request.formData();
    const id = String(f.get('id') || ''), kind = String(f.get('kind') || ''), on = f.get('on') === 'true';
    await updateState((s) => {
      const a = s.accounts.find((item) => item.id === id); if (!a) return;
      if (kind === 'mail') a.paused = !on;
      if (kind === 'calendar') a.calendarOff = !on;
      if (kind === 'contacts') a.contactsOff = !on;
    });
    if (kind === 'contacts') resetContactCache();
    return { toggled: id };
  },
  // Privacy: remove this account's synced copies from AadOS. The mailbox is untouched; a sync brings mail back.
  purgeAccountData: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    let removed = 0;
    await updateState((s) => {
      const owner = (item: { pipelineId: string; accountId?: string }) => item.accountId || s.pipelines.find((p) => p.id === item.pipelineId)?.accountId;
      const before = s.items.length;
      s.items = s.items.filter((item) => owner(item) !== id);
      removed = before - s.items.length;
    });
    return { purged: id, removed };
  },
  // Views on the account stay (paused, error shown) so synced items are never lost.
  disconnectAccount: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s)=>{ s.accounts=s.accounts.filter((item)=>item.id!==id); for(const p of s.pipelines.filter((item)=>pipelineFolders(item).some((f)=>f.accountId===id))){p.lastError='Account disconnected';if(!hasAccount(s,p))p.enabled=false;} });
    return {disconnected:id};
  }
};
