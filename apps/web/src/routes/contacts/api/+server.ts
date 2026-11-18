import { json } from '@sveltejs/kit';
import { readState, updateState } from '$lib/server/aados-store';
import { scopeState } from '$lib/server/scope';
import { buildRows } from '$lib/server/inbox';
import { can } from '$lib/server/auth';
import { addressKey } from '$lib/messages-model';
import * as bb from '$lib/server/bluebubbles';
import { resetContactCache } from '$lib/server/contacts';

// Contact detail (recent emails + iMessage conversations for a person's addresses) and sender-group edits.
const s = (v: unknown, max = 300) => String(v ?? '').slice(0, max);
export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => ({}));
  const op = s(b.op, 30);
  if (op === 'refresh') { resetContactCache(); return json({ ok: true }); }
  if (op === 'group.rename' || op === 'group.delete' || op === 'group.removeAddress') {
    const id = s(b.id, 60);
    let groups: unknown[] = [];
    await updateState((st) => {
      let list = st.messageGroups ?? [];
      if (op === 'group.delete') list = list.filter((g) => g.id !== id);
      else if (op === 'group.rename') list = list.map((g) => (g.id === id && s(b.name, 80).trim() ? { ...g, name: s(b.name, 80).trim() } : g));
      else list = list.map((g) => (g.id === id ? { ...g, addresses: g.addresses.filter((a) => a !== s(b.address, 120)) } : g)).filter((g) => g.addresses.length);
      st.messageGroups = list; groups = list;
    });
    return json({ groups });
  }
  if (op === 'detail') {
    const emails: string[] = (Array.isArray(b.emails) ? b.emails : []).map((e: unknown) => s(e, 200).toLowerCase()).filter(Boolean);
    const phones: string[] = (Array.isArray(b.phones) ? b.phones : []).map((p: unknown) => addressKey(s(p, 60))).filter(Boolean);
    const state = scopeState(await readState(), locals.user);
    // Recent emails from (or mentioning) the person's addresses, across the mailboxes this user may see.
    const rows = can(locals.user, 'emails') || locals.user?.ownAccounts ? buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items }) : [];
    const mails = emails.length ? rows.filter((r) => emails.some((e) => r.sender.toLowerCase().includes(e))).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 15).map((r) => ({ key: r.key, subject: r.subject, sender: r.sender, at: r.receivedAt, account: r.accountEmail })) : [];
    // iMessage conversations with any of their numbers/emails (when Messages is connected and allowed).
    let chats: { guid: string; title: string; at: number; preview: string }[] = [];
    if (can(locals.user, 'messages') && bb.bbConfigured(await readState())) {
      try {
        const keys = new Set([...phones, ...emails]);
        chats = (await bb.chats(await bb.bbConnection(), 300)).filter((c) => c.participants.some((p) => keys.has(addressKey(p)))).slice(0, 10).map((c) => ({ guid: c.guid, title: c.title, at: c.last?.at || 0, preview: (c.last?.text || '').slice(0, 120) }));
      } catch { /* Messages unavailable */ }
    }
    return json({ mails, chats });
  }
  return json({ error: 'Unknown action.' }, { status: 400 });
};
