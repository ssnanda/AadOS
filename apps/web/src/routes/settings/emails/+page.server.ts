import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { publicState, readState, updateState } from '$lib/server/aados-store';
import { beginOAuth as beginZoho, discoverAccountAndFolders } from '$lib/server/zoho';
import { beginGmailOAuth, discoverGmailFolders } from '$lib/server/gmail';

export const load: PageServerLoad = async ({ url }) => ({ ...publicState(await readState()), zohoRedirect: `${url.origin}/oauth/zoho/callback`, gmailRedirect: `${url.origin}/oauth/gmail/callback`, error: url.searchParams.get('error') || '' });
export const actions: Actions = {
  saveZoho: async ({ request }) => { const f=await request.formData(), id=String(f.get('clientId')||'').trim(), secret=String(f.get('clientSecret')||'').trim(); if(!id)return fail(400,{error:'Zoho Client ID is required.'}); await updateState((s)=>{s.zoho.clientId=id;if(secret)s.zoho.clientSecret=secret;s.zoho.dataCenter=String(f.get('dataCenter')||'com');}); return {saved:'zoho'}; },
  connectZoho: async ({ url }) => { let target=''; await updateState((s)=>{if(!s.zoho.clientId||!s.zoho.clientSecret)throw new Error('Save Zoho credentials first.');target=beginZoho(s,`${url.origin}/oauth/zoho/callback`);}); throw redirect(303,target); },
  refreshZoho: async () => { try{await updateState(discoverAccountAndFolders);return {refreshed:'zoho'};}catch(c){return fail(400,{error:c instanceof Error?c.message:'Zoho refresh failed.'});} },
  saveGmail: async ({ request }) => { const f=await request.formData(), id=String(f.get('clientId')||'').trim(), secret=String(f.get('clientSecret')||'').trim(); if(!id)return fail(400,{error:'Google Client ID is required.'}); await updateState((s)=>{s.gmail.clientId=id;if(secret)s.gmail.clientSecret=secret;}); return {saved:'gmail'}; },
  connectGmail: async ({ url }) => { let target=''; await updateState((s)=>{if(!s.gmail.clientId||!s.gmail.clientSecret)throw new Error('Save Google credentials first.');target=beginGmailOAuth(s,`${url.origin}/oauth/gmail/callback`);}); throw redirect(303,target); },
  refreshGmail: async () => { try{await updateState(discoverGmailFolders);return {refreshed:'gmail'};}catch(c){return fail(400,{error:c instanceof Error?c.message:'Gmail refresh failed.'});} }
};
