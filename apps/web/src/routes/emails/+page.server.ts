import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { publicState, readState, updateState, type PipelineParser } from '$lib/server/aados-store';
import { syncPipeline } from '$lib/server/zoho';
import { syncGmailPipeline } from '$lib/server/gmail';

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export const load: PageServerLoad = async () => publicState(await readState());
export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    const source = String(form.get('source') || '') as 'zoho' | 'gmail';
    const folderId = String(form.get('folderId') || '');
    const parser = String(form.get('parser') || '') as PipelineParser;
    const name = String(form.get('name') || '').trim();
    if (!['zoho', 'gmail'].includes(source) || !['shop', 'health'].includes(parser)) return fail(400, { error: 'Choose a provider and workflow.' });
    try { await updateState((state) => {
      const folder = state[source].folders.find((item) => item.id === folderId);
      if (!folder) throw new Error('Choose a regular folder or label.');
      const id = slug(`${source}-${name || parser}`);
      if (state.pipelines.some((item) => item.id === id || (item.source === source && item.folderId === folderId))) throw new Error('That workflow or folder is already configured.');
      state.pipelines.push({ id, name: name || (parser === 'shop' ? 'Shopping' : 'Health'), source, folderId, folderName: folder.path || folder.name, parser, enabled: true, cursor: 0, lastSync: '', lastError: '' });
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
  }
};
