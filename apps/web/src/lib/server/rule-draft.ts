import { readState, updateState, type AadOSState, type MailRule, type MailRuleCondition } from './aados-store';
import type { SessionUser } from './auth';
import { bodyTexts } from './body-index';
import type { InboxRow } from './inbox';
import { ACTION_LABEL, applyRule, conditionHit, describeRule, matchesLoaded, regexError, rowsOf } from './mail-rules';
import { createRuleCriteria } from './mail-tools';
import { keyAllowed } from './scope';

// "Create rule…" from one open email or several selected emails (phone reader / selection, web).
// draft():  candidate conditions the owner can tick and edit — sender, recipients, subject (exact, prefix, or a
//           regular expression for what similar subjects share) and, for one email, its body text to pick from.
// create(): makes the rule where the owner chose: AadOS (one account or all), or a native Gmail filter.
//           Zoho has no filter API, so it is listed but disabled. Same safety model as Settings → Rules.

export type Candidate = MailRuleCondition & { label: string; count: number; picked: boolean };
export type Target = { value: string; label: string; disabled?: string };
const FIELDS = ['from', 'subject', 'to', 'body'] as const;
const ACTIONS = Object.keys(ACTION_LABEL) as MailRule['action'][];
const addressOf = (sender: string) => (sender.match(/<([^>]+)>/)?.[1] || sender.match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || '').trim().toLowerCase();
const nameOf = (sender: string) => sender.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
const cleanSubject = (s: string) => s.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest common token subsequence of two token lists. */
function lcs(a: string[], b: string[]) {
  const m = a.length, n = b.length, dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  for (let i = 0, j = 0; i < m && j < n;) { if (a[i].toLowerCase() === b[j].toLowerCase()) { out.push(a[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return out;
}
/** Common start of all strings, cut back to a word boundary. */
function commonPrefix(list: string[]) {
  let p = list[0] || '';
  for (const s of list) while (p && !s.toLowerCase().startsWith(p.toLowerCase())) p = p.slice(0, -1);
  return p.length < list[0].length ? p.replace(/\s*\S*$/, '').replace(/[\s:|–-]+$/, '') : p;
}
/** Subject ideas: exact text, shared prefix, and a regular expression for what the subjects share (digits generalised). */
function subjectCandidates(subjects: string[]): Omit<Candidate, 'count'>[] {
  const out: Omit<Candidate, 'count'>[] = [];
  const uniq = [...new Set(subjects.map((s) => s.toLowerCase()))];
  if (uniq.length === 1) {
    out.push({ field: 'subject', op: 'contains', text: subjects[0], label: 'Subject is this text', picked: false });
    const head = subjects[0].split(/\s*[:|–]\s+|\s+-\s+/)[0];
    if (head.length >= 4 && head.length < subjects[0].length) out.push({ field: 'subject', op: 'contains', text: head, label: 'Subject starts like this', picked: true });
    else out[0].picked = true;
    if (/\d/.test(subjects[0])) out.push({ field: 'subject', op: 'regex', text: esc(subjects[0]).replace(/\d+/g, '\\d+'), label: 'Same subject, any numbers', picked: false });
    return out;
  }
  const prefix = commonPrefix(subjects);
  if (prefix.length >= 4) out.push({ field: 'subject', op: 'contains', text: prefix, label: 'Subjects start with', picked: true });
  let common = subjects[0].split(/\s+/);
  for (const s of subjects.slice(1)) common = lcs(common, s.split(/\s+/));
  common = common.filter((t) => t.replace(/\W/g, '').length >= 2);
  if (common.length) out.push({ field: 'subject', op: 'regex', text: common.map(esc).join('.*'), label: 'Pattern shared by these subjects', picked: !out.length });
  return out;
}

async function rowsFor(user: SessionUser | null, keys: string[]) {
  const state = await readState();
  const wanted = new Set(keys.filter((k) => keyAllowed(user, k)));
  const all = rowsOf(state);
  return { state, all, rows: all.filter((r) => wanted.has(r.key)) };
}
const countOf = (c: MailRuleCondition, all: InboxRow[], accountIds: string[]) => (c.field === 'body' ? 0 : all.filter((r) => accountIds.includes(r.accountId) && conditionHit(c, r)).length);

function targetsFor(state: AadOSState, accountIds: string[]): Target[] {
  const acct = (id: string) => state.accounts.find((a) => a.id === id);
  const t: Target[] = [];
  if (accountIds.length === 1) {
    const a = acct(accountIds[0]);
    if (a?.provider === 'gmail') t.push(a.canFilter ? { value: `gmail:${a.id}`, label: `Gmail filter · ${a.email}` } : { value: `gmail:${a.id}`, label: `Gmail filter · ${a.email}`, disabled: 'Filter access not granted (Settings → Emails, “Allow changes”).' });
  }
  for (const id of accountIds) { const a = acct(id); if (a?.provider === 'zoho') t.push({ value: `zoho:${id}`, label: `Zoho filter · ${a.email}`, disabled: 'Zoho’s API cannot create filters. Use an AadOS rule, or Zoho Mail → Settings → Filters.' }); }
  for (const id of accountIds) t.push({ value: `aados:${id}`, label: `AadOS · ${acct(id)?.email || id}` });
  t.push({ value: 'aados:', label: 'AadOS · all accounts' });
  return t;
}

/** Candidate conditions, targets and actions for "Create rule…" on these emails. */
export async function draft(user: SessionUser | null, keys: string[]) {
  const { state, all, rows } = await rowsFor(user, keys);
  if (!rows.length) return { ok: false as const, error: 'Choose at least one email.' };
  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const cands: Omit<Candidate, 'count'>[] = [];
  // Sender: same address, else same domain, else same display name.
  const addrs = [...new Set(rows.map((r) => addressOf(r.sender)).filter(Boolean))];
  if (addrs.length === 1) cands.push({ field: 'from', op: 'contains', text: addrs[0], label: 'From this sender', picked: true });
  else {
    const domains = [...new Set(addrs.map((a) => a.split('@')[1]))];
    if (domains.length === 1 && addrs.length === rows.length) cands.push({ field: 'from', op: 'contains', text: `@${domains[0]}`, label: 'From this domain', picked: true });
    const names = [...new Set(rows.map((r) => nameOf(r.sender).toLowerCase()))];
    if (names.length === 1 && names[0] && !names[0].includes('@')) cands.push({ field: 'from', op: 'contains', text: nameOf(rows[0].sender), label: 'From this name', picked: !domains.length || domains.length > 1 });
  }
  // Recipients every email was sent to.
  const common = rows.map((r) => new Set(r.to.map((t) => t.toLowerCase()))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  for (const to of [...common].slice(0, 3)) cands.push({ field: 'to', op: 'contains', text: to, label: 'Sent to', picked: false });
  cands.push(...subjectCandidates(rows.map((r) => cleanSubject(r.subject))));
  // One email: its body text, to pick a phrase from (search index, else read from the mailbox).
  let body = '';
  if (rows.length === 1) {
    const r = rows[0];
    const text = (await bodyTexts(state, [r], { fetch: true })).get(r.key) || '';
    const lead = `${r.subject} ${r.sender}`;
    body = (text.startsWith(lead) ? text.slice(lead.length) : text).replace(/^\s*\S+@\S+\s*/, '').trim().slice(0, 3000);
  }
  return {
    ok: true as const, count: rows.length, accountIds, body,
    candidates: cands.map((c) => ({ ...c, count: countOf(c, all, accountIds) })) as Candidate[],
    targets: targetsFor(state, accountIds),
    actions: ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] }))
  };
}

export type RuleInput = { conditions: MailRuleCondition[]; match?: 'all' | 'any'; action: string; target: string; mode?: string; archive?: boolean; applyExisting?: boolean };
/** Validated conditions or an error message. */
function validate(input: RuleInput): { conditions: MailRuleCondition[]; action: MailRule['action'] } | string {
  const conditions = (input.conditions || []).slice(0, 6).map((c) => ({ field: c.field, op: c.op === 'regex' ? 'regex' as const : 'contains' as const, text: String(c.text || '').trim().slice(0, 300) })).filter((c) => c.text);
  if (!conditions.length) return 'Pick at least one condition.';
  for (const c of conditions) {
    if (!FIELDS.includes(c.field)) return 'Unknown condition.';
    if (c.op === 'regex') { const e = regexError(c.text); if (e) return e; }
    else if (c.text.length < 2) return 'Each condition needs at least 2 characters.';
  }
  if (!ACTIONS.includes(input.action as MailRule['action'])) return 'Choose an action.';
  return { conditions, action: input.action as MailRule['action'] };
}
const ruleOf = (input: RuleInput, v: { conditions: MailRuleCondition[]; action: MailRule['action'] }, accountId: string): MailRule => ({
  id: crypto.randomUUID(), field: v.conditions[0].field, text: v.conditions[0].text, conditions: v.conditions, match: input.match === 'any' ? 'any' : 'all',
  action: v.action, accountId, mode: input.mode === 'auto' ? 'auto' : 'ask', enabled: true, createdAt: new Date().toISOString()
});

/** How many stored emails the rule would match now (body conditions use the search index). */
export async function preview(user: SessionUser | null, input: RuleInput) {
  const v = validate(input);
  if (typeof v === 'string') return { ok: false as const, error: v };
  const state = await readState();
  const accountId = input.target.startsWith('aados:') || input.target.startsWith('gmail:') ? input.target.split(':')[1] || '' : '';
  const rule = { ...ruleOf(input, v, accountId), createdAt: new Date().toISOString() };
  const rows = rowsOf(state).filter((r) => keyAllowed(user, r.key));
  const m = await matchesLoaded(rule, rows, state);
  return { ok: true as const, count: m.existing.length, label: describeRule(rule) };
}

/** Create the rule at the chosen target; optionally apply an AadOS rule to existing matches right away. */
export async function create(user: SessionUser | null, input: RuleInput): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!user?.owner) return { ok: false, error: 'Only the owner can create rules.' };
  const v = validate(input);
  if (typeof v === 'string') return { ok: false, error: v };
  const [kind, accountId = ''] = String(input.target || '').split(':');
  if (kind === 'zoho') return { ok: false, error: 'Zoho’s API cannot create filters. Pick an AadOS rule, or set it up in Zoho Mail → Settings → Filters.' };
  if (kind === 'gmail') {
    if (v.conditions.some((c) => c.op === 'regex')) return { ok: false, error: 'Gmail filters do not support patterns. Use “contains”, or pick an AadOS rule.' };
    if (input.match === 'any' && v.conditions.length > 1) return { ok: false, error: 'Gmail filters need all conditions to match. Pick an AadOS rule for “any”.' };
    if (v.action !== 'mark-read') return { ok: false, error: 'Gmail filters here can mark read (and skip the inbox). For other actions pick an AadOS rule.' };
    const criteria: { from?: string; to?: string; subject?: string; query?: string } = {};
    for (const c of v.conditions) {
      const f = c.field;
      if (f === 'body') criteria.query = [criteria.query, `"${c.text.replace(/"/g, '')}"`].filter(Boolean).join(' ');
      else criteria[f] = c.text;
    }
    try { await createRuleCriteria(accountId, criteria, { markRead: true, archive: Boolean(input.archive) }); }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Gmail filter failed.' }; }
    return { ok: true, message: 'Gmail filter created. Gmail applies it to new mail.' };
  }
  if (kind !== 'aados') return { ok: false, error: 'Choose where the rule lives.' };
  const rule = ruleOf(input, v, accountId);
  await updateState((s) => { s.mailRules = [...(s.mailRules || []), rule]; });
  let extra = '';
  if (input.applyExisting) {
    const state = await readState();
    const m = await matchesLoaded(rule, rowsOf(state).filter((r) => keyAllowed(user, r.key)), state);
    const r = await applyRule(rule, m.existing.map((x) => x.key), 'manual');
    extra = ` ${ACTION_LABEL[rule.action]}: ${r.count} existing email${r.count === 1 ? '' : 's'}.${r.error ? ` ${r.error}` : ''}`;
  }
  return { ok: true, message: `Rule created (${rule.mode === 'auto' ? 'Auto' : 'Ask first'}).${extra}` };
}
