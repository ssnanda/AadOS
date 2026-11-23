import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { AiError, describeError } from '$lib/server/ai/ajmcp';
import { env } from '$env/dynamic/private';
import { aiConfigured, client, gatewayHost, recordAi } from '$lib/server/ai/service';
import { normalizeBaseUrl, validBaseUrl } from '$lib/server/ai/ajmcp';
import { ajmcpConfig } from '$lib/server/integrations';
import { triagePass, triageStatus, triageSummary } from '$lib/server/ai/email-service';

export const load: PageServerLoad = async () => {
  const state = await readState();
  const cfg = ajmcpConfig(state);
  // The token is never sent to the page: only whether one is saved and where it comes from.
  return { gateway: { url: cfg.url, urlFromEnv: cfg.from.url === 'env', hasToken: Boolean(cfg.token), tokenFromEnv: cfg.from.token === 'env' }, ai: state.ai, status: state.aiStatus, configured: aiConfigured(state), host: gatewayHost(state), triage: triageStatus(), insights: await triageSummary() };
};

const bool = (f: FormData, k: string) => f.get(k) === 'on';
export const actions: Actions = {
  gateway: async ({ request }) => {
    const f = await request.formData();
    const submittedUrl = String(f.get('url') || '').trim();
    const url = normalizeBaseUrl(submittedUrl);
    const token = String(f.get('token') || '').trim();
    const hosts = (env.AADOS_ALLOW_HTTP_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
    if (url && !validBaseUrl(url, hosts)) return fail(400, { error: 'The gateway URL must start with https://' });
    if (token && (token.length < 16 || /\s/.test(token))) return fail(400, { error: 'That does not look like an AJMCP token.' });
    await updateState((s) => {
      s.integrations.ajmcp.url = url;
      if (f.get('clearToken') === 'on') s.integrations.ajmcp.token = '';
      else if (token) s.integrations.ajmcp.token = token; // blank = keep the saved token
    });
    return { message: submittedUrl !== url ? `Gateway settings saved as ${url}. The admin-page suffix was removed.` : 'Gateway settings saved.' };
  },
  save: async ({ request }) => {
    const f = await request.formData();
    await updateState((s) => {
      s.ai = { enabled: bool(f, 'enabled'), background: bool(f, 'background'), emailBodies: bool(f, 'emailBodies'), share: { email: bool(f, 'shareEmail'), calendar: bool(f, 'shareCalendar'), documents: bool(f, 'shareDocuments'), finance: bool(f, 'shareFinance') } };
    });
    return { saved: true };
  },
  // Works even while AI is disabled: only the capabilities endpoint is called (no personal data is sent).
  test: async () => {
    try {
      const caps = await client(await readState(), { ignoreDisabled: true }).capabilities();
      if (!caps.endpoints.includes('/v1/chat')) throw new AiError('forbidden', 'token cannot chat');
      await updateState((s) => { s.aiStatus = { ...s.aiStatus, provider: caps.provider || s.aiStatus.provider, gatewayVersion: caps.version, checkedAt: new Date().toISOString(), lastError: '' }; });
      await recordAi({ ok: true, provider: caps.provider || undefined });
      return { tested: true, message: `Connected to AJMCP ${caps.version || ''} as “${caps.id}”${caps.provider ? ` (provider: ${caps.provider})` : ''}.` };
    } catch (e) {
      await recordAi({ ok: false, error: e });
      return fail(400, { error: describeError(e) });
    }
  },
  triage: async () => {
    const r = await triagePass();
    return { triaged: true, message: `${r.processed} classified, ${r.failed} failed. ${r.note}` };
  }
};
