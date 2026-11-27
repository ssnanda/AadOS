import { isActionFailure, isRedirect, json, type RequestEvent } from '@sveltejs/kit';
import * as general from '../+page.server';
import * as emails from '../emails/+page.server';
import * as family from '../family/+page.server';
import * as views from '../views/+page.server';
import * as messages from '../messages/+page.server';
import * as ai from '../ai/+page.server';
import * as storage from '../storage/+page.server';
import { SESSION_COOKIE, security } from '$lib/server/auth';
import { mobileFlowStatus, trackMobileFlow } from '$lib/server/oauth-mobile';

// Settings for the mobile app, as JSON. Each page's own `load` and form `actions` run unchanged, so the app and the web
// never drift (same validation, same messages). Owner-only like every /settings path (hooks → allowedPath).
//   GET  ?page=emails                → that page's load
//   GET  ?oauth=<state>              → outcome of a Gmail/Zoho connect the app started
//   POST {page, action, fields}      → that page's action; fields become its form data (true → "on", arrays repeat)
//   POST {page:'session', action:'revokeAll'} → sign out every device (the web's "Sign out everywhere")
// Answers: {ok, data} | {redirect} (provider consent page; the app opens it) | 4xx {error}. A changed session cookie
// (password change) comes back as {token} so the app stays signed in.
type Page = { load: (e: RequestEvent) => Promise<unknown>; actions: Record<string, (e: RequestEvent) => Promise<unknown>> };
const PAGES = { general, emails, family, views, messages, ai, storage } as unknown as Record<string, Page>;
const page = (name: string) => (Object.hasOwn(PAGES, name) ? PAGES[name] : null);
const noStore = { 'cache-control': 'no-store' };

export const GET = async (event: RequestEvent) => {
  const oauth = event.url.searchParams.get('oauth');
  if (oauth) return json(mobileFlowStatus(oauth) ?? { done: false, unknown: true }, { headers: noStore });
  const p = page(event.url.searchParams.get('page') || '');
  if (!p) return json({ error: 'Unknown settings page.' }, { status: 404 });
  return json(await p.load(event), { headers: noStore });
};

function formData(fields: unknown): FormData {
  const f = new FormData();
  if (!fields || typeof fields !== 'object') return f;
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item === null || item === undefined || item === false) continue;
      f.append(k, item === true ? 'on' : String(item));
    }
  }
  return f;
}

export const POST = async (event: RequestEvent) => {
  const body = await event.request.json().catch(() => ({}));
  const name = String(body?.page || ''), action = String(body?.action || '');
  if (name === 'session' && action === 'revokeAll') { security().revokeAllSessions(); return json({ ok: true }); }
  const p = page(name);
  const fn = p && Object.hasOwn(p.actions, action) ? p.actions[action] : null;
  if (!fn) return json({ error: 'Unknown settings action.' }, { status: 404 });

  // Actions read a form; a password change re-issues the session cookie, which the app needs as its new token.
  let token = '';
  const cookies = { ...event.cookies, set: (n: string, v: string, o: Parameters<typeof event.cookies.set>[2]) => { if (n === SESSION_COOKIE) token = v; event.cookies.set(n, v, o); } };
  const request = new Request(event.url, { method: 'POST', body: formData(body.fields) });
  try {
    const r = await fn({ ...event, request, cookies } as RequestEvent);
    if (isActionFailure(r)) {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return json({ ...d, error: String(d.error || d.pwError || 'That did not work.') }, { status: r.status });
    }
    return json({ ok: true, data: r ?? {}, ...(token ? { token } : {}) }, { headers: noStore });
  } catch (e) {
    if (isRedirect(e)) {
      // Provider consent (Gmail/Zoho): remember the flow so its callback answers with the "return to the app" page.
      const target = new URL(e.location, event.url);
      if (target.origin !== event.url.origin) trackMobileFlow(target.searchParams.get('state') || '');
      return json({ redirect: target.toString() }, { headers: noStore });
    }
    return json({ error: e instanceof Error ? e.message : 'That did not work.' }, { status: 400 });
  }
};
