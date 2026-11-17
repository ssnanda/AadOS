import { pipelineFolders, type AadOSState, type Pipeline } from './aados-store';
import { liveZohoFolder, syncPipeline } from './zoho';
import { liveGmailLabel, syncGmailPipeline } from './gmail';

/**
 * Sync the folders of a view across its accounts and providers; records per-account health.
 * `accountId` limits the run to one account; `scheduled` skips accounts paused for auto-sync.
 */
export async function syncView(state: AadOSState, pipeline: Pipeline, options: { accountId?: string; scheduled?: boolean } = {}) {
  const only = (id: string) => (!options.accountId || id === options.accountId) && !(options.scheduled && state.accounts.find((account) => account.id === id)?.paused);
  const accounts = [...new Set(pipelineFolders(pipeline).map((folder) => folder.accountId))].filter(only).map((id) => state.accounts.find((account) => account.id === id)).filter((account) => account !== undefined);
  try {
    const zoho = await syncPipeline(state, pipeline, only);
    const gmail = await syncGmailPipeline(state, pipeline, only);
    for (const account of accounts) { account.lastSync = new Date().toISOString(); account.lastError = ''; }
    return { scanned: zoho.scanned + gmail.scanned, added: zoho.added + gmail.added };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Sync failed';
    for (const account of accounts) account.lastError = message;
    throw cause;
  }
}

export type LiveScope = { account?: string; folder?: string; pipeline?: string };
type LiveTarget = { pipeline: Pipeline; accountId: string; folderId: string };

/**
 * The folders on screen, and only those (never every view): a view → its folders; an account folder →
 * every view that holds that folder; an account → its inbox; nothing → every account's inbox.
 * Accounts paused for auto sync are skipped.
 */
export function liveTargets(state: AadOSState, scope: LiveScope): LiveTarget[] {
  const live = (id: string) => state.accounts.some((account) => account.id === id && !account.paused);
  const out = new Map<string, LiveTarget>();
  for (const pipeline of state.pipelines) {
    if (scope.pipeline ? pipeline.id !== scope.pipeline : !pipeline.enabled) continue;
    if (!scope.pipeline && !scope.folder && !pipeline.system) continue;
    for (const folder of pipelineFolders(pipeline)) {
      if (!folder.accountId || !live(folder.accountId)) continue;
      if (scope.account && folder.accountId !== scope.account) continue;
      if (scope.folder && folder.id !== scope.folder) continue;
      out.set(`${pipeline.id}\u0000${folder.accountId}\u0000${folder.id}`, { pipeline, accountId: folder.accountId, folderId: folder.id });
    }
  }
  return [...out.values()];
}

/** Live sync of the folders on screen (newest page + changes since last time). Records per-account health. */
export async function syncLive(state: AadOSState, scope: LiveScope) {
  let added = 0, removed = 0, failed = 0;
  for (const target of liveTargets(state, scope)) {
    const account = state.accounts.find((item) => item.id === target.accountId);
    if (!account) continue;
    try {
      const result = account.provider === 'gmail'
        ? await liveGmailLabel(state, account, target.pipeline, target.folderId)
        : await liveZohoFolder(state, account, target.pipeline, target.folderId);
      added += result.added; removed += result.removed;
      account.lastSync = target.pipeline.lastSync = new Date().toISOString();
      account.lastError = target.pipeline.lastError = '';
    } catch (cause) {
      failed++;
      account.lastError = cause instanceof Error ? cause.message : 'Sync failed';
    }
  }
  return { added, removed, failed };
}
