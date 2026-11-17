// What a signed-in family member may see of the mail data: only the mailboxes the owner allowed (none without the
// Emails permission). The owner sees everything. Read-side filter; write endpoints check keys with `keyAllowed`.
import { can, canSeeAccount, type SessionUser } from './auth';
import { pipelineFolders, type AadOSState } from './aados-store';

/** Accounts a family member linked themselves are private to them (hidden from the owner and other members). */
export const othersAccount = (a: { ownerId?: string }, user: SessionUser | null | undefined) => Boolean(a.ownerId && a.ownerId !== (user?.owner ? '' : user?.id));

/** Accounts whose calendars this user sees: their own linked ones, plus the owner's with the Calendar permission. */
export function calendarAccounts(state: AadOSState, user: SessionUser | null | undefined): Set<string> {
  return new Set(state.accounts.filter((a) => !othersAccount(a, user) && (a.ownerId ? true : can(user, 'calendar'))).map((a) => a.id));
}

export function scopeState(raw: AadOSState, user: SessionUser | null | undefined): AadOSState {
  // Someone else's own linked accounts are removed entirely (mail, folders, views).
  const foreign = new Set(raw.accounts.filter((a) => othersAccount(a, user)).map((a) => a.id));
  const own0 = new Map(raw.pipelines.map((p) => [p.id, p.accountId]));
  const input = foreign.size ? { ...raw, accounts: raw.accounts.filter((a) => !foreign.has(a.id)), items: raw.items.filter((i) => !foreign.has(i.accountId || own0.get(i.pipelineId) || '')), pipelines: raw.pipelines.filter((p) => !pipelineFolders(p).every((f) => foreign.has(f.accountId || ''))) } : raw;
  // Accounts with Email turned off in Settings: their mail is hidden for everyone (the account and calendar stay).
  const off = new Set(input.accounts.filter((a) => a.paused).map((a) => a.id));
  const owner0 = new Map(input.pipelines.map((p) => [p.id, p.accountId]));
  const state = off.size ? { ...input, items: input.items.filter((i) => !off.has(i.accountId || owner0.get(i.pipelineId) || '')), pipelines: input.pipelines.filter((p) => !pipelineFolders(p).every((f) => off.has(f.accountId || ''))) } : input;
  if (user?.owner) return state;
  if (!user || (!can(user, 'emails') && !user.ownAccounts)) return { ...state, accounts: [], items: [], pipelines: [] };
  if (user.mailboxes === 'all') return state;
  const ok = (id: string | undefined) => Boolean(id && canSeeAccount(user, id));
  const ownerOf = new Map(state.pipelines.map((p) => [p.id, p.accountId]));
  return {
    ...state,
    accounts: state.accounts.filter((a) => ok(a.id)),
    pipelines: state.pipelines.filter((p) => pipelineFolders(p).some((f) => ok(f.accountId))),
    items: state.items.filter((i) => ok(i.accountId || ownerOf.get(i.pipelineId)))
  };
}
/** Email keys are `accountId:messageId`. */
export const keyAllowed = (user: SessionUser | null | undefined, key: string) => Boolean(user && (user.owner || ((can(user, 'emails') || user.ownAccounts) && canSeeAccount(user, key.slice(0, key.indexOf(':'))))));
