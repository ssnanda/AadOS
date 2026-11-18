import { keyAllowed } from '$lib/server/scope';
import { json } from '@sveltejs/kit';
import { database, readState, updateState } from '$lib/server/aados-store';
import { AiError, describeError } from '$lib/server/ai/ajmcp';
import { rateLimited } from '$lib/server/ai/service';
import { applySuggestion, ask, attachments, classify, draft, findRow, saveAttachment } from '$lib/server/ai/email-service';
import { deleteDraft, getInsights, listDrafts, markInsightReviewed, saveDraft } from '$lib/server/ai/db';
import { AI_CATEGORIES, type Tone } from '$lib/server/ai/email-ai';
import { findDuplicate } from '$lib/server/tasks';
import { tick } from '$lib/server/reminders';

const TONES: Tone[] = ['reply', 'shorten', 'formal', 'friendly', 'regenerate', 'polish'];

// Owner-only email AI actions. Read-only towards Gmail/Zoho: nothing here sends or modifies a mailbox.
export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return json({ error: 'Invalid request.' }, { status: 400 });
  const op = String(b.op || ''), key = String(b.key || '').slice(0, 300);
  if (key && !keyAllowed(locals.user, key)) return json({ error: 'Email not found.' }, { status: 404 });
  try {
    const state = await readState();
    if (!findRow(state, key)) return json({ error: 'Email not found.' }, { status: 404 });
    const db = await database();
    const aiOps = ['summarize', 'explain', 'followup', 'classify', 'draft'];
    if (aiOps.includes(op) && rateLimited('email-ai', 30)) return json({ error: 'Too many AI requests; wait a minute.' }, { status: 429 });
    switch (op) {
      case 'state': return json({ insight: (await getInsights(db, [key])).get(key) || null, drafts: await listDrafts(db, key) });
      case 'summarize': case 'explain': case 'followup': return json(await ask(op, key, request.signal));
      case 'classify': return json({ insight: await classify(key, undefined, request.signal) });
      case 'draft': {
        const tone = TONES.includes(b.tone) ? (b.tone as Tone) : 'reply';
        return json(await draft(key, tone, String(b.current || '').slice(0, 6000), Number(b.draftId) || undefined, request.signal));
      }
      case 'saveDraft': {
        const content = String(b.content || '').slice(0, 10000);
        if (!content.trim()) return json({ error: 'The draft is empty.' }, { status: 400 });
        return json({ draft: await saveDraft(db, { id: Number(b.draftId) || undefined, key, content, aiGenerated: Boolean(b.aiGenerated), edited: true }) });
      }
      case 'deleteDraft': await deleteDraft(db, key, Number(b.draftId)); return json({ ok: true });
      case 'category': {
        const category = AI_CATEGORIES.find((c) => c === b.category);
        if (!category) return json({ error: 'Unknown category.' }, { status: 400 });
        await applySuggestion(key, 'category', category === 'Informational' ? 'Other' : category); return json({ ok: true });
      }
      case 'reviewed': await applySuggestion(key, 'reviewed'); await markInsightReviewed(db, key); return json({ ok: true });
      case 'task': {
        const title = String(b.title || '').trim().slice(0, 200), due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due || '')) ? String(b.due) : '';
        if (!title) return json({ error: 'Enter a task.' }, { status: 400 });
        let duplicate = '';
        await updateState((s) => {
          const existing = findDuplicate(s.tasks, { title, due, emailKey: key });
          if (existing) { duplicate = existing.title; return; }
          s.tasks.push({ id: crypto.randomUUID(), title, due, done: false, priority: 'normal', createdAt: new Date().toISOString(), emailKey: key });
          tick(s);
        });
        return duplicate ? json({ error: `Already a task: “${duplicate}”.` }, { status: 409 }) : json({ ok: true });
      }
      case 'attachments': return json({ attachments: await attachments(key) });
      case 'saveAttachment': {
        const r = await saveAttachment(key, String(b.attachmentId || ''), String(b.filename || 'attachment'));
        return json({ id: r.doc.id, duplicate: r.duplicate });
      }
      default: return json({ error: 'Unknown operation.' }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof AiError && e.kind === 'cancelled') return json({ error: 'Cancelled.' }, { status: 499 });
    return json({ error: e instanceof AiError ? describeError(e) : e instanceof Error ? e.message : 'Request failed.' }, { status: 400 });
  }
};
