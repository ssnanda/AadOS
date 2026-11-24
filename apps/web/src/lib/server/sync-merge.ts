// Merge the result of a network sync (run on a snapshot, outside the state lock) into the latest state.
// Pure (type-only imports) so it is unit-tested with `node --test`.
import type { AadOSState } from './aados-store';

const ACCOUNT_FIELDS = ['accessToken', 'refreshToken', 'expiresAt', 'folders', 'lastSync', 'lastError', 'unreadCheckedAt', 'email', 'remoteId', 'historyIds', 'canModify', 'canSend', 'canFilter', 'calendar', 'calendarWrite', 'contacts', 'calendarLastSync', 'calendarError'] as const;
const PIPELINE_FIELDS = ['cursor', 'lastSync', 'lastError'] as const;
const ITEM_FIELDS = ['unread', 'folderId', 'accountId', 'threadId', 'to'] as const;

/**
 * Apply only what the sync changed (`before` -> `after`) onto `latest`, so edits made meanwhile
 * (marking reviewed, deleting, new accounts) are never overwritten. Dismissed ids are respected.
 */
export function mergeSync(latest: AadOSState, before: AadOSState, after: AadOSState): void {
  const beforeIds = new Set(before.items.map((item) => item.id));
  const beforeById = new Map(before.items.map((item) => [item.id, item]));
  const latestById = new Map(latest.items.map((item) => [item.id, item]));
  const dismissed = new Set(latest.dismissed);
  // Copies the sync removed (they left the folder in the mailbox) are removed from the latest state too.
  const afterIds = new Set(after.items.map((item) => item.id));
  const removed = new Set(before.items.filter((item) => !afterIds.has(item.id)).map((item) => item.id));
  if (removed.size) { latest.items = latest.items.filter((item) => !removed.has(item.id)); for (const id of removed) latestById.delete(id); }
  for (const item of after.items) {
    if (!beforeIds.has(item.id)) {
      if (!latestById.has(item.id) && !dismissed.has(item.id)) { latest.items.push(item); latestById.set(item.id, item); }
      continue;
    }
    const target = latestById.get(item.id), old = beforeById.get(item.id);
    if (!target || !old) continue;
    for (const field of ITEM_FIELDS) if (item[field] !== old[field]) (target as Record<string, unknown>)[field] = item[field];
  }
  for (const account of after.accounts) {
    const target = latest.accounts.find((a) => a.id === account.id), old = before.accounts.find((a) => a.id === account.id);
    if (!target || !old) continue;
    for (const field of ACCOUNT_FIELDS) if (JSON.stringify(account[field]) !== JSON.stringify(old[field])) (target as Record<string, unknown>)[field] = account[field];
  }
  // Calendar data is written only by calendar syncs, so take their result as a whole.
  for (const key of ['calendars', 'events', 'calendarSync'] as const) // calendarDisabled/reminders/prefs are user-edited: never taken from a sync snapshot
  if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) (latest as Record<string, unknown>)[key] = after[key];
  for (const pipeline of after.pipelines) {
    const target = latest.pipelines.find((p) => p.id === pipeline.id), old = before.pipelines.find((p) => p.id === pipeline.id);
    if (!target || !old) continue;
    for (const field of PIPELINE_FIELDS) if (pipeline[field] !== old[field]) (target as Record<string, unknown>)[field] = pipeline[field];
  }
}
