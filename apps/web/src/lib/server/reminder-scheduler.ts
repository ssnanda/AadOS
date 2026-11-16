import { readState, updateState } from './aados-store';
import { tick } from './reminders';

declare global { var __aadosReminderTimer: ReturnType<typeof setInterval> | undefined; var __aadosReminderBusy: boolean | undefined; }
const INTERVAL_MS = 60_000;

/**
 * Server-side reminder scheduling. Each pass is idempotent and all state is durable (PostgreSQL / state file), so a
 * restart, a redeploy or a missed minute never loses or duplicates a reminder: the next pass simply catches up.
 * A cheap dry run on a copy decides whether a write is needed at all.
 */
export async function reminderPass(now = Date.now()): Promise<boolean> {
  const state = await readState();
  const probe = structuredClone({ reminders: state.reminders, tasks: state.tasks, events: state.events, prefs: state.prefs, calendarDisabled: state.calendarDisabled });
  if (!tick(probe, now)) return false;
  await updateState((latest) => { tick(latest, now); });
  return true;
}

export function startReminderScheduler() {
  if (globalThis.__aadosReminderTimer) return;
  const run = async () => {
    if (globalThis.__aadosReminderBusy) return;
    globalThis.__aadosReminderBusy = true;
    try { await reminderPass(); } catch (cause) { console.warn('[aados] reminder pass failed:', cause instanceof Error ? cause.message : cause); }
    finally { globalThis.__aadosReminderBusy = false; }
  };
  globalThis.__aadosReminderTimer = setInterval(run, INTERVAL_MS);
  globalThis.__aadosReminderTimer.unref?.();
  setTimeout(run, 5000).unref?.(); // catch up shortly after start-up
}
