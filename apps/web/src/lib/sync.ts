// Mail syncs automatically, the way a mail client refreshes the folder on screen: when it is opened,
// when the tab becomes visible again, and every AUTO_SYNC_MS while it stays visible. No sync buttons.
export type LiveScope = { account?: string; folder?: string; pipeline?: string; q?: string; force?: boolean };
const AUTO_SYNC_MS = 120_000;

/** Sync what is on screen now. True when the stored mail changed (the page should reload its data). */
export async function liveSync(scope: LiveScope, endpoint = '/sync/live'): Promise<boolean> {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scope) });
    return Boolean((await response.json().catch(() => ({}))).changed);
  } catch { return false; }
}

/** Browser only (call from onMount). `run()` syncs now (e.g. after switching folder); `stop()` on unmount. */
export function startAutoSync(scope: () => LiveScope, onChange: () => unknown, endpoint = '/sync/live', onBusy?: (busy: boolean) => void) {
  let busy = false, again = false;
  // A folder click while a sync is running is not dropped: it runs right after, for the folder now on screen.
  const run = async (): Promise<void> => {
    if (document.visibilityState !== 'visible') return;
    if (busy) { again = true; return; }
    busy = true; onBusy?.(true);
    try { if (await liveSync(scope(), endpoint)) await onChange(); } finally { busy = false; onBusy?.(false); }
    if (again) { again = false; return run(); }
  };
  const timer = setInterval(run, AUTO_SYNC_MS);
  const visible = () => { if (document.visibilityState === 'visible') void run(); };
  document.addEventListener('visibilitychange', visible);
  return { run, stop: () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); } };
}

/** Delete every stored email in AadOS (the mailboxes are not touched). Asks first. Open folders refill on their own. */
export async function purgeEmails(): Promise<boolean> {
  if (!confirm('Purge emails?\n\nThis clears the email copies stored in AadOS. Your Gmail and Zoho mailboxes are NOT changed, and open folders re-sync automatically.\nMessages, calendar and finance are not affected.')) return false;
  const response = await fetch('/sync/purge', { method: 'POST' });
  return response.ok;
}
