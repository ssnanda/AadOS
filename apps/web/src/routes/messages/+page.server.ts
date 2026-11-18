import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import * as bb from '$lib/server/bluebubbles';
import { addressKey, categorize, isSpamReply, isUnread, DEFAULT_TEMPLATES } from '$lib/messages-model';
import { updateState } from '$lib/server/aados-store';
import { can } from '$lib/server/auth';

// Conversations, live from BlueBubbles, with review categories (tiles), names for participants, canned replies and
// where contact names came from (to diagnose missing names).
declare global { var __aadosReportSeen: string | undefined; }
export const load: PageServerLoad = async ({ locals, url }) => {
  // ?all=1 (Show all): every conversation, reaching far back, so old senders can be found and grouped.
  const showAll = url.searchParams.get('all') === '1';
  const state = await readState();
  const base = { aiAvailable: state.ai.enabled, asana: can(locals.user, 'asana') && Boolean(state.integrations.asana?.token), owner: Boolean(locals.user?.owner), templates: state.messageTemplates ?? DEFAULT_TEMPLATES, groups: state.messageGroups ?? [], showAll };
  if (!bb.bbConfigured(state)) return { ...base, connected: false as const };
  const readAt = state.messagesRead || {};
  const contactErrors = state.accounts.filter((a) => a.contacts && (a.lastError || '').startsWith('Contacts:')).map((a) => `${a.email}: ${a.lastError}`);
  const contactsOn = state.accounts.some((a) => a.provider === 'gmail' && a.contacts && !a.contactsOff);
  try {
    const { chats, names, sources } = await bb.chatsWithNames(await bb.bbConnection(), showAll ? 2000 : 1000);
    // Spam: saved list + any 1:1 conversation whose latest message is your spam reply (sent from the phone or before this existed).
    const spam = new Set(state.messageSpam ?? []);
    const templates = state.messageTemplates ?? DEFAULT_TEMPLATES;
    const found = chats.filter((c) => !c.group && c.participants.length === 1 && c.last?.fromMe && isSpamReply(c.last.text, templates)).map((c) => addressKey(c.participants[0])).filter((k) => !spam.has(k));
    if (found.length) { for (const k of found) spam.add(k); await updateState((st) => { st.messageSpam = [...new Set([...(st.messageSpam ?? []), ...found])]; }); }
    // Done: the stop reply to a spam sender went through (latest message is mine, not failed, >1 min old so a delivery
    // failure would have shown). Those conversations move from Spam to Spam reports and stay there.
    const done = new Set(state.messageSpamDone ?? []);
    const delivered = chats.filter((c) => !c.group && c.participants.length === 1 && spam.has(addressKey(c.participants[0])) && c.last?.fromMe && !c.last.error && isSpamReply(c.last.text, templates) && Date.now() - c.last.at > 60_000).map((c) => addressKey(c.participants[0])).filter((k) => !done.has(k));
    // Also every number you reported to 7726 (the number text you sent there), including reports made before this existed.
    // The 7726 thread is read again only when its latest message changes.
    const reportChat = chats.find((c) => !c.group && c.participants.some((p) => addressKey(p) === '7726'));
    if (reportChat?.last && globalThis.__aadosReportSeen !== `${reportChat.guid}:${reportChat.last.at}`) {
      const msgs = await bb.thread(await bb.bbConnection(), reportChat.guid, 200).catch(() => null);
      if (msgs) {
        globalThis.__aadosReportSeen = `${reportChat.guid}:${reportChat.last.at}`;
        for (const m of msgs) if (m.fromMe && !m.error && /^\+?[\d\s().-]{10,16}$/.test(m.text.trim())) { const k = addressKey(m.text); if (k.length === 10 && !done.has(k)) delivered.push(k); }
      }
    }
    if (delivered.length) { for (const k of delivered) { done.add(k); spam.add(k); } await updateState((st) => { st.messageSpam = [...new Set([...(st.messageSpam ?? []), ...delivered])]; st.messageSpamDone = [...new Set([...(st.messageSpamDone ?? []), ...delivered])]; }); }
    const isSpam = (c: (typeof chats)[number]) => !c.group && c.participants.some((p) => spam.has(addressKey(p)));
    const unread = chats.filter((c) => isUnread(c, readAt)).map((c) => c.guid);
    bb.setUnreadBadge(chats.filter((c) => unread.includes(c.guid) && !c.filtered && !isSpam(c) && !c.participants.some((p) => addressKey(p) === '7726')).length); // like the phone: known senders only
    // Names for every participant on screen (group senders, headers) and a contact list for composing.
    const people: Record<string, string> = {};
    for (const c of chats) for (const p of c.participants) { const n = names.get(addressKey(p)); if (n) people[addressKey(p)] = n; }
    const contacts = [...names].filter(([k]) => /^\d{10}$/.test(k) || k.includes('@')).map(([k, name]) => ({ name, address: k.includes('@') ? k : `+1${k}` })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 3000);
    return { ...base, connected: true as const, spam: [...spam], spamDone: [...done], chats, unread, categories: Object.fromEntries(chats.map((c) => [c.guid, categorize(c, names)])), people, contacts, nameSources: sources, contactsOn, contactErrors, loadedAt: new Date().toISOString(), error: '' };
  } catch (e) {
    return { ...base, connected: true as const, spam: [] as string[], spamDone: [] as string[], chats: [], unread: [], categories: {}, people: {}, contacts: [], nameSources: { google: 0 }, contactsOn, contactErrors, loadedAt: new Date().toISOString(), error: e instanceof Error ? e.message : 'Could not reach BlueBubbles.' };
  }
};
