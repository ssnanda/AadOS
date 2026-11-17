import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { database, hasDatabase } from '$lib/server/aados-store';
import { documentFolders, listDocuments, updateDocument } from '$lib/server/ai/db';
import { removeDocument, storageStatus } from '$lib/server/documents/service';
import { TYPES } from '$lib/server/documents/validate';
import { isDate } from '$lib/calendar/view';

export const load: PageServerLoad = async ({ url }) => {
  const status = storageStatus();
  if (!hasDatabase()) return { available: false, status, docs: [], folders: [], types: TYPES, filter: { q: '', type: '', folder: '', from: '', to: '' } };
  const p = url.searchParams;
  const filter = { q: (p.get('q') || '').trim().slice(0, 100), type: p.get('type') && p.get('type')! in TYPES ? p.get('type')! : '', folder: (p.get('folder') || '').slice(0, 80), from: isDate(p.get('from') || '') ? p.get('from')! : '', to: isDate(p.get('to') || '') ? p.get('to')! : '' };
  const db = await database();
  return { available: true, status, docs: await listDocuments(db, filter), folders: await documentFolders(db), types: TYPES, filter };
};

export const actions: Actions = {
  update: async ({ request }) => {
    const f = await request.formData();
    const filename = String(f.get('filename') || '').replace(/[\u0000-\u001f\u007f\\/<>:"|?*]/g, '').trim().slice(0, 180);
    if (!filename) return fail(400, { error: 'Enter a name.' });
    const ok = await updateDocument(await database(), String(f.get('id') || ''), { filename, folder: String(f.get('folder') || '').trim().slice(0, 80), category: String(f.get('category') || '').trim().slice(0, 60) });
    return ok ? { updated: true } : fail(404, { error: 'Document not found.' });
  },
  remove: async ({ request }) => {
    try { return (await removeDocument(String((await request.formData()).get('id') || ''))) ? { removed: true } : fail(404, { error: 'Document not found.' }); }
    catch (e) { return fail(502, { error: e instanceof Error ? e.message : 'Delete failed.' }); }
  }
};
