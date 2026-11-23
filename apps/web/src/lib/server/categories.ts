import { extractDue } from './dates.ts';

// Deterministic, rule-based personal-email classification. Everything here is a heuristic
// suggestion (never a verified fact); local overrides on the item always win.
// Pure module: no framework imports, so it can be unit-tested with `node --test`.

export const CATEGORIES = [
  'Personal', 'Family', 'Important', 'Needs Reply', 'Bills', 'Payments', 'Receipts', 'Shopping',
  'Orders and Deliveries', 'Subscriptions', 'Renewals', 'Appointments', 'Travel', 'Newsletters',
  'Promotions', 'Notifications', 'Other'
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ClassifiableItem = {
  subject: string; sender: string; summary: string; kind?: string;
  categories?: string[]; importance?: 'high' | 'normal'; actionState?: 'actionable' | 'dismissed' | 'reviewed';
};
export type ClassifyContext = { accountEmail?: string; familyNames?: string[]; now?: Date };

const has = (text: string, re: RegExp) => re.test(text);
export const senderAddress = (sender: string) => (sender.match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || '').toLowerCase();
const BULK_SENDER = /\b(no-?reply|do-?not-?reply|notifications?|newsletter|mailer|updates?|info|news|marketing|offers?|deals?|billing|support|alerts?|team)\b/i;

/** Mail the owner sent themselves (sent copies, or "from me" in a mixed folder). */
export const isOutgoing = (item: ClassifiableItem, ctx: ClassifyContext) => {
  const mine = (ctx.accountEmail || '').toLowerCase();
  return Boolean(mine) && senderAddress(item.sender) === mine;
};

/** Suggested categories from subject, sender and snippet. Returns [] never: falls back to Other. */
export function classify(item: ClassifiableItem, ctx: ClassifyContext = {}): string[] {
  if (item.categories?.length) return item.categories;
  const subject = item.subject || '';
  const head = `${subject} ${item.summary || ''}`;
  const from = item.sender || '';
  const out = new Set<string>();

  if (item.kind === 'order' || item.kind === 'shipping' || item.kind === 'return') { out.add('Shopping'); out.add('Orders and Deliveries'); }
  else if (item.kind === 'coupon') { out.add('Promotions'); }
  if (has(subject, /\b(order (confirm|#|number|status|shipped)|has shipped|out for delivery|delivered|tracking|arriving|package|shipment)\b/i)) { out.add('Orders and Deliveries'); out.add('Shopping'); }
  if (has(subject, /\b(receipt|invoice|your order|purchase|thanks? for your (order|purchase|payment))\b/i)) out.add('Receipts');
  if (has(head, /\b(payment (received|confirm|failed|due|scheduled|posted|declined)|you paid|autopay|payment of|paid)\b/i)) out.add('Payments');
  if (has(head, /\b(bill|statement (is )?(ready|available)|amount due|balance due|due (on|by|date)|past due|minimum payment|pay now|utility|invoice due)\b/i)) out.add('Bills');
  if (has(head, /\b(subscription|your plan|membership|billed (monthly|annually)|free trial|trial (ends|expires)|auto-?renew)\b/i)) out.add('Subscriptions');
  if (has(head, /\b(renew(al|s|ed)?|expires? (on|soon|in)|expiring|expiration|will expire)\b/i)) out.add('Renewals');
  if (has(head, /\b(appointment|reservation|booking confirm|scheduled for|reminder:? .*(visit|appointment)|your visit|check-?up|calendar invite|invitation:)\b/i)) out.add('Appointments');
  if (has(head, /\b(flight|boarding pass|itinerary|hotel|check-?in|airline|trip|e-?ticket|rental car|reservation (code|number)|travel)\b/i)) out.add('Travel');
  if (has(from + ' ' + head, /\b(newsletter|weekly digest|daily digest|unsubscribe|view (this )?(email )?in (your )?browser|issue #\d+)\b/i)) out.add('Newsletters');
  if (has(head, /(\d+\s?% off|\bsale\b|\bdeals?\b|coupon|promo code|free shipping|limited time|last chance|exclusive offer|save \$?\d+|clearance)/i)) out.add('Promotions');
  if (has(head, /\b(security alert|new sign-?in|password|verification code|verify your|one-?time (code|passcode)|login attempt|your account|two-?factor|confirm your email)\b/i) || (BULK_SENDER.test(from) && out.size === 0)) out.add('Notifications');
  if ((ctx.familyNames || []).some((name) => name && from.toLowerCase().includes(name.toLowerCase()))) { out.add('Family'); out.add('Personal'); }

  // Person-to-person mail: not a bulk sender and not already a bulk/commerce category.
  const bulk = ['Newsletters', 'Promotions', 'Notifications', 'Shopping', 'Receipts', 'Orders and Deliveries', 'Subscriptions'].some((c) => out.has(c));
  if (!bulk && !BULK_SENDER.test(from) && senderAddress(from) && !isOutgoing(item, ctx)) out.add('Personal');

  if (importance(item, [...out], ctx) === 'high') out.add('Important');
  if (detectAction(item, ctx)?.kind === 'reply') out.add('Needs Reply');
  if (out.size === 0) out.add('Other');
  return CATEGORIES.filter((c) => out.has(c));
}

/** Local override first; otherwise high for urgent language, bills, security and family mail. */
export function importance(item: ClassifiableItem, categories: string[], ctx: ClassifyContext = {}): 'high' | 'normal' {
  if (item.importance) return item.importance;
  const head = `${item.subject || ''} ${item.summary || ''}`;
  if (categories.includes('Promotions') || categories.includes('Newsletters')) return 'normal';
  if (has(head, /\b(urgent|action required|immediate(ly)?|asap|final notice|past due|overdue|time[- ]sensitive|important|security alert|suspicious|payment (failed|declined)|expires? (today|tomorrow))\b/i)) return 'high';
  if (categories.includes('Family') || categories.includes('Bills') || categories.includes('Appointments')) return 'high';
  return 'normal';
}

export type ActionKind = 'reply' | 'task' | 'financial' | 'appointment' | 'info';
export type ActionSuggestion = { kind: ActionKind; reason: string; due?: string };

/** A coupon is automatic only when both its purpose and a concrete expiry are explicit. */
export function couponExpiry(item: ClassifiableItem, ctx: ClassifyContext = {}): string {
  if ((item as ClassifiableItem & { savedValueDismissed?: boolean }).savedValueDismissed) return '';
  const text = `${item.subject || ''} ${item.summary || ''}`;
  const coupon = item.kind === 'coupon' || /\b(coupon|promo(?:tional)? code|discount|\d+\s?% off|save \$?\d+|special offer)\b/i.test(text);
  const expires = /\b(expir(?:e|es|ed|ation)|valid (?:through|until)|use by|redeem by|offer ends)\b/i.test(text);
  return coupon && expires ? extractDue(text, ctx.now) : '';
}

const DATE = /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+20\d{2})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|20\d{2}-\d{2}-\d{2}|today|tomorrow|tonight|this (?:week|friday|monday|weekend))\b/i;

/**
 * Suggest whether a message needs attention. Heuristic only. The owner's local state wins:
 * 'dismissed' and 'reviewed' suppress the suggestion, 'actionable' forces a reply task.
 */
export function detectAction(item: ClassifiableItem, ctx: ClassifyContext = {}): ActionSuggestion | null {
  if (item.actionState === 'actionable') return { kind: 'reply', reason: 'Marked by you' };
  if (item.actionState === 'dismissed' || item.actionState === 'reviewed') return null;
  if (isOutgoing(item, ctx)) return null;
  const subject = item.subject || '';
  const head = `${subject} ${item.summary || ''}`;
  const from = item.sender || '';
  const due = DATE.test(head) ? extractDue(head, ctx.now) : '';
  const bulk = BULK_SENDER.test(from) || has(head, /\b(unsubscribe|newsletter|view in browser)\b/i);

  if (has(head, /\b(payment (due|failed|declined)|amount due|past due|overdue|pay (now|by)|balance due|final notice)\b/i)) return { kind: 'financial', reason: 'Payment or balance due', due };
  if (has(head, /\b(appointment|reservation|rsvp|reschedule|confirm (your )?(appointment|attendance))\b/i) && !bulk) return { kind: 'appointment', reason: 'Appointment-related', due };
  if (bulk) return null;
  if (has(head, /(\?|\b(please (reply|respond|confirm|let me know|advise|review|send)|can you|could you|would you|let me know|waiting for (your|a) (reply|response)|get back to me|rsvp|your thoughts|need (you|your)|action required|follow(ing)? up)\b)/i)) return { kind: 'reply', reason: has(head, /\?/) ? 'Contains a question or request' : 'Request language', due };
  if (has(head, /\b(deadline|due (date|by|on)|by (end of|eod|friday|monday)|sign (up|and return)|submit|complete (the|your)|to-?do|reminder)\b/i)) return { kind: 'task', reason: 'Mentions a deadline or to-do', due };
  return null;
}
