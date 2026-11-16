import { readState, updateState, type PageResult } from './aados-store';
import { reconcileZohoUnread, syncZohoPage } from './zoho';
import { reconcileGmailUnread, syncGmailPage } from './gmail';

// Full sync: walks every page of every folder/label of the chosen views in the background.
// It is not tied to an HTTP request, so there is no request timeout, and each page is saved
// as it completes. Interrupted or failed runs resume cheaply: known mail is skipped.
export type SyncJob = { running: boolean; cancel: boolean; stopped: boolean; current: string; scanned: number; added: number; done: number; total: number; startedAt: string; finishedAt: string; error: string };
declare global { var __aadosFullSync: SyncJob | undefined; }

const idle = (): SyncJob => ({ running: false, cancel: false, stopped: false, current: '', scanned: 0, added: 0, done: 0, total: 0, startedAt: '', finishedAt: '', error: '' });
export const syncJob = (): SyncJob => (globalThis.__aadosFullSync ??= idle());
export const cancelFullSync = () => { syncJob().cancel = true; };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function startFullSync(ids: string[]): boolean {
  const job = syncJob();
  if (job.running) return false;
  Object.assign(job, idle(), { running: true, startedAt: new Date().toISOString(), total: ids.length });
  void run(job, ids);
  return true;
}

async function run(job: SyncJob, ids: string[]) {
  try {
    for (const id of ids) {
      if (job.cancel) break;
      const pipeline = (await readState()).pipelines.find((item) => item.id === id);
      if (!pipeline) { job.done++; continue; }
      job.current = pipeline.name;
      const folders = pipeline.folders?.length ? pipeline.folders : [{ id: pipeline.folderId, name: pipeline.folderName }];
      for (const folder of folders) {
        let cursor = '0';
        while (cursor && !job.cancel) {
          let result: PageResult | undefined;
          // Transient API errors (rate limits, network) are retried with a growing pause.
          for (let attempt = 0; ; attempt++) {
            try {
              await updateState(async (state) => {
                const current = state.pipelines.find((item) => item.id === id);
                if (!current) throw new Error('This view was removed.');
                const account = state.accounts.find((item) => item.id === current.accountId && item.provider === current.source);
                if (!account) throw new Error('The account for this view is no longer connected.');
                result = current.source === 'gmail' ? await syncGmailPage(state, account, current, folder.id, cursor) : await syncZohoPage(state, account, current, folder.id, cursor);
              });
              break;
            } catch (cause) {
              if (attempt >= 3) throw cause;
              await wait(2000 * (attempt + 1));
            }
          }
          if (!result) break;
          job.scanned += result.scanned; job.added += result.added; cursor = result.next;
          await wait(200);
        }
        // After the folder's last page, align read state with the mailbox's unread list.
        if (!job.cancel) await updateState(async (state) => {
          const current = state.pipelines.find((item) => item.id === id);
          const account = current && state.accounts.find((item) => item.id === current.accountId && item.provider === current.source);
          if (current && account) await (current.source === 'gmail' ? reconcileGmailUnread : reconcileZohoUnread)(state, account, current, folder.id);
        });
      }
      if (!job.cancel) await updateState((state) => { const current = state.pipelines.find((item) => item.id === id); if (current) { current.lastSync = new Date().toISOString(); current.lastError = ''; } });
      job.done++;
    }
  } catch (cause) {
    job.error = cause instanceof Error ? cause.message : 'Sync failed';
  } finally {
    job.stopped = job.cancel; job.cancel = false; job.running = false; job.finishedAt = new Date().toISOString();
  }
}
