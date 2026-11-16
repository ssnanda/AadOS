import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { publicState, readState, updateState, type PipelineParser } from '$lib/server/aados-store';
import { beginOAuth, discoverAccountAndFolders, syncPipeline } from '$lib/server/zoho';

const dataCenter = (value: FormDataEntryValue | null) => ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'].includes(String(value)) ? String(value) : 'com';
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const load: PageServerLoad = async ({ url }) => ({ ...publicState(await readState()), redirectUri: `${url.origin}/oauth/zoho/callback`, error: url.searchParams.get('error') || '', connectedNow: url.searchParams.get('connected') === '1' });

export const actions: Actions = {
  save: async ({ request }) => {
    const form = await request.formData();
    const clientId = String(form.get('clientId') || '').trim();
    const clientSecret = String(form.get('clientSecret') || '').trim();
    if (!clientId) return fail(400, { error: 'Client ID is required.' });
    await updateState((state) => {
      state.zoho.clientId = clientId;
      if (clientSecret) state.zoho.clientSecret = clientSecret;
      state.zoho.dataCenter = dataCenter(form.get('dataCenter'));
    });
    return { saved: true };
  },
  connect: async ({ url }) => {
    let authorizationUrl = '';
    await updateState((state) => {
      if (!state.zoho.clientId || !state.zoho.clientSecret) throw new Error('Save the Zoho Client ID and Client Secret first.');
      authorizationUrl = beginOAuth(state, `${url.origin}/oauth/zoho/callback`);
    });
    throw redirect(303, authorizationUrl);
  },
  refreshFolders: async () => {
    try { await updateState(discoverAccountAndFolders); }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not refresh folders.' }); }
    return { refreshed: true };
  },
  createPipeline: async ({ request }) => {
    const form = await request.formData();
    const folderId = String(form.get('folderId') || '');
    const parser = String(form.get('parser') || 'generic') as PipelineParser;
    const name = String(form.get('name') || '').trim();
    if (!['shop', 'health', 'generic'].includes(parser)) return fail(400, { error: 'Invalid parser.' });
    try {
      await updateState((state) => {
        const folder = state.zoho.folders.find((item) => item.id === folderId);
        if (!folder) throw new Error('Select a Zoho folder.');
        const id = slug(name || folder.name);
        if (!id) throw new Error('Pipeline name is required.');
        if (state.pipelines.some((item) => item.id === id || item.folderId === folderId)) throw new Error('That pipeline or folder is already configured.');
        state.pipelines.push({ id, name: name || folder.name, source: 'zoho', folderId, folderName: folder.path || folder.name, parser, enabled: true, cursor: 0, lastSync: '', lastError: '' });
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not create pipeline.' }); }
    return { created: true };
  },
  sync: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    try {
      let result = { scanned: 0, added: 0 };
      await updateState(async (state) => {
        const pipeline = state.pipelines.find((item) => item.id === id);
        if (!pipeline) throw new Error('Pipeline not found.');
        result = await syncPipeline(state, pipeline);
      });
      return { synced: id, ...result };
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Sync failed.' }); }
  },
  toggle: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    try {
      await updateState((state) => {
        const pipeline = state.pipelines.find((item) => item.id === id);
        if (!pipeline) throw new Error('Pipeline not found.');
        pipeline.enabled = !pipeline.enabled;
      });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not update pipeline.' }); }
    return { toggled: id };
  },
  disconnect: async () => {
    await updateState((state) => {
      Object.assign(state.zoho, { connectedEmail: '', accountId: '', accessToken: '', refreshToken: '', expiresAt: 0, apiDomain: '', oauthState: '', oauthStateExpiresAt: 0, folders: [] });
    });
    return { disconnected: true };
  }
};
