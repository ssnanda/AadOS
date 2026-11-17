// iMessage (via BlueBubbles) model shared by server and browser. Pure; unit-tested (tests/messages-model.test.ts).
// BlueBubbles shapes vary a little between server versions, so every field is read defensively.

export type Attachment = { guid: string; name: string; mime: string; size: number };
/** `read`: the Mac/phone already read it (BlueBubbles' dateRead), so it is not unread in AadOS either. */
export type Message = { guid: string; chatGuid: string; text: string; fromMe: boolean; sender: string; at: number; attachments: Attachment[]; error: boolean; read: boolean };
/** `sms`: a text-message (green bubble) thread; Messages keeps it separate from the iMessage thread with the same person. */
export type Chat = { guid: string; title: string; participants: string[]; group: boolean; last: Message | null; sms: boolean };

type Raw = Record<string, any>;

/** Comparable key for a phone number or email: digits only (last 10) for phones, lower-case for emails. */
export function addressKey(address: string): string {
  const a = String(address || '').trim().toLowerCase();
  if (a.includes('@')) return a;
  const digits = a.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Friendly form of a raw handle: +1 (980) 306-8308 style for 10/11-digit US numbers, else as-is. */
export function prettyAddress(address: string): string {
  const d = String(address || '').replace(/\D/g, '');
  if (!address.includes('@') && (d.length === 10 || (d.length === 11 && d[0] === '1'))) { const n = d.slice(-10); return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`; }
  return address;
}

const ms = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

export function toMessage(m: Raw, chatGuid = ''): Message {
  return {
    guid: String(m.guid || ''),
    chatGuid: String(chatGuid || m.chats?.[0]?.guid || m.chatGuid || ''),
    text: String(m.text ?? m.attributedBody?.[0]?.string ?? ''),
    fromMe: Boolean(m.isFromMe),
    sender: m.isFromMe ? '' : String(m.handle?.address || m.handleId || ''),
    at: ms(m.dateCreated) || ms(m.dateDelivered) || 0,
    attachments: (Array.isArray(m.attachments) ? m.attachments : []).filter((a: Raw) => a?.guid && !a.hideAttachment).map((a: Raw) => ({ guid: String(a.guid), name: String(a.transferName || a.filename || 'attachment'), mime: String(a.mimeType || a.mime || ''), size: Number(a.totalBytes || 0) })),
    error: Boolean(m.error && Number(m.error) !== 0),
    read: Boolean(m.isFromMe || ms(m.dateRead) || m.isRead === true)
  };
}

/** Chat title: the group name, else participant names (from contacts), else pretty numbers. */
export function toChat(c: Raw, names: Map<string, string>): Chat {
  const participants: string[] = (Array.isArray(c.participants) ? c.participants : []).map((p: Raw) => String(p.address || p.id || '')).filter(Boolean);
  if (!participants.length && c.chatIdentifier && !String(c.chatIdentifier).startsWith('chat')) participants.push(String(c.chatIdentifier));
  const label = (a: string) => names.get(addressKey(a)) || prettyAddress(a);
  const group = participants.length > 1 || String(c.style) === '43';
  const title = String(c.displayName || '').trim() || participants.map(label).join(', ') || String(c.chatIdentifier || 'Conversation');
  return { guid: String(c.guid || ''), title, participants, group, last: c.lastMessage ? toMessage(c.lastMessage, String(c.guid || '')) : null, sms: /^(SMS|RCS);/i.test(String(c.guid || '')) };
}

/** Unread = the last message is from someone else and arrived after the chat was last opened in AadOS. */
export const isUnread = (chat: Chat, readAt: Record<string, number>) => Boolean(chat.last && !chat.last.fromMe && !chat.last.read && chat.last.at > (readAt[chat.guid] || 0));

/** One-line preview for the list. */
export function preview(m: Message | null): string {
  if (!m) return '';
  const t = m.text.replace(/\s+/g, ' ').replace(/￼/g, '').trim();
  return t || (m.attachments.length ? `📎 ${m.attachments.length === 1 ? m.attachments[0].name : `${m.attachments.length} attachments`}` : '');
}
