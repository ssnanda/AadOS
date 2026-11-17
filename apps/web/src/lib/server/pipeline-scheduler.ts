import os from 'node:os';
import { ensureInboxPipelines, updateState, updateStateDetached } from './aados-store';
import { syncCalendars } from './calendar-sync';
import { syncJob } from './sync-job';
import { hasDatabase } from './aados-store';
import { financeTick } from './finance/refresh';

declare global { var __aadosPipelineScheduler: ReturnType<typeof setInterval> | undefined; var __aadosSyncRunning: boolean | undefined; }

// Tunables (env): interval in minutes, max 1-minute load per CPU, min free-memory fraction.
const num = (value: string | undefined, fallback: number) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; };
const INTERVAL_MS = num(process.env.AADOS_SYNC_INTERVAL_MIN, 15) * 60 * 1000;
const MAX_LOAD_PER_CPU = num(process.env.AADOS_SYNC_MAX_LOAD, 0.8);
const MIN_FREE_MEMORY = num(process.env.AADOS_SYNC_MIN_FREE_MEM, 0.1);

/** Returns why a scheduled sync should be skipped, or '' when the machine is calm. */
export function busyReason(): string {
  const cpus = os.availableParallelism?.() || os.cpus().length || 1;
  const load = os.loadavg()[0] / cpus;
  if (load > MAX_LOAD_PER_CPU) return `CPU load ${load.toFixed(2)} per core`;
  // Inside a container prefer the cgroup limit over host memory.
  const limit = process.constrainedMemory?.() || 0;
  if (limit > 0 && limit < os.totalmem()) {
    const used = process.memoryUsage().rss / limit;
    if (used > 1 - MIN_FREE_MEMORY) return `memory ${(used * 100).toFixed(0)}% of container limit`;
  } else if (os.freemem() / os.totalmem() < MIN_FREE_MEMORY) return `free memory ${(os.freemem() / os.totalmem() * 100).toFixed(0)}%`;
  return '';
}

// Mail is no longer synced here: open folders sync themselves (see /sync/live), so a background walk of
// every view only competes with the page. This pass keeps calendars current.
async function pass() {
  if (globalThis.__aadosSyncRunning || syncJob().running) return;
  const busy = busyReason();
  if (busy) { console.log(`[aados] scheduled sync skipped: ${busy}`); return; }
  globalThis.__aadosSyncRunning = true;
  try {
    await updateState((state) => { ensureInboxPipelines(state); });
    // Runs on a snapshot, so provider network calls never block other writes.
    await updateStateDetached(async (state) => { await syncCalendars(state); }); // read-only; per-account errors are recorded on the account
    // Finance: prices every pass during market hours, otherwise twice a day; snapshots + alerts follow each refresh.
    if (hasDatabase()) await financeTick().catch((e) => console.warn('[aados] finance refresh failed:', e instanceof Error ? e.message : e));
  } finally { globalThis.__aadosSyncRunning = false; }
}

export function startPipelineScheduler() {
  if (globalThis.__aadosPipelineScheduler) return;
  globalThis.__aadosPipelineScheduler = setInterval(() => { void pass(); }, INTERVAL_MS);
  globalThis.__aadosPipelineScheduler.unref();
}
