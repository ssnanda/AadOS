import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { bbConnection, ping, registerWebhook } from '$lib/server/bluebubbles';

// BlueBubbles connection (owner only). The password is stored encrypted with the other integration secrets and never
// sent to the browser.
export const load: PageServerLoad = async ({ url }) => {
  const b = (await readState()).integrations.bluebubbles;
  return { url: b.url, hasPassword: Boolean(b.password), hook: b.hookSecret ? `${url.origin}/messages/hook` : '' };
};

export const actions: Actions = {
  save: async ({ request, url }) => {
    const f = await request.formData();
    const server = String(f.get('url') || '').trim().replace(/\/+$/, ''), password = String(f.get('password') || '');
    if (!/^https?:\/\/[^\s]+$/i.test(server)) return fail(400, { error: 'Enter the server URL, e.g. http://192.168.1.20:1234 or your https tunnel URL.' });
    const before = (await readState()).integrations.bluebubbles;
    const pw = password || before.password;
    if (!pw) return fail(400, { error: 'Enter the BlueBubbles server password.' });
    // Verify first, then save, then register the webhook for live messages.
    try {
      const info = await ping({ url: server, password: pw });
      await updateState((s) => { s.integrations.bluebubbles.url = server; s.integrations.bluebubbles.password = pw; });
      let hook = '', hookError = '';
      try { hook = await registerWebhook(await bbConnection(), url.origin); } catch (e) { hookError = e instanceof Error ? e.message : 'failed'; }
      return { saved: true, info: { os: String(info?.os_version || info?.macos_version || ''), version: String(info?.server_version || '') }, hook: Boolean(hook), hookError };
    } catch (e) { return fail(400, { error: e instanceof Error ? e.message : 'Could not reach the server.' }); }
  },
  test: async () => {
    try { const info = await ping(await bbConnection()); return { tested: true, info: { os: String(info?.os_version || info?.macos_version || ''), version: String(info?.server_version || '') } }; }
    catch (e) { return fail(400, { error: e instanceof Error ? e.message : 'Could not reach the server.' }); }
  },
  webhook: async ({ url }) => {
    try { await registerWebhook(await bbConnection(), url.origin); return { hook: true }; } catch (e) { return fail(400, { error: e instanceof Error ? e.message : 'Could not register the webhook.' }); }
  },
  disconnect: async () => { await updateState((s) => { s.integrations.bluebubbles = { url: '', password: '', hookSecret: '' }; s.messagesRead = {}; }); return { disconnected: true }; }
};
