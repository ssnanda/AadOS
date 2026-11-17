// Changes made in AadOS that are applied to the real mailbox: move to Trash, mark read/unread.
// The provider is changed first; AadOS is updated only for the accounts where that succeeded.
import { readState, updateStateDetached, type AadOSState } from './aados-store';
import { setGmailUnread, trashGmailMessage } from './gmail';
import { setZohoUnread, trashZohoMessage } from './zoho';

export type MailOp = 'delete' | 'mark-read' | 'mark-unread';
const owner = (s: AadOSState, i: { pipelineId: string; accountId?: string }) => i.accountId || s.pipelines.find((p) => p.id === i.pipelineId)?.accountId || '';

/** Returns the keys that were changed at the provider, plus one message per account that could not be changed. */
export async function applyToMailbox(op: MailOp, keys: string[]): Promise<{ done: string[]; errors: string[] }> {
  const state = await readState();
  const wanted = new Set(keys);
  // One target per message (prefer the copy that knows its Zoho folder).
  const byKey = new Map<string, { accountId: string; messageId: string; folderId: string }>();
  for (const i of state.items) {
    const key = `${owner(state, i)}:${i.messageId}`;
    if (!wanted.has(key)) continue;
    const prev = byKey.get(key);
    if (!prev || (!prev.folderId && i.folderId)) byKey.set(key, { accountId: owner(state, i), messageId: i.messageId, folderId: i.folderId || '' });
  }
  const groups = new Map<string, { key: string; messageId: string; folderId: string }[]>();
  for (const [key, t] of byKey) (groups.get(t.accountId) || groups.set(t.accountId, []).get(t.accountId)!).push({ key, messageId: t.messageId, folderId: t.folderId });
  const done: string[] = [], errors: string[] = [];
  // Detached: token refreshes are saved without holding the state lock during network calls.
  await updateStateDetached(async (s) => {
    for (const [accountId, list] of groups) {
      const account = s.accounts.find((a) => a.id === accountId);
      if (!account) { errors.push('An account for these emails is no longer connected.'); continue; }
      if (!account.canModify) { errors.push(`${account.email}: AadOS has read-only access. Settings → Emails → “Allow changes” to grant delete and mark read.`); continue; }
      try {
        if (op === 'delete') {
          for (const m of list) {
            try { account.provider === 'gmail' ? await trashGmailMessage(s, account, m.messageId) : await trashZohoMessage(s, account, m.folderId, m.messageId); done.push(m.key); }
            catch (e) { errors.push(`${account.email}: ${e instanceof Error ? e.message : 'could not delete'}`); }
          }
        } else {
          const unread = op === 'mark-unread';
          account.provider === 'gmail' ? await setGmailUnread(s, account, list.map((m) => m.messageId), unread) : await setZohoUnread(s, account, list.map((m) => m.messageId), unread);
          done.push(...list.map((m) => m.key));
        }
      } catch (e) { errors.push(`${account.email}: ${e instanceof Error ? e.message : 'update failed'}`); }
    }
  });
  return { done, errors: [...new Set(errors)] };
}
