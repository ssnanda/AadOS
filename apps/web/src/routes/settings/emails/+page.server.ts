import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasAccount, pipelineFolders, publicState, readState, updateState, type PipelineParser } from '$lib/server/aados-store';
import { beginOAuth as beginZoho, discoverAccountAndFolders } from '$lib/server/zoho';
import { beginGmailOAuth, discoverGmailFolders } from '$lib/server/gmail';
import { syncView } from '$lib/server/pipeline-sync';

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const load: PageServerLoad = async ({ url }) => ({ ...publicState(await readState()), zohoRedirect: `${url.origin}/oauth/zoho/callback`, gmailRedirect: `${url.origin}/oauth/gmail/callback`, error: url.searchParams.get('error') || '' });
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
  sync: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    try { let result = { scanned: 0, added: 0 }; await updateState(async (state) => { const pipeline = state.pipelines.find((item) => item.id === id); if (!pipeline) throw new Error('Email workflow not found.'); result = await syncView(state, pipeline); }); return { synced: id, ...result }; }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Sync failed.' }); }
  },
  toggle: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    try { await updateState((state) => { const workflow = state.pipelines.find((item) => item.id === id); if (!workflow) throw new Error('Email workflow not found.'); workflow.enabled = !workflow.enabled; }); }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not update workflow.' }); }
    return { toggled: id };
  },
  saveZoho: async ({ request }) => { const f=await request.formData(), id=String(f.get('clientId')||'').trim(), secret=String(f.get('clientSecret')||'').trim(); if(!id)return fail(400,{error:'Zoho Client ID is required.'}); await updateState((s)=>{s.zoho.clientId=id;if(secret)s.zoho.clientSecret=secret;s.zoho.dataCenter=String(f.get('dataCenter')||'com');}); return {saved:'zoho'}; },
  connectZoho: async ({ url }) => { let target=''; await updateState((s)=>{if(!s.zoho.clientId||!s.zoho.clientSecret)throw new Error('Save Zoho credentials first.');target=beginZoho(s,`${url.origin}/oauth/zoho/callback`);}); throw redirect(303,target); },
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
  // Views on the account stay (paused, error shown) so synced items are never lost.
  disconnectAccount: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s)=>{ s.accounts=s.accounts.filter((item)=>item.id!==id); for(const p of s.pipelines.filter((item)=>pipelineFolders(item).some((f)=>f.accountId===id))){p.lastError='Account disconnected';if(!hasAccount(s,p))p.enabled=false;} });
    return {disconnected:id};
  }
};
