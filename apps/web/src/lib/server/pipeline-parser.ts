import type { PipelineItem, PipelineParser } from './aados-store';

type Facts = Record<string, string | number | boolean>;
type Input = Pick<PipelineItem, 'subject' | 'sender' | 'summary'> & { body?: string };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const codePoint = (n: number, fallback: string) => (Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback);
/** Decode HTML entities (Zoho/Gmail snippets are HTML-escaped) and collapse whitespace. */
export const clean = (value: unknown) => String(value ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => codePoint(parseInt(h, 16), m))
  .replace(/&#(\d+);/g, (m, d) => codePoint(Number(d), m))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
  .replace(/\s+/g, ' ').trim();

const money = (text: string) => text.match(/(?:\$|USD\s*)(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/i)?.[1]?.replaceAll(',', '') || '';
const date = (text: string) => text.match(/\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})\b/)?.[1] || '';

// Bulk-mail platforms: the sender domain says nothing about the store.
const MAILERS = /(sendgrid|mailchimp|mcsv|rsgsv|amazonses|klaviyo|constantcontact|shopifyemail|mailgun|sparkpost|exacttarget|salesforce|cheetahmail|responsys|iterable|braze|postmarkapp|mandrillapp|list-manage)/i;
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
const title = (value: string) => value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Best-effort store name from the sender: s.kohls.com → Kohls, shop.nike.co.uk → Nike. */
export function storeName(sender: string): string {
  const domain = sender.match(/@([\w.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase() || '';
  const display = clean(sender.replace(/<[^>]*>/g, '').replace(/["']/g, '')).replace(/\S+@\S+/g, '').trim();
  if (domain && !MAILERS.test(domain)) {
    const labels = domain.split('.');
    let index = labels.length - 2;
    if (index > 0 && SECOND_LEVEL.has(labels[index])) index--;
    if (labels[index]) return title(labels[index]);
  }
  return display ? title(display.toLowerCase()) : '';
}

type ShopKind = 'order' | 'shipping' | 'return' | 'coupon' | 'other';
// Kind comes from the subject and snippet only: bodies are full of footer words
// ("tracking", "delivery") that made promotions look like shipments.
function shopKind(subject: string, summary: string): ShopKind {
  const head = `${subject} ${summary}`;
  if (/\b(refund(ed)?|return (label|request|received|processed|instructions)|your return)\b/i.test(subject)) return 'return';
  if (/\b(has shipped|shipped|on (its|the) way|out for delivery|delivered|delivery (update|scheduled|attempt)|tracking (number|info|update)|arriving (today|tomorrow))\b/i.test(subject)) return 'shipping';
  if (/\b(left in your cart|forgot|still in your cart|complete your order|abandon)/i.test(head)) return 'coupon';
  if (/\b(order (confirm|received|placed|#|number|status)|your order|thanks? for (your )?(order|purchase)|receipt|invoice|payment (received|confirm))/i.test(subject)) return 'order';
  if (/(\d+\s?% off|\$\s?\d+(\.\d\d)? off|\boff\b|coupon|promo|\bcode\b|\bsale\b|\bdeals?\b|\bsave\b|savings|bogo|free shipping|clearance|\bcash\b|rewards?|\bends\b|last chance|hours? left|exclusive|limited time|doorbuster|flash|% back|gift)/i.test(head)) return 'coupon';
  return 'other';
}

function shopFacts(kind: ShopKind, sender: string, text: string): Facts {
  const facts: Facts = { store: storeName(sender) };
  if (kind === 'coupon') {
    const pct = text.match(/(\d{1,2})\s?%\s?(?:off|back)/i)?.[1];
    const dollars = text.match(/\$\s?(\d{1,4})\s?off/i)?.[1];
    facts.discount = pct ? `${pct}% off` : dollars ? `$${dollars} off` : '';
    facts.code = text.match(/\b(?:code|promo(?:\s*code)?|coupon)\s*:?\s+([A-Z0-9]{4,16})\b/)?.[1] || '';
    facts.expires = text.match(/\b(?:ends|expires|through|thru|until|valid (?:through|until))\s+((?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|(?:[A-Z][a-z]{2,8}\.?\s+\d{1,2}))/)?.[1] || '';
    return facts;
  }
  // Needs a '#', 'number' or 'no.' marker and at least one digit, so "order none" no longer matches.
  const order = text.match(/\b(?:order|confirmation)\s*(?:#|number|no\.|:)\s*#?\s*([A-Z0-9][A-Z0-9-]{3,})/i)?.[1] || '';
  const tracking = text.match(/\b(?:tracking|shipment)\s*(?:#|number|no\.|:)\s*#?\s*([A-Z0-9][A-Z0-9-]{7,})/i)?.[1] || '';
  facts.order = /\d/.test(order) ? order : '';
  facts.tracking = /\d/.test(tracking) ? tracking : '';
  facts.amount = money(text);
  facts.date = date(text);
  return facts;
}

export function parseMessage(parser: PipelineParser, raw: Input): { kind: string; facts: Facts } {
  const input = { subject: clean(raw.subject), sender: clean(raw.sender), summary: clean(raw.summary), body: clean(raw.body) };
  const text = `${input.subject}\n${input.summary}\n${input.body}`;
  if (parser === 'shop') {
    const kind = shopKind(input.subject, input.summary);
    return { kind, facts: shopFacts(kind, input.sender, text) };
  }
  if (parser === 'health') {
    const all = `${text}\n${input.sender}`;
    const head = `${input.subject} ${input.summary}`;
    // Subject/snippet decide the kind, not the whole body: footers and boilerplate ("scheduled
    // payments", "your prescription") used to turn balance notices and ads into appointments.
    const kind =
      /contact lens(es)?|open enrollment|annual enrollment|enrollment period|medicare (advantage|supplement|plan|part)|\bmedicare\b.{0,40}\benroll/i.test(head) ? 'promo'
      : /\b(appointment|visit|telehealth)\b/i.test(input.subject) || /\b(appointment|visit)\b.{0,30}\b(scheduled|reminder|confirm\w*|tomorrow)\b/i.test(head) ? 'appointment'
      : /\b(claim|EOB|explanation of benefits)\b/i.test(head) ? 'claim'
      : /\b(prescription|refill|pharmacy|rx)\b/i.test(input.subject) || /\b(prescription|refill)\b.{0,40}\b(ready|filled|shipped|pick ?up)\b/i.test(head) ? 'prescription'
      : /\b(balance|statement|bill|invoice|payment|amount due)\b/i.test(input.subject) ? 'bill'
      : 'message';
    return { kind, facts: { provider: input.sender, amount: money(all), date: date(all) } };
  }
  return { kind: 'message', facts: { date: date(text), amount: money(text) } };
}
