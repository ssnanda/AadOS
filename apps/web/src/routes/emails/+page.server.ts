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
    const folderIds = form.getAll('folderId').map(String).filter(Boolean);
    const parser = String(form.get('parser') || '') as PipelineParser;
    const name = String(form.get('name') || '').trim();
    if (!['zoho', 'gmail'].includes(source) || !['shop', 'health', 'generic'].includes(parser)) return fail(400, { error: 'Choose a provider and view type.' });
    try { await updateState((state) => {
      const folders = folderIds.map((id) => state[source].folders.find((item) => item.id === id)).filter((item) => item !== undefined);
      if (!folders.length || folders.length !== folderIds.length) throw new Error('Choose at least one regular folder or label.');
      const id = slug(`${source}-${name || parser}`);
      if (state.pipelines.some((item) => item.id === id)) throw new Error('That view name is already configured.');
      const selected = folders.map((folder) => ({ id: folder.id, name: folder.path || folder.name }));
      const defaultName = parser === 'shop' ? 'Shopping' : parser === 'health' ? 'Health' : folders[0].name;
      state.pipelines.push({ id, name: name || defaultName, source, folderId: selected[0].id, folderName: selected.map((folder) => folder.name).join(', '), folders: selected, parser, enabled: true, cursor: 0, lastSync: '', lastError: '' });
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
