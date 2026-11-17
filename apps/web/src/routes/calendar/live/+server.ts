import { json } from '@sveltejs/kit';
import { updateStateDetached } from '$lib/server/aados-store';
import { syncCalendars } from '$lib/server/calendar-sync';

// Automatic calendar sync (the calendar page calls this on open and every 2 minutes while visible), like email:
// no Sync button. Google is incremental (sync tokens); Zoho re-reads its window. Same request within MIN_GAP_MS is skipped.
declare global { var __aadosCalLast: number | undefined; var __aadosCalRunning: boolean | undefined; }
const MIN_GAP_MS = 60_000;

export const POST = async () => {
  if (globalThis.__aadosCalRunning || Date.now() - (globalThis.__aadosCalLast || 0) < MIN_GAP_MS) return json({ changed: false, skipped: true });
  globalThis.__aadosCalRunning = true; globalThis.__aadosCalLast = Date.now();
  let changed = false;
  try {
    await updateStateDetached(async (state) => {
      const before = JSON.stringify([state.events.length, state.events.map((e) => e.id + e.start + e.end + e.title).join('|'), state.accounts.map((a) => a.calendarError || '')]);
      await syncCalendars(state);
      changed = JSON.stringify([state.events.length, state.events.map((e) => e.id + e.start + e.end + e.title).join('|'), state.accounts.map((a) => a.calendarError || '')]) !== before;
    });
  } finally { globalThis.__aadosCalRunning = false; }
  return json({ changed });
};
