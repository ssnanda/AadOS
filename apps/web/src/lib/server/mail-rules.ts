import { readState, updateState, type AadOSState, type MailRule, type MailRuleCondition } from './aados-store';
import type { SessionUser } from './auth';
import { markEmails } from './email-list';
import { buildRows, type InboxRow } from './inbox';
import { bodyTexts } from './body-index';

// AadOS email rules (Settings → Rules). Safety model, by design:
// - A rule acts automatically only on mail received AFTER it was created (mode 'auto').
// - Mode 'ask' never acts on its own: matches wait on the Rules page for Apply / Skip.
// - Existing mail is changed only when the owner presses "Apply now".
// - Delete = move to the mailbox's Trash (recoverable there). Every run is logged.

const RULES_USER: SessionUser = { id: 'rules', name: 'Rules', owner: true, permissions: [], mailboxes: 'all', ownAccounts: false };
const LOG_MAX = 100, SKIP_MAX = 1000;
export const ACTION_LABEL: Record<MailRule['action'], string> = { 'mark-read': 'Mark read', delete: 'Delete (to Trash)', 'importance-high': 'Mark important', 'follow-up': 'Follow-up', actionable: 'Pending action', reviewed: 'Reviewed', 'save-coupon': 'Save as coupon' };
export const conditionsOf = (r: MailRule): MailRuleCondition[] => (r.conditions?.length ? r.conditions : [{ field: r.field, text: r.text }]);
const showCond = (c: MailRuleCondition) => (c.op === 'regex' ? `${c.field} matches /${c.text}/` : `${c.field} contains “${c.text}”`);
export const describeRule = (r: MailRule) => `${conditionsOf(r).map(showCond).join(r.match === 'any' ? ' or ' : ' and ')} → ${ACTION_LABEL[r.action]}${r.keepLatest ? ` · keep newest ${r.keepLatest}` : ''}`;
const addressOf = (sender: string) => (sender.match(/<([^>]+)>/)?.[1] || sender.match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || sender).trim().toLowerCase();

const regexCache = new Map<string, RegExp | null>();
const regexOf = (text: string) => {
  if (!regexCache.has(text)) { try { regexCache.set(text, new RegExp(text, 'i')); } catch { regexCache.set(text, null); } }
  return regexCache.get(text)!;
};
/** '' when the pattern is usable, else why not. */
export const regexError = (text: string) => { if (text.length > 300) return 'Pattern is too long.'; try { new RegExp(text, 'i'); return ''; } catch (e) { return `Invalid pattern: ${e instanceof Error ? e.message : ''}`; } };

/** One condition against one email (`body`: its plain text, when known). */
export function conditionHit(c: MailRuleCondition, row: InboxRow, body?: string) {
  const hay = c.field === 'from' ? row.sender : c.field === 'subject' ? row.subject : c.field === 'to' ? row.to.join(' ') : body;
  if (hay === undefined) return false;
  if (c.op === 'regex') return Boolean(regexOf(c.text)?.test(hay));
  return hay.toLowerCase().includes(c.text.toLowerCase());
}
export const needsBody = (r: MailRule) => conditionsOf(r).some((c) => c.field === 'body');

/** The rule's account and conditions hold for this email (whatever its current state). `bodies`: key → plain text. */
export function conditionsMatch(rule: MailRule, row: InboxRow, bodies?: Map<string, string>) {
  if (rule.accountId && row.accountId !== rule.accountId) return false;
  const conds = conditionsOf(rule), body = bodies?.get(row.key);
  const hit = (c: MailRuleCondition) => conditionHit(c, row, body);
  return rule.match === 'any' ? conds.some(hit) : conds.every(hit);
}
/** Would the action still change something on this email? */
export function actionApplies(rule: MailRule, row: InboxRow) {
  if (rule.action === 'mark-read') return row.unread;
  if (rule.action === 'importance-high') return row.importance !== 'high';
  if (rule.action === 'follow-up') return !row.followUp;
  if (rule.action === 'reviewed') return !row.reviewed;
  if (rule.action === 'save-coupon') return row.savedKind !== 'coupon';
  return true;
}

/** Keep newest N: matching emails beyond the newest `keepLatest` (skipped ones left alone), to move to Trash. */
export function trimKeys(rule: MailRule, rows: InboxRow[], bodies?: Map<string, string>) {
  if (!rule.keepLatest || rule.keepLatest < 1) return [] as string[];
  const skipped = new Set(rule.skipped || []);
  return rows.filter((r) => !skipped.has(r.key) && conditionsMatch(rule, r, bodies)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(rule.keepLatest).map((r) => r.key);
}
/** Does this email match the rule, and would the action still change something? */
export const matches = (rule: MailRule, row: InboxRow, bodies?: Map<string, string>) => conditionsMatch(rule, row, bodies) && actionApplies(rule, row);

/** Matches split into mail that arrived after the rule (new) and before it (existing); skipped/handled keys left out. */
export function matchesOf(rule: MailRule, rows: InboxRow[], bodies?: Map<string, string>) {
  const skipped = new Set([...(rule.skipped || []), ...(rule.done || [])]), created = Date.parse(rule.createdAt) || 0;
  const fresh: InboxRow[] = [], existing: InboxRow[] = [];
  for (const r of rows) if (!skipped.has(r.key) && matches(rule, r, bodies)) (Date.parse(r.receivedAt) >= created ? fresh : existing).push(r);
  return { fresh, existing };
}

/** Rows worth loading a body for: right account, and (match all) every non-body condition already holds. */
function bodyCandidates(rule: MailRule, rows: InboxRow[]) {
  const other = conditionsOf(rule).filter((c) => c.field !== 'body');
  return rows.filter((r) => (!rule.accountId || r.accountId === rule.accountId) && (rule.match === 'any' || other.every((c) => conditionHit(c, r))));
}
/** matchesOf, loading body text first when the rule has a body condition (search index; `fetch` also reads the mailbox). */
export async function matchesLoaded(rule: MailRule, rows: InboxRow[], state: AadOSState, fetch = false) {
  if (!needsBody(rule)) return matchesOf(rule, rows);
  return matchesOf(rule, rows, await bodyTexts(state, bodyCandidates(rule, rows), { fetch }));
}

/**
 * Dry run: every stored email the rule's conditions match within the last `days` (0 = all time), newest first,
 * regardless of when the rule was made or what it already handled. `older`: matches before the window.
 */
export async function dryRun(rule: MailRule, rows: InboxRow[], state: AadOSState, days = 7, limit = 100) {
  const since = days > 0 ? Date.now() - days * 86_400_000 : 0;
  const bodies = needsBody(rule) ? await bodyTexts(state, bodyCandidates(rule, rows)) : undefined;
  const hits = rows.filter((r) => conditionsMatch(rule, r, bodies)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const inside = hits.filter((r) => Date.parse(r.receivedAt) >= since);
  const trimmed = new Set(rule.keepLatest ? hits.slice(rule.keepLatest).map((r) => r.key) : []);
  return {
    days, total: inside.length, older: hits.length - inside.length, label: describeRule(rule),
    rows: inside.slice(0, limit).map((r) => ({ key: r.key, subject: r.subject, sender: r.sender, receivedAt: r.receivedAt, accountId: r.accountId, accountEmail: r.accountEmail, unread: r.unread, wouldChange: actionApplies(rule, r), wouldDelete: trimmed.has(r.key) }))
  };
}

export const rowsOf = (state: AadOSState) => buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });

/** Apply a rule's action to these emails (mailbox first, then AadOS) and log it. */
export async function applyRule(rule: MailRule, keys: string[], how: 'auto' | 'manual', op: string = rule.action) {
  if (!keys.length) return { count: 0 };
  const r = await markEmails(RULES_USER, keys, op);
  const count = r.ok ? r.marked.length : 0, error = r.ok ? r.warning : r.error;
  const changed = r.ok ? r.marked : [];
  await updateState((s) => {
    // Remember what this rule handled, so it never acts on the same email twice.
    const saved = s.mailRules?.find((x) => x.id === rule.id);
    if (saved && changed.length && op === rule.action) saved.done = [...new Set([...(saved.done || []), ...changed])].slice(-SKIP_MAX);
    s.mailRuleLog = [{ at: new Date().toISOString(), ruleId: rule.id, rule: op === rule.action ? describeRule(rule) : `${describeRule(rule)} (trim older → Trash)`, action: op, count, how, ...(error ? { error } : {}) }, ...(s.mailRuleLog || [])].slice(0, LOG_MAX);
  });
  return { count, error };
}

/** Matches the owner chose not to act on: never offered again for this rule. */
export async function skipKeys(ruleId: string, keys: string[]) {
  await updateState((s) => { const r = s.mailRules?.find((x) => x.id === ruleId); if (r) r.skipped = [...new Set([...(r.skipped || []), ...keys])].slice(-SKIP_MAX); });
}

declare global { var __aadosRulesRunning: boolean | undefined; }
/** Background, after a sync: enabled automatic rules act on NEW matching mail. One run at a time. */
export function runRules() {
  if (globalThis.__aadosRulesRunning) return;
  globalThis.__aadosRulesRunning = true;
  (async () => {
    const state = await readState();
    const auto = (state.mailRules || []).filter((r) => r.enabled && r.mode === 'auto');
    if (!auto.length) return;
    const rows = rowsOf(state), taken = new Set<string>();
    for (const rule of auto) {
      // Earlier rules win: an email is changed by at most one rule per run.
      // New mail is not in the search index yet: body conditions read it from the mailbox (read-only).
      const created = Date.parse(rule.createdAt) || 0;
      const bodies = needsBody(rule) ? await bodyTexts(state, bodyCandidates(rule, rows.filter((r) => Date.parse(r.receivedAt) >= created)), { fetch: true }) : undefined;
      const keys = matchesOf(rule, rows, bodies).fresh.map((r) => r.key).filter((k) => !taken.has(k));
      keys.forEach((k) => taken.add(k));
      await applyRule(rule, keys, 'auto');
      // Keep newest N: new matching mail arrived, so trim the older matches (Trash; undoable).
      const newHere = rows.some((r) => Date.parse(r.receivedAt) >= created && conditionsMatch(rule, r, bodies));
      if (rule.keepLatest && newHere) {
        const fresh = await readState();
        const all = rowsOf(fresh);
        const allBodies = needsBody(rule) ? await bodyTexts(fresh, bodyCandidates(rule, all)) : undefined;
        await applyRule(rule, trimKeys(rule, all, allBodies), 'auto', 'delete');
      }
    }
  })().catch((cause) => console.warn('[aados] rules run failed:', cause instanceof Error ? cause.message : cause)).finally(() => { globalThis.__aadosRulesRunning = false; });
}

export type Suggestion = { address: string; name: string; count: number; unread: number; accounts: string[]; action: MailRule['action']; reason: string };
/**
 * Rule ideas from the stored mail: senders of bulk mail (newsletters, promotions, notifications) that pile up unread.
 * Senders already covered by an AadOS rule, a Gmail filter (`covered`), or dismissed are left out.
 */
export function suggestions(state: AadOSState, covered: string[] = []): Suggestion[] {
  const bulk = new Set(['Newsletters', 'Promotions', 'Notifications']);
  const by = new Map<string, { name: string; count: number; unread: number; bulk: number; accounts: Set<string> }>();
  for (const r of rowsOf(state)) {
    const a = addressOf(r.sender);
    if (!a.includes('@')) continue;
    const e = by.get(a) ?? { name: r.sender.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || a, count: 0, unread: 0, bulk: 0, accounts: new Set<string>() };
    e.count++; if (r.unread) e.unread++; if (r.categories.some((c) => bulk.has(c))) e.bulk++; e.accounts.add(r.accountId);
    by.set(a, e);
  }
  const ruleTexts = [...(state.mailRules || []).flatMap((r) => conditionsOf(r).filter((c) => c.field === 'from').map((c) => c.text.toLowerCase())), ...covered.map((c) => c.toLowerCase())];
  const dismissed = new Set(state.mailRuleDismissed || []);
  const out: Suggestion[] = [];
  for (const [address, e] of by) {
    if (e.count < 5 || dismissed.has(address) || ruleTexts.some((t) => t && address.includes(t))) continue;
    const unreadShare = e.unread / e.count, bulkShare = e.bulk / e.count;
    if (bulkShare < 0.6 || unreadShare < 0.7) continue;
    const action: MailRule['action'] = e.count >= 10 && unreadShare >= 0.95 ? 'delete' : 'mark-read';
    out.push({ address, name: e.name, count: e.count, unread: e.unread, accounts: [...e.accounts], action, reason: `${e.unread} of ${e.count} unread · ${Math.round(bulkShare * 100)}% bulk` });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 20);
}
