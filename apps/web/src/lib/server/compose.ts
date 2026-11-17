// Outgoing mail: recipients for reply/reply-all/forward, subjects, quoting, and RFC 5322/MIME assembly for Gmail.
// Pure (no framework imports); unit-tested. Only ever used when the owner clicks Send.

export type Headers = Record<string, string>; // lower-case header name -> value
export type Mode = 'reply' | 'replyAll' | 'forward';
export type Attachment = { filename: string; mime: string; data: Uint8Array };

const ADDR = /[\w.+'-]+@[\w-]+(\.[\w-]+)+/g;
/** Addresses in a header value ("Ann <a@x.com>, b@y.com" -> ["a@x.com","b@y.com"]), lower-cased, unique. */
export const addresses = (value: string | undefined) => [...new Set((String(value || '').match(ADDR) || []).map((a) => a.toLowerCase()))];
export const validAddressList = (value: string) => value.split(/[,;]/).map((s) => s.trim()).filter(Boolean).every((s) => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(s.replace(/^.*<([^>]+)>$/, '$1')));

/** Default recipients. Reply -> Reply-To or From. Reply all -> also everyone else on To/Cc, never yourself. */
export function recipients(mode: Mode, h: Headers, me: string): { to: string[]; cc: string[] } {
  if (mode === 'forward') return { to: [], cc: [] };
  const self = me.toLowerCase();
  const fromMe = addresses(h.from).includes(self);
  // Replying to your own sent mail goes to its original recipients.
  const primary = fromMe ? addresses(h.to) : addresses(h['reply-to'] || h.from);
  if (mode === 'reply') return { to: primary.filter((a) => a !== self), cc: [] };
  const to = primary.filter((a) => a !== self);
  const cc = [...addresses(h.to), ...addresses(h.cc)].filter((a) => a !== self && !to.includes(a));
  return { to, cc: [...new Set(cc)] };
}

export function subjectFor(mode: Mode, subject: string): string {
  const s = subject.trim() || '(no subject)';
  if (mode === 'forward') return /^(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`;
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** Quoted original under the new text (plain text). */
export function quote(mode: Mode, h: Headers, text: string): string {
  const body = text.replace(/\r\n/g, '\n').trim();
  if (mode === 'forward') return `\n\n---------- Forwarded message ----------\nFrom: ${h.from || ''}\nDate: ${h.date || ''}\nSubject: ${h.subject || ''}\nTo: ${h.to || ''}${h.cc ? `\nCc: ${h.cc}` : ''}\n\n${body}`;
  return `\n\nOn ${h.date || 'an earlier date'}, ${h.from || 'the sender'} wrote:\n${body.split('\n').map((l) => `> ${l}`).join('\n')}`;
}

/** Threading headers for a reply. */
export function threading(h: Headers): { inReplyTo: string; references: string } {
  const id = (h['message-id'] || '').trim();
  return { inReplyTo: id, references: [h.references || '', id].join(' ').replace(/\s+/g, ' ').trim() };
}

const noBreak = (v: string) => { if (/[\r\n]/.test(v)) throw new Error('Header values cannot contain line breaks'); return v; };
/** RFC 2047 encoded-word for non-ASCII header text. */
export const encodeHeader = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`);
const b64lines = (data: Uint8Array) => Buffer.from(data).toString('base64').replace(/.{1,76}/g, '$&\r\n').trim();
const safeName = (n: string) => n.replace(/["\\\r\n]/g, '_').slice(0, 200);

/** RFC 5322 message (text body, optional attachments) for Gmail users.messages.send. */
export function buildMime(m: { from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; inReplyTo?: string; references?: string; attachments?: Attachment[]; boundary?: string; date?: Date }): string {
  if (!m.to.length && !(m.cc || []).length && !(m.bcc || []).length) throw new Error('Add at least one recipient');
  const head = [
    `From: ${noBreak(m.from)}`, `To: ${noBreak(m.to.join(', '))}`,
    ...(m.cc?.length ? [`Cc: ${noBreak(m.cc.join(', '))}`] : []), ...(m.bcc?.length ? [`Bcc: ${noBreak(m.bcc.join(', '))}`] : []),
    `Subject: ${encodeHeader(noBreak(m.subject))}`, `Date: ${(m.date || new Date()).toUTCString()}`, 'MIME-Version: 1.0',
    ...(m.inReplyTo ? [`In-Reply-To: ${noBreak(m.inReplyTo)}`] : []), ...(m.references ? [`References: ${noBreak(m.references)}`] : [])
  ];
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64lines(Buffer.from(m.text, 'utf8'))].join('\r\n');
  if (!m.attachments?.length) return [...head, textPart].join('\r\n');
  const b = m.boundary || `aados-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const parts = [textPart, ...m.attachments.map((a) => [`Content-Type: ${a.mime || 'application/octet-stream'}; name="${safeName(a.filename)}"`, `Content-Disposition: attachment; filename="${safeName(a.filename)}"`, 'Content-Transfer-Encoding: base64', '', b64lines(a.data)].join('\r\n'))];
  return [...head, `Content-Type: multipart/mixed; boundary="${b}"`, '', ...parts.map((p) => `--${b}\r\n${p}`), `--${b}--`, ''].join('\r\n');
}

/** First http(s) link of a List-Unsubscribe header, else a mailto, else ''. */
export function unsubscribeFromHeader(value: string | undefined): { url: string; mailto: string } {
  const items = (String(value || '').match(/<([^>]+)>/g) || []).map((s) => s.slice(1, -1).trim());
  return { url: items.find((s) => /^https?:\/\//i.test(s)) || '', mailto: items.find((s) => /^mailto:/i.test(s)) || '' };
}
/** Fallback: an unsubscribe link in the message HTML (anchor whose text or href mentions unsubscribe). */
export function unsubscribeFromHtml(html: string): string {
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].replace(/&amp;/g, '&'), text = m[2].replace(/<[^>]+>/g, ' ');
    if (/^https?:\/\//i.test(href) && /unsubscribe|opt[\s-]?out|manage (your )?(email )?preferences/i.test(`${text} ${href}`)) return href;
  }
  return '';
}
