import { json } from '@sveltejs/kit';
import { create, draft, preview, type RuleInput } from '$lib/server/rule-draft';

// "Create rule…" from emails (phone and web).
//   POST {op:'draft', keys}        → candidate conditions, targets (AadOS / Gmail / Zoho-disabled), actions, body text
//   POST {op:'preview', ...rule}   → how many stored emails match now
//   POST {op:'create', ...rule}    → create (owner only); applyExisting also acts on current matches
export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return json({ error: 'Invalid request.' }, { status: 400 });
  const r = b.op === 'draft' ? await draft(locals.user, (Array.isArray(b.keys) ? b.keys : []).slice(0, 200).map(String))
    : b.op === 'preview' ? await preview(locals.user, b as RuleInput)
    : b.op === 'create' ? await create(locals.user, b as RuleInput)
    : { ok: false as const, error: 'Unknown op.' };
  return json(r, { status: r.ok ? 200 : 400 });
};
