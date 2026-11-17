import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import * as asana from '$lib/server/asana';
import { dayIn } from '$lib/asana-model';

// Live from Asana on every load (nothing is mirrored): my incomplete tasks, My Tasks sections, projects.
export const load: PageServerLoad = async () => {
  const state = await readState();
  const tz = state.prefs.timeZone || 'UTC';
  const base = { today: dayIn(new Date(), tz), timeZone: tz, dashboardDueOnly: Boolean(state.prefs.asanaDashboardDueOnly), aiAvailable: state.ai.enabled };
  if (!asana.connectedState(state)) return { ...base, connected: false as const };
  const a = state.integrations.asana;
  try {
    const c = await asana.connection();
    const [tasks, sections, projects] = await Promise.all([asana.myTasks(c), asana.mySections(c), asana.projects(c).catch(() => [])]);
    return { ...base, connected: true as const, workspace: a.workspaceName, user: a.userName, tasks, sections, projects, timers: state.asanaTimers || {}, error: '' };
  } catch (e) {
    return { ...base, connected: true as const, workspace: a.workspaceName, user: a.userName, tasks: [], sections: [], projects: [], timers: state.asanaTimers || {}, error: e instanceof Error ? e.message : 'Could not reach Asana.' };
  }
};
