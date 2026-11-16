import { pipelineFolders, type AadOSState, type Pipeline } from './aados-store';
import { syncPipeline } from './zoho';
import { syncGmailPipeline } from './gmail';

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
