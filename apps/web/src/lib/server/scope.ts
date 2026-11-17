// What a signed-in family member may see of the mail data: only the mailboxes the owner allowed (none without the
// Emails permission). The owner sees everything. Read-side filter; write endpoints check keys with `keyAllowed`.
import { can, canSeeAccount, type SessionUser } from './auth';
import { pipelineFolders, type AadOSState } from './aados-store';

export function scopeState(state: AadOSState, user: SessionUser | null | undefined): AadOSState {
  if (user?.owner) return state;
  if (!user || !can(user, 'emails')) return { ...state, accounts: [], items: [], pipelines: [] };
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
export const keyAllowed = (user: SessionUser | null | undefined, key: string) => Boolean(user && (user.owner || (can(user, 'emails') && canSeeAccount(user, key.slice(0, key.indexOf(':'))))));
