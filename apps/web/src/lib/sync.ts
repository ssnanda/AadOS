// Mail syncs automatically, the way a mail client refreshes the folder on screen: when it is opened,
// when the tab becomes visible again, and every AUTO_SYNC_MS while it stays visible. No sync buttons.
export type LiveScope = { account?: string; folder?: string; pipeline?: string };
const AUTO_SYNC_MS = 120_000;

/** Sync what is on screen now. True when the stored mail changed (the page should reload its data). */
export async function liveSync(scope: LiveScope, endpoint = '/sync/live'): Promise<boolean> {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scope) });
    return Boolean((await response.json().catch(() => ({}))).changed);
  } catch { return false; }
}

/** Browser only (call from onMount). `run()` syncs now (e.g. after switching folder); `stop()` on unmount. */
export function startAutoSync(scope: () => LiveScope, onChange: () => unknown, endpoint = '/sync/live') {
  let busy = false;
  const run = async () => {
    if (busy || document.visibilityState !== 'visible') return;
    busy = true;
    try { if (await liveSync(scope(), endpoint)) await onChange(); } finally { busy = false; }
  };
  const timer = setInterval(run, AUTO_SYNC_MS);
  const visible = () => { if (document.visibilityState === 'visible') void run(); };
  document.addEventListener('visibilitychange', visible);
  return { run, stop: () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); } };
}

/** Delete every stored email in AadOS (the mailboxes are not touched). Asks first. Open folders refill on their own. */
export async function purgeEmails(): Promise<boolean> {
  if (!confirm('Purge all emails stored in AadOS? Your mailboxes are not changed; open folders re-sync automatically.')) return false;
  const response = await fetch('/sync/purge', { method: 'POST' });
  return response.ok;
}
