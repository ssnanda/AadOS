import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { publicState, readState, updateState } from '$lib/server/aados-store';
import { beginOAuth as beginZoho, discoverAccountAndFolders } from '$lib/server/zoho';
import { beginGmailOAuth, discoverGmailFolders } from '$lib/server/gmail';

export const load: PageServerLoad = async ({ url }) => ({ ...publicState(await readState()), zohoRedirect: `${url.origin}/oauth/zoho/callback`, gmailRedirect: `${url.origin}/oauth/gmail/callback`, error: url.searchParams.get('error') || '' });
export const actions: Actions = {
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
