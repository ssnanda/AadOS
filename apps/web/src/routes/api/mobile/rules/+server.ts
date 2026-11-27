import { json } from '@sveltejs/kit';
import { create, draft, getRule, options, preview, update, type RuleInput } from '$lib/server/rule-draft';

// "Create rule…" from emails (phone and web).
//   POST {op:'draft', keys}        → candidate conditions, targets (AadOS / Gmail / Zoho-disabled), actions, body text
//   POST {op:'preview', days, ...rule} → dry run: matching emails in the last `days` (7 default; 0 = all time)
//   POST {op:'create', ...rule}    → create (owner only); applyExisting also acts on current matches
//   POST {op:'options'}            → AadOS targets + actions (new rule without emails)
//   POST {op:'get', id} / {op:'update', id, ...rule} → edit an AadOS rule
export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return json({ error: 'Invalid request.' }, { status: 400 });
  const r = b.op === 'draft' ? await draft(locals.user, (Array.isArray(b.keys) ? b.keys : []).slice(0, 200).map(String))
    : b.op === 'preview' ? await preview(locals.user, b as RuleInput)
    : b.op === 'create' ? await create(locals.user, b as RuleInput)
    : b.op === 'options' ? await options(locals.user)
    : b.op === 'get' ? await getRule(locals.user, String(b.id || ''))
    : b.op === 'update' ? await update(locals.user, String(b.id || ''), b as RuleInput)
    : { ok: false as const, error: 'Unknown op.' };
  return json(r, { status: r.ok ? 200 : 400 });
};
