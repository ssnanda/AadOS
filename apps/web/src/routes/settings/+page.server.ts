import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { updateState } from '$lib/server/aados-store';
import { validZone } from '$lib/calendar/model';
import { isTime } from '$lib/server/tasks';
import { tick } from '$lib/server/reminders';
import { env } from '$env/dynamic/private';
import { readState } from '$lib/server/aados-store';
import { buildRows } from '$lib/server/inbox';
import { compareCounts, dbReadMode, fetchDbCounts, type Comparison } from '$lib/server/db-compare';

// Legacy state stays authoritative. In `compare` mode we also read the PostgreSQL mirror and report differences.
export const load: PageServerLoad = async () => {
  const mode = dbReadMode(env.AADOS_DB_READ);
  const prefs = (await readState()).prefs;
  if (mode === 'off') return { prefs, db: { mode, error: '', comparison: null as Comparison | null } };
  try {
    const state = await readState();
    const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
    const perAccount: Record<string, number> = {};
    for (const r of rows) perAccount[r.accountId] = (perAccount[r.accountId] || 0) + 1;
    const legacy = { accounts: state.accounts.length, messages: rows.length, unread: rows.filter((r) => r.unread).length, tasks: state.tasks.length, perAccount };
    const db = await fetchDbCounts(fetch, env.AADOS_API_URL || '', env.AADOS_INTERNAL_API_TOKEN || '');
    return { prefs, db: { mode, error: '', comparison: compareCounts(legacy, db) } };
  } catch (cause) {
    return { prefs, db: { mode, error: cause instanceof Error ? cause.message : 'Comparison failed', comparison: null as Comparison | null } };
  }
};

export const actions: Actions = {
  prefs: async ({ request }) => {
    const f = await request.formData();
    const timeZone = String(f.get('timeZone') || '').trim();
    const lead = String(f.get('eventLead') || '');
    const taskTime = String(f.get('taskReminderTime') || '');
    if (!validZone(timeZone)) return fail(400, { error: 'Unknown time zone (use an IANA name such as America/New_York).' });
    if (taskTime && !isTime(taskTime)) return fail(400, { error: 'Invalid task reminder time.' });
    const minutes = lead === 'off' ? null : Number(lead);
    if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 0 && minutes <= 7 * 24 * 60)) return fail(400, { error: 'Invalid event lead time.' });
    await updateState((s) => { s.prefs = { ...s.prefs, timeZone, eventLeadMinutes: minutes, taskReminderTime: taskTime, weekStart: f.get('weekStart') === '1' ? 1 : 0 }; tick(s); });
    return { saved: true };
  }
};
