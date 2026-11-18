import { pipelineFolders, type AadOSState, type Pipeline } from './aados-store';
import { liveZohoFolder, liveZohoUnread, searchZoho, syncPipeline } from './zoho';
import { liveGmailLabel, searchGmail, syncGmailPipeline } from './gmail';

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

export type LiveScope = { account?: string; folder?: string; pipeline?: string; /** search text: also searched in the mailboxes themselves */ q?: string };
type LiveTarget = { pipeline: Pipeline; accountId: string; folderId: string };

/**
 * The folders on screen, and only those (never every view): a view → its folders; an account folder →
 * every view that holds that folder; an account → its inbox; nothing → every account's inbox.
 * Accounts paused for auto sync are skipped.
 */
export function liveTargets(state: AadOSState, scope: LiveScope, allowed?: Set<string>): LiveTarget[] {
  const live = (id: string) => (!allowed || allowed.has(id)) && state.accounts.some((account) => account.id === id && !account.paused);
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
  // A folder no view covers (e.g. Zoho "Shopping"): sync it into the account's inbox feed, tagged with its folder.
  if (!out.size && scope.account && scope.folder && live(scope.account)) {
    const inbox = state.pipelines.find((p) => p.system && p.accountId === scope.account);
    if (inbox) out.set('adhoc', { pipeline: inbox, accountId: scope.account, folderId: scope.folder });
  }
  return [...out.values()];
}

/** Live sync of the folders on screen (newest page + changes since last time). Records per-account health. */
export async function syncLive(state: AadOSState, scope: LiveScope, allowed?: Set<string>) {
  let added = 0, removed = 0, failed = 0;
  for (const target of liveTargets(state, scope, allowed)) {
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
  // Searching: ask the mailboxes too (old mail AadOS never stored), and store the matches so the list shows them.
  const q = (scope.q || '').trim();
  if (q.length >= 2) {
    for (const account of state.accounts.filter((a) => !a.paused && (!allowed || allowed.has(a.id)) && (!scope.account || scope.account === a.id))) {
      const inbox = state.pipelines.find((p) => p.system && p.accountId === account.id);
      if (!inbox) continue;
      try { added += (account.provider === 'gmail' ? await searchGmail(state, account, inbox, q) : await searchZoho(state, account, inbox, q)).added; } catch { failed++; }
    }
  }
  // Unread views (all inboxes, or one account) also pick up unread mail in every Zoho folder, not only Inbox.
  if (!scope.folder && !scope.pipeline && !q) {
    for (const account of state.accounts.filter((a) => a.provider === 'zoho' && !a.paused && (!allowed || allowed.has(a.id)) && (!scope.account || scope.account === a.id))) {
      const inbox = state.pipelines.find((p) => p.system && p.accountId === account.id);
      if (!inbox) continue;
      try { added += (await liveZohoUnread(state, account, inbox)).added; } catch (cause) { failed++; account.lastError = cause instanceof Error ? cause.message : 'Unread sync failed'; }
    }
  }
  return { added, removed, failed };
}
