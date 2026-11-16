import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { publicState, readState, updateState, type PipelineParser } from '$lib/server/aados-store';
import { beginOAuth as beginZoho, discoverAccountAndFolders, syncPipeline } from '$lib/server/zoho';
import { beginGmailOAuth, discoverGmailFolders, syncGmailPipeline } from '$lib/server/gmail';

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const load: PageServerLoad = async ({ url }) => ({ ...publicState(await readState()), zohoRedirect: `${url.origin}/oauth/zoho/callback`, gmailRedirect: `${url.origin}/oauth/gmail/callback`, error: url.searchParams.get('error') || '' });
export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    const accountId = String(form.get('accountId') || '');
    const folderIds = form.getAll('folderId').map(String).filter(Boolean);
    const parser = String(form.get('parser') || '') as PipelineParser;
    const name = String(form.get('name') || '').trim();
    if (!['shop', 'health', 'generic'].includes(parser)) return fail(400, { error: 'Choose a view type.' });
    try { await updateState((state) => {
      const account = state.accounts.find((item) => item.id === accountId);
      if (!account) throw new Error('Choose a connected account.');
      const source = account.provider;
      const folders = folderIds.map((id) => account.folders.find((item) => item.id === id)).filter((item) => item !== undefined);
      if (!folders.length || folders.length !== folderIds.length) throw new Error('Choose at least one regular folder or label.');
      const id = slug(`${account.id}-${name || parser}`);
      if (state.pipelines.some((item) => item.id === id)) throw new Error('That view name is already configured.');
      const selected = folders.map((folder) => ({ id: folder.id, name: folder.path || folder.name }));
      const defaultName = parser === 'shop' ? 'Shopping' : parser === 'health' ? 'Health' : folders[0].name;
      state.pipelines.push({ id, name: name || defaultName, source, accountId: account.id, folderId: selected[0].id, folderName: selected.map((folder) => folder.name).join(', '), folders: selected, parser, enabled: true, cursor: 0, lastSync: '', lastError: '' });
    }); return { created: true }; }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not create workflow.' }); }
  },
  sync: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    try { let result = { scanned: 0, added: 0 }; await updateState(async (state) => { const pipeline = state.pipelines.find((item) => item.id === id); if (!pipeline) throw new Error('Email workflow not found.'); result = pipeline.source === 'gmail' ? await syncGmailPipeline(state, pipeline) : await syncPipeline(state, pipeline); }); return { synced: id, ...result }; }
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
  refreshAccount: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    try { await updateState(async (s)=>{ const account=s.accounts.find((item)=>item.id===id); if(!account)throw new Error('Account not found.'); if(account.provider==='zoho')await discoverAccountAndFolders(s,account); else await discoverGmailFolders(s,account); }); return {refreshed:id}; }
    catch(c){return fail(400,{error:c instanceof Error?c.message:'Refresh failed.'});}
  },
  // Views on the account stay (paused, error shown) so synced items are never lost.
  disconnectAccount: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s)=>{ s.accounts=s.accounts.filter((item)=>item.id!==id); for(const p of s.pipelines.filter((item)=>item.accountId===id)){p.enabled=false;p.lastError='Account disconnected';} });
    return {disconnected:id};
  }
};
