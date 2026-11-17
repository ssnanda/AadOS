import { keyAllowed } from '$lib/server/scope';
import { json } from '@sveltejs/kit';
import { createRule, details, prepare, related, removeRule, rules, send } from '$lib/server/mail-tools';
import { rateLimited } from '$lib/server/ai/service';
import type { Mode } from '$lib/server/compose';

const MODES: Mode[] = ['reply', 'replyAll', 'forward'];
// Owner-only (session enforced in hooks). Sending happens only on an explicit "send" request from the compose form.
export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return json({ error: 'Invalid request.' }, { status: 400 });
  const key = String(b.key || '').slice(0, 300), op = String(b.op || '');
  if (key && !keyAllowed(locals.user, key)) return json({ error: 'Email not found.' }, { status: 404 });
  try {
    switch (op) {
      case 'details': { const d = await details(key); const { headers: _h, text: _t, ...rest } = d; return json(rest); }
      case 'prepare': return json(await prepare(key, MODES.includes(b.mode) ? b.mode : 'reply'));
      case 'send': {
        if (rateLimited('send', 20)) return json({ error: 'Too many messages in a minute.' }, { status: 429 });
        const mode: Mode = MODES.includes(b.mode) ? b.mode : 'reply';
        return json(await send(key, { mode, to: String(b.to || '').slice(0, 2000), cc: String(b.cc || '').slice(0, 2000), bcc: String(b.bcc || '').slice(0, 2000), subject: String(b.subject || '').slice(0, 500), text: String(b.text || '').slice(0, 100_000), attachments: b.attachments === true }));
      }
      case 'related': return json(await related(key, b.scope === 'domain' ? 'domain' : 'sender', b.sameSubject === true));
      case 'rules': return json(await rules(String(b.accountId || '')));
      case 'createRule': return json({ filter: await createRule(String(b.accountId || ''), { field: b.field === 'subject' ? 'subject' : 'from', text: String(b.text || ''), labelId: String(b.labelId || ''), markRead: b.markRead === true, archive: b.archive === true }) });
      case 'deleteRule': await removeRule(String(b.accountId || ''), String(b.id || '')); return json({ ok: true });
      default: return json({ error: 'Unknown operation.' }, { status: 400 });
    }
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Request failed.' }, { status: 400 }); }
};
