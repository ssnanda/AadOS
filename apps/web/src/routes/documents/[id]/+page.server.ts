import { error, fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { database, readState } from '$lib/server/aados-store';
import { documentText, getDocument, listDocuments, setExtraction } from '$lib/server/ai/db';
import { askDocuments, rateLimited } from '$lib/server/ai/service';
import { describeError, AiError } from '$lib/server/ai/ajmcp';
import { extractionPass } from '$lib/server/documents/service';

export const load: PageServerLoad = async ({ params }) => {
  const db = await database();
  const doc = await getDocument(db, params.id);
  if (!doc) throw error(404, 'Document not found');
  const text = await documentText(db, params.id);
  const others = (await listDocuments(db, { limit: 100 })).filter((d) => d.id !== doc.id && d.hasText).map((d) => ({ id: d.id, filename: d.filename }));
  return { doc, preview: text.slice(0, 4000), textLength: text.length, others, aiEnabled: (await readState()).ai.enabled };
};

export const actions: Actions = {
  retry: async ({ params }) => { await setExtraction(await database(), String(params.id), 'pending', null); await extractionPass(1).catch(() => undefined); return { retried: true }; },
  ask: async ({ params, request }) => {
    if (rateLimited('docs-ai', 15)) return fail(429, { error: 'Too many requests; wait a minute.' });
    const f = await request.formData();
    const question = String(f.get('question') || '').trim().slice(0, 1000) || 'Summarize this document.';
    const compare = String(f.get('compare') || '');
    try { return { answer: await askDocuments(question, compare ? [String(params.id), compare] : [String(params.id)], request.signal), question }; }
    catch (e) { return fail(400, { error: e instanceof AiError ? describeError(e) : e instanceof Error ? e.message : 'Failed.', question }); }
  }
};
