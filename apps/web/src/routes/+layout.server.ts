import { scopeState } from '$lib/server/scope';
import { unreadBadge, bbConfigured } from '$lib/server/bluebubbles';
import type { LayoutServerLoad } from './$types';
import { readState, visiblePipelines } from '$lib/server/aados-store';
import { isUnread } from '$lib/server/search';
import { accountFolders } from '$lib/server/email-list';

// Sidebar data (views + unread counts). Nothing is read unless signed in.
export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.authenticated) return { shell: { accounts: [], views: [], notifications: 0, timeZone: '', notifyBrowser: false } };
  const state = scopeState(await readState(), locals.user);
  // Unread per account + folders for the Emails sub-menu (shared with the mobile app's folder drawer).
  const accounts = accountFolders(state);
  return { shell: { messages: bbConfigured(state) ? unreadBadge() : -1, user: locals.user ? { name: locals.user.name, owner: locals.user.owner, permissions: locals.user.permissions, ownAccounts: locals.user.ownAccounts } : null, accounts, notifyBrowser: state.notify.browser, notifications: state.reminders.filter((r) => r.status === 'fired' && !r.readAt).length, timeZone: state.prefs.timeZone, views: visiblePipelines(state).map((p) => ({ id: p.id, name: p.name, parser: p.parser, count: state.items.filter((i) => i.pipelineId === p.id && isUnread(i)).length, total: state.items.filter((i) => i.pipelineId === p.id).length })) } };
};
