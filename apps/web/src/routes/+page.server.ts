import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import type { MailboxData, Overview, MailMessage } from '$lib/types';

const initialOverview: Overview = {
  connection_state: 'not_connected',
  read_only: true,
  accounts: [],
  counts: { all: 0, unread: 0, needs_reply: 0, important: 0 },
  features: { gmail: false, microsoft: false, ai_triage: false }
};

export const load: PageServerLoad = async ({ fetch }): Promise<MailboxData> => {
  const origin = (env.AADOS_API_URL || 'http://localhost:4000').replace(/\/$/, '');

  try {
    const [overviewResponse, messagesResponse] = await Promise.all([
      fetch(`${origin}/api/v1/email/overview`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${origin}/api/v1/email/messages`, { signal: AbortSignal.timeout(3000) })
    ]);

    if (!overviewResponse.ok || !messagesResponse.ok) throw new Error('API unavailable');
    const overview = (await overviewResponse.json()) as Overview;
    const inbox = (await messagesResponse.json()) as { messages: MailMessage[] };

    return {
      overview,
      messages: Array.isArray(inbox.messages) ? inbox.messages : [],
      apiStatus: 'online'
    };
  } catch {
    return { overview: initialOverview, messages: [], apiStatus: 'offline' };
  }
};
