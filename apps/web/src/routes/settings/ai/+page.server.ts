import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { AiError, describeError } from '$lib/server/ai/ajmcp';
import { aiConfigured, client, gatewayHost, recordAi } from '$lib/server/ai/service';
import { triagePass, triageStatus, triageSummary } from '$lib/server/ai/email-service';

export const load: PageServerLoad = async () => {
  const state = await readState();
  return { ai: state.ai, status: state.aiStatus, configured: aiConfigured(), host: gatewayHost(), triage: triageStatus(), insights: await triageSummary() };
};

const bool = (f: FormData, k: string) => f.get(k) === 'on';
export const actions: Actions = {
  save: async ({ request }) => {
    const f = await request.formData();
    await updateState((s) => {
      s.ai = { enabled: bool(f, 'enabled'), background: bool(f, 'background'), emailBodies: bool(f, 'emailBodies'), share: { email: bool(f, 'shareEmail'), calendar: bool(f, 'shareCalendar'), tasks: bool(f, 'shareTasks'), documents: bool(f, 'shareDocuments') } };
    });
    return { saved: true };
  },
  // Works even while AI is disabled: only the capabilities endpoint is called (no personal data is sent).
  test: async () => {
    try {
      const caps = await client(undefined, { ignoreDisabled: true }).capabilities();
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
