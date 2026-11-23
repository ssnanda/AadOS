import { scopeState } from '$lib/server/scope';
import { unreadBadge, bbConfigured } from '$lib/server/bluebubbles';
import type { LayoutServerLoad } from './$types';
import { readState, visiblePipelines } from '$lib/server/aados-store';
import { isUnread } from '$lib/server/search';
import { accountFolders } from '$lib/server/email-list';
import { localCounts, remoteCounts } from '$lib/server/nav-counts';

// Sidebar data (views + unread counts). Nothing is read unless signed in.
export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.authenticated) return { shell: { accounts: [], views: [], timeZone: '' }, navCounts: null };
  const state = scopeState(await readState(), locals.user);
  // Unread per account + folders for the Emails sub-menu (shared with the mobile app's folder drawer).
  const accounts = accountFolders(state);
  // Badges for the sections above Emails: local counts now, Asana/Finance/Documents streamed (cached 2 min).
  const counts = localCounts(state, locals.user);
  return { navCounts: remoteCounts(state, locals.user).catch(() => null), shell: { counts, messages: bbConfigured(state) ? unreadBadge() : -1, user: locals.user ? { name: locals.user.name, owner: locals.user.owner, permissions: locals.user.permissions, ownAccounts: locals.user.ownAccounts } : null, accounts, timeZone: state.prefs.timeZone, views: visiblePipelines(state).map((p) => ({ id: p.id, name: p.name, parser: p.parser, count: state.items.filter((i) => i.pipelineId === p.id && isUnread(i)).length, total: state.items.filter((i) => i.pipelineId === p.id).length })) } };
};
