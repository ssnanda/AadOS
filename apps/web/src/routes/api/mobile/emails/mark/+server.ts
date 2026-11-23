import { json } from '@sveltejs/kit';
import { markEmails } from '$lib/server/email-list';

// Same ops as the /emails `mark` form action: delete (provider Trash), mark-read, mark-unread, and AadOS-only
// review ops (importance-high/normal, follow-up, clear-follow-up, actionable, reviewed, dismissed, clear-action, categories).
export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object' || !Array.isArray(b.keys)) return json({ error: 'Invalid request.' }, { status: 400 });
  const keys = (b.keys as unknown[]).slice(0, 500).map((k) => String(k).slice(0, 300));
  const r = await markEmails(locals.user, keys, String(b.op || ''), String(b.value || ''));
  return r.ok ? json(r) : json(r, { status: 400 });
};
