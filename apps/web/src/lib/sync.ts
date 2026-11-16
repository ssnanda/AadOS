/** Start the background full sync (all views, or just `ids`). Progress shows in <SyncProgress>. */
export async function startFullSync(ids?: string[]): Promise<boolean> {
  const response = await fetch('/sync/full', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
  window.dispatchEvent(new Event('aados:fullsync'));
  return response.ok;
}
