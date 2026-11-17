import type { LayoutServerLoad } from './$types';
import { readState, visiblePipelines } from '$lib/server/aados-store';
import { isUnread } from '$lib/server/search';

// Sidebar data (views + unread counts). Nothing is read unless signed in.
export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.authenticated) return { shell: { views: [], notifications: 0, timeZone: '', notifyBrowser: false } };
  const state = await readState();
  return { shell: { notifyBrowser: state.notify.browser, notifications: state.reminders.filter((r) => r.status === 'fired' && !r.readAt).length, timeZone: state.prefs.timeZone, views: visiblePipelines(state).map((p) => ({ id: p.id, name: p.name, parser: p.parser, count: state.items.filter((i) => i.pipelineId === p.id && isUnread(i)).length })) } };
};
