// Changes made in AadOS that are applied to the real mailbox: move to Trash, mark read/unread.
// The provider is changed first; AadOS is updated only for the accounts where that succeeded.
import { readState, type AadOSState, type MailAccount } from './aados-store';
import { gmailAccessToken, setGmailUnread, trashGmailMessage } from './gmail';
import { setZohoUnread, trashZohoMessage, zohoAccessToken } from './zoho';

export type MailOp = 'delete' | 'mark-read' | 'mark-unread';
const owner = (s: AadOSState, i: { pipelineId: string; accountId?: string }) => i.accountId || s.pipelines.find((p) => p.id === i.pipelineId)?.accountId || '';
const PARALLEL = 4;

/** Run `work` over `list`, at most PARALLEL at a time. */
async function inParallel<T>(list: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, async () => { while (next < list.length) await work(list[next++]); }));
}

/**
 * Returns the keys that were changed at the provider, one message per account that could not be changed,
 * and `tokens`: accounts whose access token was refreshed on the way. Reads state once and holds no lock
 * during the network calls; the caller saves its own change and `tokens` in ONE update.
 */
export async function applyToMailbox(op: MailOp, keys: string[]): Promise<{ done: string[]; errors: string[]; tokens: Pick<MailAccount, 'id' | 'accessToken' | 'expiresAt'>[] }> {
  const s = await readState();
  const wanted = new Set(keys);
  // One target per message (prefer the copy that knows its Zoho folder).
  const byKey = new Map<string, { accountId: string; messageId: string; folderId: string }>();
  for (const i of s.items) {
    const key = `${owner(s, i)}:${i.messageId}`;
    if (!wanted.has(key)) continue;
    const prev = byKey.get(key);
    if (!prev || (!prev.folderId && i.folderId)) byKey.set(key, { accountId: owner(s, i), messageId: i.messageId, folderId: i.folderId || '' });
  }
  const groups = new Map<string, { key: string; messageId: string; folderId: string }[]>();
  for (const [key, t] of byKey) (groups.get(t.accountId) || groups.set(t.accountId, []).get(t.accountId)!).push({ key, messageId: t.messageId, folderId: t.folderId });
  const done: string[] = [], errors: string[] = [], tokensBefore = new Map(s.accounts.map((a) => [a.id, a.accessToken]));
  for (const [accountId, list] of groups) {
    const account = s.accounts.find((a) => a.id === accountId);
    if (!account) { errors.push('An account for these emails is no longer connected.'); continue; }
    if (!account.canModify) { errors.push(`${account.email}: AadOS has read-only access. Settings → Emails → “Allow changes” to grant delete and mark read.`); continue; }
    try {
      if (op === 'delete') {
        // Refresh an expired token once, before the parallel calls (else each call would refresh it).
        await (account.provider === 'gmail' ? gmailAccessToken(s, account) : zohoAccessToken(s, account));
        await inParallel(list, async (m) => {
          try { account.provider === 'gmail' ? await trashGmailMessage(s, account, m.messageId) : await trashZohoMessage(s, account, m.folderId, m.messageId); done.push(m.key); }
          catch (e) { errors.push(`${account.email}: ${e instanceof Error ? e.message : 'could not delete'}`); }
        });
      } else {
        const unread = op === 'mark-unread';
        account.provider === 'gmail' ? await setGmailUnread(s, account, list.map((m) => m.messageId), unread) : await setZohoUnread(s, account, list.map((m) => m.messageId), unread);
        done.push(...list.map((m) => m.key));
      }
    } catch (e) { errors.push(`${account.email}: ${e instanceof Error ? e.message : 'update failed'}`); }
  }
  const tokens = s.accounts.filter((a) => a.accessToken && a.accessToken !== tokensBefore.get(a.id)).map((a) => ({ id: a.id, accessToken: a.accessToken, expiresAt: a.expiresAt }));
  return { done, errors: [...new Set(errors)], tokens };
}
