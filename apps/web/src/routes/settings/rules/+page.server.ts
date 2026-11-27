import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { readState, updateState, type MailRule } from '$lib/server/aados-store';
import { createRule as createGmailRule, removeRule as removeGmailRule, rules as gmailRules } from '$lib/server/mail-tools';
import { ACTION_LABEL, applyRule, describeRule, matchesOf, rowsOf, skipKeys, suggestions } from '$lib/server/mail-rules';

// Settings → Rules: every email rule in one place.
//   Suggestions (owner picks action, where it lives, and auto vs ask) · AadOS rules · native Gmail filters ·
//   Zoho (native filters live in Zoho Mail; not readable through its API) · built-in AadOS behaviour (read-only) · activity.

const FIELDS = ['from', 'subject', 'to'] as const, ACTIONS = ['mark-read', 'delete', 'importance-high'] as const;

/** Built-in AadOS rules, read-only. Keep in step with categories.ts, inbox.ts and the preview/sync code. */
const BUILT_IN: { group: string; rules: [string, string][] }[] = [
  { group: 'Reading', rules: [
    ['Opening an email', 'Marks it read in AadOS and in the mailbox (accounts with change access).'],
    ['Unread / Unread & close', 'Keeps it unread in AadOS and the mailbox.'],
    ['Background', 'Unread bodies are prefetched and all email text is indexed for search. Read-only: nothing is marked read, moved or deleted.']
  ] },
  { group: 'Categories (automatic labels, AadOS only)', rules: [
    ['Orders and Deliveries / Shopping', 'Subject mentions an order, shipment, tracking or delivery.'],
    ['Receipts', 'Subject mentions a receipt, invoice or purchase.'],
    ['Payments', 'Payment received/confirmed/failed/due, autopay, "you paid".'],
    ['Bills', 'Bill, statement ready, amount/balance due, past due, pay now.'],
    ['Subscriptions / Renewals', 'Subscription, plan, membership, trial; renewal or expiry wording.'],
    ['Appointments / Travel', 'Appointment, reservation, booking; flight, hotel, itinerary, check-in.'],
    ['Newsletters', 'Newsletter or digest wording, or an unsubscribe link.'],
    ['Promotions', '% off, sale, deals, coupon, promo code, free shipping, limited time.'],
    ['Notifications', 'Security alerts, codes, sign-ins; or an automated sender (no-reply, alerts, updates…).'],
    ['Family / Personal', 'Sender matches a family name; person-to-person mail that is not bulk.'],
    ['Important / Needs Reply', 'Importance and reply detection from sender and wording.']
  ] },
  { group: 'Inbox tabs', rules: [
    ['Unread', 'Every unread email.'],
    ['Recent', 'The newest 10 emails.'],
    ['Leads', 'Listing-site prospects (Zillow, Trulia, HotPads, Apartments.com, Rent.com, Zumper, Realtor, Redfin, …) and Rentec applications.'],
    ['Scanned Docs', 'Subject "Scan from …" or the office printer relay sender.'],
    ['Rent Payments', 'Money received via Cash App, Zelle, Venmo, PayPal or Rentec EasyPay, and tenants\' rent emails.']
  ] },
  { group: 'Saved value', rules: [
    ['Coupon', 'Detected only with expiry wording plus a concrete date.'],
    ['Gift card', 'Manual only.']
  ] }
];

export const load: PageServerLoad = async ({ url }) => {
  const state = await readState();
  const rows = rowsOf(state);
  const accounts = state.accounts.map((a) => ({ id: a.id, email: a.email || a.id, provider: a.provider, canFilter: Boolean(a.canFilter), canModify: Boolean(a.canModify), dataCenter: state.zoho.dataCenter || 'com' }));
  // Native Gmail filters, live from Gmail (one call per account that granted filter access).
  const gmail = [];
  for (const a of accounts.filter((x) => x.provider === 'gmail')) {
    if (!a.canFilter) { gmail.push({ account: a, filters: [], labels: [], error: 'Filter access not granted (Settings → Emails & Calendar → reconnect with “Allow changes”).' }); continue; }
    try { const r = await gmailRules(a.id); gmail.push({ account: a, filters: r.filters, labels: r.labels, error: '' }); }
    catch (cause) { gmail.push({ account: a, filters: [], labels: [], error: cause instanceof Error ? cause.message : 'Could not load Gmail filters.' }); }
  }
  const covered = gmail.flatMap((g) => g.filters.map((f) => f.criteria.from || '').filter(Boolean));
  const rules = (state.mailRules || []).map((r) => {
    const m = matchesOf(r, rows);
    return { ...r, label: describeRule(r), fresh: m.fresh.length, existing: m.existing.length, sample: [...m.fresh, ...m.existing].slice(0, 5).map((x) => ({ subject: x.subject, sender: x.sender, receivedAt: x.receivedAt })) };
  });
  const views = state.pipelines.filter((p) => !p.system).map((p) => ({ id: p.id, name: p.name, parser: p.parser, enabled: p.enabled, folders: p.folders.map((f) => f.name).join(' + ') }));
  return {
    accounts, rules, gmail, views, builtIn: BUILT_IN, actionLabels: ACTION_LABEL,
    suggestions: suggestions(state, covered),
    log: (state.mailRuleLog || []).slice(0, 30),
    prefill: { text: url.searchParams.get('from') || '', account: url.searchParams.get('account') || '' }
  };
};

/** Validated rule fields from a form. */
function ruleFrom(form: FormData): Omit<MailRule, 'id' | 'createdAt' | 'enabled'> | string {
  const field = String(form.get('field') || 'from') as MailRule['field'], action = String(form.get('action') || '') as MailRule['action'];
  const text = String(form.get('text') || '').trim().slice(0, 200), mode = form.get('mode') === 'auto' ? 'auto' : 'ask';
  if (!FIELDS.includes(field) || !ACTIONS.includes(action)) return 'Choose what to match and an action.';
  if (text.length < 3) return 'Enter at least 3 characters to match.';
  return { field, text, action, mode, accountId: String(form.get('accountId') || '') };
}
const newRule = (r: Omit<MailRule, 'id' | 'createdAt' | 'enabled'>): MailRule => ({ ...r, id: crypto.randomUUID(), createdAt: new Date().toISOString(), enabled: true });

export const actions: Actions = {
  /** AadOS rule from the form. */
  create: async ({ request }) => {
    const r = ruleFrom(await request.formData());
    if (typeof r === 'string') return fail(400, { error: r });
    await updateState((s) => { s.mailRules = [...(s.mailRules || []), newRule(r)]; });
    return { ok: 'Rule created. It acts on new mail only; use Apply now for existing mail.' };
  },
  /** From a suggestion: `target` = "aados:" (all accounts) | "aados:<account>" | "gmail:<account>" (native filter). */
  adopt: async ({ request }) => {
    const form = await request.formData();
    const target = String(form.get('target') || ''), [kind, accountId = ''] = target.split(':');
    const r = ruleFrom(form);
    if (typeof r === 'string') return fail(400, { error: r });
    if (kind === 'gmail') {
      if (r.action !== 'mark-read') return fail(400, { error: 'Gmail filters here can mark read, skip the inbox or label. For Delete or Important pick an AadOS rule.' });
      try { await createGmailRule(accountId, { field: r.field === 'to' ? 'from' : r.field, text: r.text, labelId: '', markRead: true, archive: form.get('archive') === 'on' }); }
      catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Gmail filter failed.' }); }
      return { ok: 'Gmail filter created (Gmail applies it to new mail).' };
    }
    await updateState((s) => { s.mailRules = [...(s.mailRules || []), newRule({ ...r, accountId })]; });
    return { ok: 'AadOS rule created. It acts on new mail only.' };
  },
  dismiss: async ({ request }) => {
    const address = String((await request.formData()).get('address') || '').toLowerCase();
    if (address) await updateState((s) => { s.mailRuleDismissed = [...new Set([...(s.mailRuleDismissed || []), address])]; });
    return { ok: 'Suggestion hidden.' };
  },
  toggle: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { const r = s.mailRules?.find((x) => x.id === id); if (r) r.enabled = !r.enabled; });
    return {};
  },
  mode: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { const r = s.mailRules?.find((x) => x.id === id); if (r) r.mode = r.mode === 'auto' ? 'ask' : 'auto'; });
    return {};
  },
  remove: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { s.mailRules = (s.mailRules || []).filter((x) => x.id !== id); });
    return { ok: 'Rule removed.' };
  },
  /** Apply by hand: which = "fresh" (waiting new mail) | "existing" (mail from before the rule). */
  apply: async ({ request }) => {
    const form = await request.formData();
    const state = await readState(), rule = state.mailRules?.find((x) => x.id === String(form.get('id')));
    if (!rule) return fail(404, { error: 'Rule not found.' });
    const m = matchesOf(rule, rowsOf(state)), list = form.get('which') === 'existing' ? m.existing : m.fresh;
    const r = await applyRule(rule, list.map((x) => x.key), 'manual');
    return r.error && !r.count ? fail(400, { error: r.error }) : { ok: `${ACTION_LABEL[rule.action]}: ${r.count} email${r.count === 1 ? '' : 's'}.${r.error ? ` ${r.error}` : ''}` };
  },
  skip: async ({ request }) => {
    const form = await request.formData();
    const state = await readState(), rule = state.mailRules?.find((x) => x.id === String(form.get('id')));
    if (!rule) return fail(404, { error: 'Rule not found.' });
    const m = matchesOf(rule, rowsOf(state)), list = form.get('which') === 'existing' ? m.existing : m.fresh;
    await skipKeys(rule.id, list.map((x) => x.key));
    return { ok: `${list.length} skipped; this rule will leave them alone.` };
  },
  gmailCreate: async ({ request }) => {
    const form = await request.formData();
    try {
      await createGmailRule(String(form.get('accountId') || ''), { field: form.get('field') === 'subject' ? 'subject' : 'from', text: String(form.get('text') || ''), labelId: String(form.get('labelId') || ''), markRead: form.get('markRead') === 'on', archive: form.get('archive') === 'on' });
    } catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Gmail filter failed.' }); }
    return { ok: 'Gmail filter created.' };
  },
  gmailRemove: async ({ request }) => {
    const form = await request.formData();
    try { await removeGmailRule(String(form.get('accountId') || ''), String(form.get('id') || '')); }
    catch (cause) { return fail(400, { error: cause instanceof Error ? cause.message : 'Could not delete the Gmail filter.' }); }
    return { ok: 'Gmail filter deleted.' };
  }
};
