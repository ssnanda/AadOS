import { updateState } from './aados-store';
import { syncPipeline } from './zoho';

declare global { var __aadosPipelineScheduler: ReturnType<typeof setInterval> | undefined; }

async function pass() {
  await updateState(async (state) => {
    if (!state.zoho.refreshToken || !state.zoho.accountId) return;
    for (const pipeline of state.pipelines.filter((item) => item.enabled)) {
      try { await syncPipeline(state, pipeline); }
      catch (cause) { pipeline.lastError = cause instanceof Error ? cause.message : 'Sync failed'; }
    }
  });
}

export function startPipelineScheduler() {
  if (globalThis.__aadosPipelineScheduler) return;
  globalThis.__aadosPipelineScheduler = setInterval(() => { void pass(); }, 60 * 60 * 1000);
  globalThis.__aadosPipelineScheduler.unref();
}
