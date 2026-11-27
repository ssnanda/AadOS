// Gmail/Zoho connects started from the mobile app. Google refuses sign-in inside an embedded web view, so the app opens
// the consent page in the system's in-app browser (SFSafariViewController / Custom Tab), which has no AadOS cookie.
// The callback therefore cannot land on /settings: it shows a small "return to the app" page instead, and records the
// outcome here so the app (polling /settings/app?oauth=<state>) can close the browser and refresh.
// In memory on purpose: one replica, flows live 10 minutes (FLOW_TTL_MS); a restart only costs the app its auto-close.

export type MobileFlow = { done: boolean; ok: boolean; message: string; at: number };

const TTL_MS = 15 * 60 * 1000;
const MAX = 20;
const flows = new Map<string, MobileFlow>();

function prune(now = Date.now()) {
  for (const [k, v] of flows) if (now - v.at > TTL_MS) flows.delete(k);
  while (flows.size >= MAX) flows.delete(flows.keys().next().value as string);
}

/** `state` from the provider URL the app is about to open. */
export function trackMobileFlow(state: string): void {
  if (!state) return;
  prune();
  flows.set(state, { done: false, ok: false, message: '', at: Date.now() });
}

export function mobileFlowStatus(state: string): MobileFlow | null {
  prune();
  return flows.get(state) ?? null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** For a callback: when `state` belongs to an app flow, record the outcome and answer with the landing page; else null. */
export function mobileOutcome(state: string, ok: boolean, message: string): Response | null {
  const f = state ? flows.get(state) : undefined;
  if (!f) return null;
  flows.set(state, { done: true, ok, message, at: Date.now() });
  const title = ok ? 'Connected' : 'Connection failed';
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;color:#29344c;padding:48px 24px;text-align:center"><div style="font-size:44px">${ok ? '✓' : '⚠'}</div><h2 style="margin:8px 0">${esc(title)}</h2><p style="color:#5b6a86">${esc(message)}</p><p style="color:#8a95a8;font-size:14px">Return to the AadOS app.${ok ? '' : ' You can try again from Settings there.'}</p></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
