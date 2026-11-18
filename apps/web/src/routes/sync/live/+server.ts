import { json } from '@sveltejs/kit';
import { readState, updateStateDetached, type AadOSState } from '$lib/server/aados-store';
import { syncLive } from '$lib/server/pipeline-sync';
import { syncJob } from '$lib/server/sync-job';
import { scopeState } from '$lib/server/scope';

// Automatic sync of what is on screen (called by the page on open and every 2 minutes while visible),
// like a mail client refreshing the open folder. Same scope within MIN_GAP_MS is answered from memory.
declare global { var __aadosLiveLast: Map<string, number> | undefined; var __aadosLiveRunning: Set<string> | undefined; }
// Short enough that a folder click or page reload always refreshes; only double-fires are absorbed.
const MIN_GAP_MS = 5_000;
// Cheap "did anything visible change": message count, unread count, account errors.
const fingerprint = (state: AadOSState) => `${state.items.length}:${state.items.filter((item) => item.unread !== false).length}:${state.accounts.map((a) => `${a.lastError || ''}~${(a.folders || []).map((f) => f.unread ?? '').join(',')}`).join('|')}`;

export const POST = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const scope = { account: String(body.account || ''), folder: String(body.folder || ''), pipeline: String(body.pipeline || ''), q: String(body.q || '').slice(0, 200) };
  // Only mailboxes this user can see are refreshed (the owner's, a member's shared + own).
  const allowed = new Set(scopeState(await readState(), locals.user).accounts.map((a) => a.id));
  // Only a full mail sync blocks this. The 15-minute background pass no longer touches mail (calendars, finance, Asana),
  // so it must not stop the open folder from refreshing.
  if (syncJob().running) return json({ changed: false, skipped: 'busy' });
  const key = `${scope.account}|${scope.folder}|${scope.pipeline}|${scope.q}`;
  const last = (globalThis.__aadosLiveLast ??= new Map()), running = (globalThis.__aadosLiveRunning ??= new Set());
  if (running.has(key) || Date.now() - (last.get(key) || 0) < MIN_GAP_MS) return json({ changed: false, skipped: 'recent' });
  running.add(key); last.set(key, Date.now());
  let result = { added: 0, removed: 0, failed: 0 }, changed = false;
  try {
    await updateStateDetached(async (state) => {
      const before = fingerprint(state);
      result = await syncLive(state, scope, allowed);
      changed = fingerprint(state) !== before;
    });
  }
  catch (cause) { return json({ changed: false, error: cause instanceof Error ? cause.message : 'Sync failed' }, { status: 502 }); }
  finally { running.delete(key); }
  return json({ ...result, changed });
};
