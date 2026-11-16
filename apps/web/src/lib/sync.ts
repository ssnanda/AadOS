/** Start the background full sync (all views, or just `ids`). Progress shows in <SyncProgress>. */
export async function startFullSync(ids?: string[]): Promise<boolean> {
  const response = await fetch('/sync/full', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
  window.dispatchEvent(new Event('aados:fullsync'));
  return response.ok;
}

/** Delete every stored email, then re-fetch everything with a full sync. Asks first. */
export async function purgeAndSync(): Promise<boolean> {
  if (!confirm('Purge all stored emails and re-sync everything from the mailboxes?')) return false;
  const response = await fetch('/sync/purge', { method: 'POST' });
  window.dispatchEvent(new Event('aados:fullsync'));
  return response.ok;
}
