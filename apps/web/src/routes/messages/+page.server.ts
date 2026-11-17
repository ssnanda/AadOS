import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import * as bb from '$lib/server/bluebubbles';
import { isUnread } from '$lib/messages-model';
import { can } from '$lib/server/auth';

// Conversations, live from BlueBubbles. Unread = newest message is from someone else and newer than when the chat was
// last opened here.
export const load: PageServerLoad = async ({ locals }) => {
  const state = await readState();
  const base = { aiAvailable: state.ai.enabled, asana: can(locals.user, 'asana') && Boolean(state.integrations.asana?.token), owner: Boolean(locals.user?.owner) };
  if (!bb.bbConfigured(state)) return { ...base, connected: false as const };
  const readAt = state.messagesRead || {};
  try {
    const chats = await bb.chats(await bb.bbConnection());
    const unread = chats.filter((c) => isUnread(c, readAt)).map((c) => c.guid);
    bb.setUnreadBadge(unread.length);
    return { ...base, connected: true as const, chats, unread, error: '' };
  } catch (e) {
    return { ...base, connected: true as const, chats: [], unread: [], error: e instanceof Error ? e.message : 'Could not reach BlueBubbles.' };
  }
};
