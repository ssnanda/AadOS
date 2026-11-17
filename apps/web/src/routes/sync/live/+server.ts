import { json } from '@sveltejs/kit';
import { updateStateDetached, type AadOSState } from '$lib/server/aados-store';
import { syncLive } from '$lib/server/pipeline-sync';
import { syncJob } from '$lib/server/sync-job';

// Automatic sync of what is on screen (called by the page on open and every 2 minutes while visible),
// like a mail client refreshing the open folder. Same scope within MIN_GAP_MS is answered from memory.
declare global { var __aadosLiveLast: Map<string, number> | undefined; var __aadosLiveRunning: Set<string> | undefined; }
const MIN_GAP_MS = 30_000;
// Cheap "did anything visible change": message count, unread count, account errors.
const fingerprint = (state: AadOSState) => `${state.items.length}:${state.items.filter((item) => item.unread !== false).length}:${state.accounts.map((a) => a.lastError || '').join('|')}`;

export const POST = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const scope = { account: String(body.account || ''), folder: String(body.folder || ''), pipeline: String(body.pipeline || '') };
  if (globalThis.__aadosSyncRunning || syncJob().running) return json({ changed: false, skipped: 'busy' });
  const key = `${scope.account}|${scope.folder}|${scope.pipeline}`;
  const last = (globalThis.__aadosLiveLast ??= new Map()), running = (globalThis.__aadosLiveRunning ??= new Set());
  if (running.has(key) || Date.now() - (last.get(key) || 0) < MIN_GAP_MS) return json({ changed: false, skipped: 'recent' });
  running.add(key); last.set(key, Date.now());
  let result = { added: 0, removed: 0, failed: 0 }, changed = false;
  try {
    await updateStateDetached(async (state) => {
      const before = fingerprint(state);
      result = await syncLive(state, scope);
      changed = fingerprint(state) !== before;
    });
  }
  catch (cause) { return json({ changed: false, error: cause instanceof Error ? cause.message : 'Sync failed' }, { status: 502 }); }
  finally { running.delete(key); }
  return json({ ...result, changed });
};
