import type { PageServerLoad } from './$types';
import { database, hasDatabase, readState } from '$lib/server/aados-store';
import { aiConfigured } from '$lib/server/ai/service';
import { getConversation, listConversations } from '$lib/server/ai/db';

export const load: PageServerLoad = async ({ url }) => {
  const state = await readState();
  const base = { aiEnabled: state.ai.enabled, aiConfigured: aiConfigured(), share: state.ai.share };
  if (!hasDatabase()) return { ...base, available: false, conversations: [], current: null, q: '' };
  const db = await database();
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const id = url.searchParams.get('c') || '';
  const current = id ? await getConversation(db, id) : null;
  return { ...base, available: true, conversations: await listConversations(db, q), current, q };
};
