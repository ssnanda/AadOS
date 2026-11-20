import { json } from '@sveltejs/kit';
import { readState, updateStateDetached, type AadOSState, type MailAccount } from '$lib/server/aados-store';
import { scopeState } from '$lib/server/scope';
import { setSharedRead, sharedBody, sharedBoxes, sharedMessages, trashShared } from '$lib/server/zoho-shared';
import { sendZoho } from '$lib/server/zoho';

// Zoho shared mailboxes: list boxes, list messages, read a body, mark read/unread, move to Trash. Live from Zoho.
const s = (v: unknown, max = 300) => String(v ?? '').slice(0, max);

export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => ({}));
  const op = s(b.op, 20), accountId = s(b.accountId), address = s(b.address).toLowerCase(), id = s(b.id);
  const visible = scopeState(await readState(), locals.user).accounts.filter((a) => a.provider === 'zoho' && !a.paused);
  // Run with a private snapshot so a refreshed token is saved without blocking other writes.
  const withAccount = async <T>(acct: string, fn: (st: AadOSState, a: MailAccount) => Promise<T>): Promise<T> => {
    if (!visible.some((a) => a.id === acct)) throw new Error('Account not found.');
    let out: T | undefined;
    await updateStateDetached(async (st) => { const a = st.accounts.find((x) => x.id === acct); if (!a) throw new Error('Account not found.'); out = await fn(st, a); });
    return out as T;
  };
  try {
    switch (op) {
      case 'boxes': {
        const out: { accountId: string; email: string; boxes: Awaited<ReturnType<typeof sharedBoxes>>; error: string }[] = [];
        for (const a of visible) {
          try { out.push({ accountId: a.id, email: a.email, boxes: await withAccount(a.id, (st, x) => sharedBoxes(st, x, b.fresh === true)), error: '' }); }
          catch (e) { out.push({ accountId: a.id, email: a.email, boxes: [], error: e instanceof Error ? e.message : 'failed' }); }
        }
        return json({ accounts: out });
      }
      case 'list': return json(await withAccount(accountId, (st, a) => sharedMessages(st, a, address, b.unreadOnly === true, Number(b.start) || 0)));
      case 'body': return json(await withAccount(accountId, (st, a) => sharedBody(st, a, id)));
      case 'read': await withAccount(accountId, (st, a) => setSharedRead(st, a, address, id, b.read !== false)); return json({ ok: true });
      case 'trash': await withAccount(accountId, (st, a) => trashShared(st, a, address, id)); return json({ ok: true });
      case 'send': {
        if (!visible.find((a) => a.id === accountId)?.canSend) throw new Error('Allow changes for this Zoho account in Settings → Emails.');
        const to = s(b.to, 2000).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
        if (!to.length || to.some((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.replace(/^.*<([^>]+)>$/, '$1')))) throw new Error('Add a valid recipient.');
        await withAccount(accountId, async (st, a) => {
          if (!(await sharedBoxes(st, a)).some((box) => box.address === address)) throw new Error('Shared mailbox not found.');
          await sendZoho(st, a, { from: address, to, cc: [], bcc: [], subject: s(b.subject, 500), text: s(b.text, 100_000) });
        });
        return json({ ok: true });
      }
    }
    return json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Zoho request failed.';
    return json({ error: /scope|INVALID_OAUTH|permission/i.test(msg) ? `${msg} — Zoho may need an extra permission for shared mailboxes; reconnect the account with “Allow changes”.` : msg }, { status: 400 });
  }
};
