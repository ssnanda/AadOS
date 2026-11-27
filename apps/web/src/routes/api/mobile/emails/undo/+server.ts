import { json } from '@sveltejs/kit';
import { latestUndo, undo } from '$lib/server/mail-undo';

// Undo the newest (or a given) mailbox change: delete (restored from Trash), mark read, mark unread.
// GET → what would be undone (or null); POST {id?} → undo it. Shared by the phone (shake to undo) and the web.
export const GET = async ({ locals }) => json({ undo: await latestUndo(locals.user) });
export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => ({}));
  const r = await undo(locals.user, String(b?.id || '').slice(0, 64));
  return r.ok ? json(r) : json(r, { status: 400 });
};
