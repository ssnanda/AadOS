import { readState, updateState, type AadOSState, type MailRule, type MailRuleCondition } from './aados-store';
import type { SessionUser } from './auth';
import { markEmails } from './email-list';
import { buildRows, type InboxRow } from './inbox';

// AadOS email rules (Settings → Rules). Safety model, by design:
// - A rule acts automatically only on mail received AFTER it was created (mode 'auto').
// - Mode 'ask' never acts on its own: matches wait on the Rules page for Apply / Skip.
// - Existing mail is changed only when the owner presses "Apply now".
// - Delete = move to the mailbox's Trash (recoverable there). Every run is logged.

const RULES_USER: SessionUser = { id: 'rules', name: 'Rules', owner: true, permissions: [], mailboxes: 'all', ownAccounts: false };
const LOG_MAX = 100, SKIP_MAX = 1000;
export const ACTION_LABEL: Record<MailRule['action'], string> = { 'mark-read': 'Mark read', delete: 'Delete (to Trash)', 'importance-high': 'Mark important', 'follow-up': 'Follow-up', actionable: 'Pending action', reviewed: 'Reviewed' };
export const conditionsOf = (r: MailRule): MailRuleCondition[] => (r.conditions?.length ? r.conditions : [{ field: r.field, text: r.text }]);
export const describeRule = (r: MailRule) => `${conditionsOf(r).map((c) => `${c.field} contains “${c.text}”`).join(r.match === 'any' ? ' or ' : ' and ')} → ${ACTION_LABEL[r.action]}`;
const addressOf = (sender: string) => (sender.match(/<([^>]+)>/)?.[1] || sender.match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || sender).trim().toLowerCase();

/** Does this email match the rule, and would the action still change something? */
export function matches(rule: MailRule, row: InboxRow) {
  if (rule.accountId && row.accountId !== rule.accountId) return false;
  const hit = (c: MailRuleCondition) => (c.field === 'from' ? row.sender : c.field === 'subject' ? row.subject : row.to.join(' ')).toLowerCase().includes(c.text.toLowerCase());
  const conds = conditionsOf(rule);
  if (!(rule.match === 'any' ? conds.some(hit) : conds.every(hit))) return false;
  // Only when the action would still change something.
  if (rule.action === 'mark-read') return row.unread;
  if (rule.action === 'importance-high') return row.importance !== 'high';
  if (rule.action === 'follow-up') return !row.followUp;
  if (rule.action === 'reviewed') return !row.reviewed;
  return true;
}

/** Matches split into mail that arrived after the rule (new) and before it (existing); skipped keys left out. */
export function matchesOf(rule: MailRule, rows: InboxRow[]) {
  const skipped = new Set([...(rule.skipped || []), ...(rule.done || [])]), created = Date.parse(rule.createdAt) || 0;
  const fresh: InboxRow[] = [], existing: InboxRow[] = [];
  for (const r of rows) if (!skipped.has(r.key) && matches(rule, r)) (Date.parse(r.receivedAt) >= created ? fresh : existing).push(r);
  return { fresh, existing };
}

export const rowsOf = (state: AadOSState) => buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });

/** Apply a rule's action to these emails (mailbox first, then AadOS) and log it. */
export async function applyRule(rule: MailRule, keys: string[], how: 'auto' | 'manual') {
  if (!keys.length) return { count: 0 };
  const r = await markEmails(RULES_USER, keys, rule.action);
  const count = r.ok ? r.marked.length : 0, error = r.ok ? r.warning : r.error;
  const changed = r.ok ? r.marked : [];
  await updateState((s) => {
    // Remember what this rule handled, so it never acts on the same email twice.
    const saved = s.mailRules?.find((x) => x.id === rule.id);
    if (saved && changed.length) saved.done = [...new Set([...(saved.done || []), ...changed])].slice(-SKIP_MAX);
    s.mailRuleLog = [{ at: new Date().toISOString(), ruleId: rule.id, rule: describeRule(rule), action: rule.action, count, how, ...(error ? { error } : {}) }, ...(s.mailRuleLog || [])].slice(0, LOG_MAX);
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
      const keys = matchesOf(rule, rows).fresh.map((r) => r.key).filter((k) => !taken.has(k));
      keys.forEach((k) => taken.add(k));
      await applyRule(rule, keys, 'auto');
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
