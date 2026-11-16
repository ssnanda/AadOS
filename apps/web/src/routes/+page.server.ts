import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import type { MailboxData, Overview, MailMessage } from '$lib/types';
import { readState } from '$lib/server/aados-store';

const initialOverview: Overview = {
  connection_state: 'not_connected',
  read_only: true,
  accounts: [],
  counts: { all: 0, unread: 0, needs_reply: 0, important: 0 },
  features: { gmail: false, microsoft: false, ai_triage: false }
};

// Synced mail lives in the web app's own store (Zoho/Gmail pipelines). The Phoenix
// API is only probed for the status indicator.
export const load: PageServerLoad = async ({ fetch }): Promise<MailboxData> => {
  const origin = (env.AADOS_API_URL || 'http://localhost:4000').replace(/\/$/, '');
  const state = await readState();
  const accounts: Overview['accounts'] = state.accounts.map((account) => ({ id: account.id, provider: account.provider, address: account.email || account.id, status: 'connected' }));
  const names = new Map(state.pipelines.map((pipeline) => [pipeline.id, pipeline.name]));
  const sorted = [...state.items].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const messages: MailMessage[] = sorted.slice(0, 300).map((item) => ({
    id: item.id, account_id: item.pipelineId, sender: item.sender, subject: item.subject || '(no subject)', snippet: item.summary,
    received_at: item.receivedAt, category: names.get(item.pipelineId) || item.kind, unread: false, needs_reply: false, important: false
  }));
  let apiStatus: MailboxData['apiStatus'] = 'online';
  try { const r = await fetch(`${origin}/api/v1/email/overview`, { signal: AbortSignal.timeout(2000) }); if (!r.ok) apiStatus = 'offline'; } catch { apiStatus = 'offline'; }
  return {
    overview: { ...initialOverview, connection_state: accounts.length ? 'connected' : 'not_connected', accounts, counts: { ...initialOverview.counts, all: state.items.length } },
    messages,
    apiStatus
  };
};
