import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import * as bb from '$lib/server/bluebubbles';
import { addressKey, categorize, isUnread, DEFAULT_TEMPLATES } from '$lib/messages-model';
import { can } from '$lib/server/auth';

// Conversations, live from BlueBubbles, with review categories (tiles), names for participants, canned replies and
// where contact names came from (to diagnose missing names).
export const load: PageServerLoad = async ({ locals }) => {
  const state = await readState();
  const base = { aiAvailable: state.ai.enabled, asana: can(locals.user, 'asana') && Boolean(state.integrations.asana?.token), owner: Boolean(locals.user?.owner), templates: state.messageTemplates ?? DEFAULT_TEMPLATES };
  if (!bb.bbConfigured(state)) return { ...base, connected: false as const };
  const readAt = state.messagesRead || {};
  const contactErrors = state.accounts.filter((a) => a.contacts && (a.lastError || '').startsWith('Contacts:')).map((a) => `${a.email}: ${a.lastError}`);
  const contactsOn = state.accounts.some((a) => a.provider === 'gmail' && a.contacts && !a.contactsOff);
  try {
    const { chats, names, sources } = await bb.chatsWithNames(await bb.bbConnection());
    const unread = chats.filter((c) => isUnread(c, readAt)).map((c) => c.guid);
    bb.setUnreadBadge(unread.length);
    // Names for every participant on screen (group senders, headers) and a contact list for composing.
    const people: Record<string, string> = {};
    for (const c of chats) for (const p of c.participants) { const n = names.get(addressKey(p)); if (n) people[addressKey(p)] = n; }
    const contacts = [...names].filter(([k]) => /^\d{10}$/.test(k) || k.includes('@')).map(([k, name]) => ({ name, address: k.includes('@') ? k : `+1${k}` })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 3000);
    return { ...base, connected: true as const, chats, unread, categories: Object.fromEntries(chats.map((c) => [c.guid, categorize(c, names)])), people, contacts, nameSources: sources, contactsOn, contactErrors, loadedAt: new Date().toISOString(), error: '' };
  } catch (e) {
    return { ...base, connected: true as const, chats: [], unread: [], categories: {}, people: {}, contacts: [], nameSources: { google: 0, mac: 0 }, contactsOn, contactErrors, loadedAt: new Date().toISOString(), error: e instanceof Error ? e.message : 'Could not reach BlueBubbles.' };
  }
};
