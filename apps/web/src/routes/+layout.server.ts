import { scopeState } from '$lib/server/scope';
import { unreadBadge, bbConfigured } from '$lib/server/bluebubbles';
import type { LayoutServerLoad } from './$types';
import { readState, visiblePipelines } from '$lib/server/aados-store';
import { isUnread } from '$lib/server/search';
import { folderSummary } from '$lib/server/inbox';

// Sidebar data (views + unread counts). Nothing is read unless signed in.
export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.authenticated) return { shell: { accounts: [], views: [], notifications: 0, timeZone: '', notifyBrowser: false } };
  const state = scopeState(await readState(), locals.user);
  // Unread per account for the Emails sub-menu (one pass; a message in several views counts once).
  const ownerOf = new Map(state.pipelines.map((p) => [p.id, p.accountId]));
  const unreadKeys = new Map<string, Set<string>>();
  for (const i of state.items) if (isUnread(i)) { const a = i.accountId || ownerOf.get(i.pipelineId) || ''; let set = unreadKeys.get(a); if (!set) unreadKeys.set(a, (set = new Set())); set.add(i.messageId); }
  const folders = folderSummary(state);
  // Every folder/label of the account (not only ones with stored mail): stored counts, or the provider's unread count when higher.
  const SKIP = /^(trash|spam|junk|drafts|outbox|templates)$/i;
  const accounts = state.accounts.filter((a) => !a.paused).map((a) => {
    const stored = new Map((folders[a.id] || []).map((f) => [f.id, f]));
    const list = (a.folders || []).filter((f) => !SKIP.test(f.type || '') && !SKIP.test(f.name)).map((f) => { const s = stored.get(f.id); return { id: f.id, name: f.path && f.path !== '/' ? f.path.replace(/^\//, '') : f.name, total: s?.total || 0, unread: Math.max(s?.unread || 0, f.unread || 0) }; });
    for (const s of stored.values()) if (!list.some((f) => f.id === s.id)) list.push(s);
    list.sort((x, y) => (x.name.toLowerCase() === 'inbox' ? -1 : y.name.toLowerCase() === 'inbox' ? 1 : x.name.localeCompare(y.name)));
    return { id: a.id, provider: a.provider, email: a.email || a.id, unread: unreadKeys.get(a.id)?.size || 0, folders: list };
  });
  return { shell: { messages: bbConfigured(state) ? unreadBadge() : -1, user: locals.user ? { name: locals.user.name, owner: locals.user.owner, permissions: locals.user.permissions, ownAccounts: locals.user.ownAccounts } : null, accounts, notifyBrowser: state.notify.browser, notifications: state.reminders.filter((r) => r.status === 'fired' && !r.readAt).length, timeZone: state.prefs.timeZone, views: visiblePipelines(state).map((p) => ({ id: p.id, name: p.name, parser: p.parser, count: state.items.filter((i) => i.pipelineId === p.id && isUnread(i)).length, total: state.items.filter((i) => i.pipelineId === p.id).length })) } };
};
