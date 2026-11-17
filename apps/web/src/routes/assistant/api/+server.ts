import { json } from '@sveltejs/kit';
import { database } from '$lib/server/aados-store';
import { AiError, describeError } from '$lib/server/ai/ajmcp';
import { answer, rateLimited } from '$lib/server/ai/service';
import { deleteConversation, getConversation, renameConversation, deleteMessage } from '$lib/server/ai/db';

// Owner-only (hooks enforce the session). JSON so the browser can cancel an in-flight request (AbortController);
// the abort propagates to the AJMCP call via request.signal.
export const POST = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, { status: 400 });
  const op = String(body.op || '');
  try {
    if (op === 'ask' || op === 'retry') {
      if (rateLimited('assistant', 20)) return json({ error: 'Too many questions in a minute; wait a moment.' }, { status: 429 });
      let question = String(body.question || '');
      const conversationId = body.conversationId ? String(body.conversationId) : null;
      if (op === 'retry' && conversationId) {
        // Re-ask the last question: drop the failed answer and its question, then ask again.
        const db = await database();
        const conv = await getConversation(db, conversationId);
        const lastUser = [...(conv?.messages || [])].reverse().find((m) => m.role === 'user');
        if (!conv || !lastUser) return json({ error: 'Nothing to retry.' }, { status: 400 });
        question = lastUser.content;
        for (const m of conv.messages.filter((m) => m.id >= lastUser.id)) await deleteMessage(db, conversationId, m.id);
      }
      if (question.length > 2000) return json({ error: 'Questions can be at most 2000 characters.' }, { status: 413 });
      return json(await answer(question, conversationId, request.signal));
    }
    const db = await database();
    const id = String(body.id || '');
    if (op === 'rename') return (await renameConversation(db, id, String(body.title || ''))) ? json({ ok: true }) : json({ error: 'Not found.' }, { status: 404 });
    if (op === 'delete') return (await deleteConversation(db, id)) ? json({ ok: true }) : json({ error: 'Not found.' }, { status: 404 });
    return json({ error: 'Unknown operation.' }, { status: 400 });
  } catch (e) {
    if (e instanceof AiError && e.kind === 'cancelled') return json({ error: 'Cancelled.' }, { status: 499 });
    return json({ error: e instanceof AiError ? describeError(e) : e instanceof Error ? e.message : 'Request failed.' }, { status: 400 });
  }
};
