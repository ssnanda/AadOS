import { pipelineFolders, type AadOSState, type Pipeline } from './aados-store';
import { syncPipeline } from './zoho';
import { syncGmailPipeline } from './gmail';

/** Sync every folder of a view, across all of its accounts and providers; records account health. */
export async function syncView(state: AadOSState, pipeline: Pipeline) {
  const accounts = [...new Set(pipelineFolders(pipeline).map((folder) => folder.accountId))].map((id) => state.accounts.find((account) => account.id === id)).filter((account) => account !== undefined);
  try {
    const zoho = await syncPipeline(state, pipeline);
    const gmail = await syncGmailPipeline(state, pipeline);
    for (const account of accounts) { account.lastSync = new Date().toISOString(); account.lastError = ''; }
    return { scanned: zoho.scanned + gmail.scanned, added: zoho.added + gmail.added };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Sync failed';
    for (const account of accounts) account.lastError = message;
    throw cause;
  }
}
