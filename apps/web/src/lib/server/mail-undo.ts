import { readState, updateState, type AadOSState, type MailUndo, type PipelineItem } from './aados-store';
import type { SessionUser } from './auth';
import { markEmails } from './email-list';
import { untrashGmailMessage } from './gmail';
import { moveZohoMessages } from './zoho';
import { keyAllowed } from './scope';

// Undo for mailbox changes (web Undo, phone shake to undo): delete, mark read (incl. by opening), mark unread.
// Delete is undone by taking the email out of the provider's Trash (Gmail untrash; Zoho move back to its folder)
// and putting AadOS's stored copies back. Rule actions are undoable the same way.

const KEEP = 20;
const VERB: Record<MailUndo['op'], string> = { delete: 'Delete', 'mark-read': 'Mark read', 'mark-unread': 'Mark unread' };
const ownerOf = (s: AadOSState, i: PipelineItem) => i.accountId || s.pipelines.find((p) => p.id === i.pipelineId)?.accountId || '';

/** Inside an updateState: remember a change so it can be undone (newest first, last KEEP kept). */
export function recordUndo(state: AadOSState, op: MailUndo['op'], keys: string[], copies: PipelineItem[]) {
  if (!keys.length) return;
  const first = copies[0]?.subject || '(no subject)';
  const label = `${VERB[op]}: “${first.slice(0, 80)}”${keys.length > 1 ? ` + ${keys.length - 1} more` : ''}`;
  const entry: MailUndo = { id: crypto.randomUUID(), at: new Date().toISOString(), op, keys, label, ...(op === 'delete' ? { items: copies.map((c) => ({ ...c })) } : {}) };
  state.mailUndo = [entry, ...(state.mailUndo || [])].slice(0, KEEP);
}

const visible = (user: SessionUser | null, e: MailUndo) => e.keys.every((k) => keyAllowed(user, k));
const summary = (e: MailUndo) => ({ id: e.id, at: e.at, op: e.op, label: e.label, count: e.keys.length });

/** The newest change this user may undo (or null). */
export async function latestUndo(user: SessionUser | null) {
  const e = ((await readState()).mailUndo || []).find((x) => visible(user, x));
  return e ? summary(e) : null;
}

/** Undo one change (newest when `id` is empty). */
export async function undo(user: SessionUser | null, id = ''): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const state = await readState();
  const entry = (state.mailUndo || []).find((x) => (id ? x.id === id : true) && visible(user, x));
  if (!entry) return { ok: false, error: 'Nothing to undo.' };
  const drop = () => updateState((s) => { s.mailUndo = (s.mailUndo || []).filter((x) => x.id !== entry.id); });

  if (entry.op !== 'delete') {
    // The reverse change, not itself recorded (no undo of an undo).
    const r = await markEmails(user, entry.keys, entry.op === 'mark-read' ? 'mark-unread' : 'mark-read', '', { record: false });
    if (!r.ok) return { ok: false, error: r.error };
    await drop();
    return { ok: true, message: `Undone: ${entry.label}${r.warning ? ` (${r.warning})` : ''}` };
  }

  // Delete: restore at the provider first, then put back the stored copies of what came back.
  const items = entry.items || [];
  const byAccount = new Map<string, Map<string, PipelineItem>>();
  for (const i of items) { const a = ownerOf(state, i); const m = byAccount.get(a) ?? new Map(); if (!m.has(i.messageId) || (!m.get(i.messageId)!.folderId && i.folderId)) m.set(i.messageId, i); byAccount.set(a, m); }
  const restored = new Set<string>(), errors: string[] = [];
  const tokensBefore = new Map(state.accounts.map((a) => [a.id, a.accessToken]));
  for (const [accountId, messages] of byAccount) {
    const account = state.accounts.find((a) => a.id === accountId);
    if (!account) { errors.push('An account for these emails is no longer connected.'); continue; }
    if (account.provider === 'gmail') {
      for (const m of messages.values()) {
        try { await untrashGmailMessage(state, account, m.messageId); restored.add(`${accountId}:${m.messageId}`); }
        catch (e) { errors.push(`${account.email}: ${e instanceof Error ? e.message : 'could not restore'}`); }
      }
    } else {
      const byFolder = new Map<string, string[]>();
      for (const m of messages.values()) { if (!m.folderId) { errors.push(`${account.email}: original folder unknown`); continue; } byFolder.set(m.folderId, [...(byFolder.get(m.folderId) || []), m.messageId]); }
      for (const [folderId, ids] of byFolder) {
        try { await moveZohoMessages(state, account, ids, folderId); ids.forEach((mid) => restored.add(`${accountId}:${mid}`)); }
        catch (e) { errors.push(`${account.email}: ${e instanceof Error ? e.message : 'could not restore'} — restore it from Zoho's Trash`); }
      }
    }
  }
  if (!restored.size) return { ok: false, error: [...new Set(errors)].join(' ') || 'Nothing was restored.' };
  await updateState((s) => {
    for (const a of state.accounts) if (a.accessToken !== tokensBefore.get(a.id)) { const t = s.accounts.find((x) => x.id === a.id); if (t) { t.accessToken = a.accessToken; t.expiresAt = a.expiresAt; } }
    const back = items.filter((i) => restored.has(`${ownerOf(s, i)}:${i.messageId}`));
    const ids = new Set(back.map((i) => i.id)), present = new Set(s.items.map((i) => i.id));
    s.items.push(...back.filter((i) => !present.has(i.id)));
    s.dismissed = s.dismissed.filter((d) => !ids.has(d));
    // Fully restored: forget the entry; partly: keep only what is still in Trash.
    const left = entry.keys.filter((k) => !restored.has(k));
    s.mailUndo = (s.mailUndo || []).flatMap((x) => (x.id !== entry.id ? [x] : left.length ? [{ ...x, keys: left, items: (x.items || []).filter((i) => !restored.has(`${ownerOf(s, i)}:${i.messageId}`)) }] : []));
  });
  const n = restored.size;
  return { ok: true, message: `Restored ${n} email${n === 1 ? '' : 's'} from Trash.${errors.length ? ` ${[...new Set(errors)].join(' ')}` : ''}` };
}
