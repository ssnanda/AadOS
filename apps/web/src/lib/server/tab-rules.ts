import { readState, updateState, type TabId, type TabRule, type TabRuleCondition } from './aados-store';
import type { SessionUser } from './auth';
import { TAB_BUILTIN, TABS, tabReason } from './inbox';
import { regexError, rowsOf } from './mail-rules';
import { keyAllowed } from './scope';

// Inbox tab rules (Leads, Scanned Docs, Rent Payments) on Settings → Rules: see the built-in detection, switch it
// off, add include / exclude conditions, and dry run what the tab catches. Tabs only label; nothing is changed in mail.

const IDS = TABS.map((t) => t.id);
const blank = (): TabRule => ({ builtIn: true, include: [], exclude: [] });

export async function tabsInfo(user: SessionUser | null) {
  if (!user?.owner) return { ok: false as const, error: 'Only the owner can see tab rules.' };
  const state = await readState();
  return { ok: true as const, tabs: TABS.map((t) => ({ ...t, builtInText: TAB_BUILTIN[t.id], rule: { ...blank(), ...(state.tabRules?.[t.id] || {}) } })) };
}

function clean(list: unknown): TabRuleCondition[] | string {
  const out: TabRuleCondition[] = [];
  for (const c of (Array.isArray(list) ? list : []).slice(0, 20) as TabRuleCondition[]) {
    const text = String(c?.text || '').trim().slice(0, 300), field = c?.field, op = c?.op === 'regex' ? 'regex' : 'contains';
    if (!text) continue;
    if (!['from', 'subject', 'to'].includes(field)) return 'Unknown field.';
    if (op === 'regex') { const e = regexError(text); if (e) return e; } else if (text.length < 2) return 'Each condition needs at least 2 characters.';
    out.push({ field, op, text });
  }
  return out;
}
function ruleFrom(input: { builtIn?: unknown; include?: unknown; exclude?: unknown }): TabRule | string {
  const include = clean(input.include), exclude = clean(input.exclude);
  if (typeof include === 'string') return include;
  if (typeof exclude === 'string') return exclude;
  return { builtIn: input.builtIn !== false, include, exclude };
}

export async function tabUpdate(user: SessionUser | null, tab: string, input: { builtIn?: unknown; include?: unknown; exclude?: unknown }) {
  if (!user?.owner) return { ok: false as const, error: 'Only the owner can edit tab rules.' };
  if (!IDS.includes(tab as TabId)) return { ok: false as const, error: 'Unknown tab.' };
  const rule = ruleFrom(input);
  if (typeof rule === 'string') return { ok: false as const, error: rule };
  await updateState((s) => { s.tabRules = { ...(s.tabRules || {}), [tab]: rule }; });
  return { ok: true as const, message: 'Tab rule saved.' };
}

/** Dry run of a tab (with unsaved edits): emails in it within `days` (0 = all), why, and what your excludes keep out. */
export async function tabDry(user: SessionUser | null, tab: string, input: { builtIn?: unknown; include?: unknown; exclude?: unknown }, days = 7) {
  if (!user?.owner) return { ok: false as const, error: 'Only the owner can test tab rules.' };
  if (!IDS.includes(tab as TabId)) return { ok: false as const, error: 'Unknown tab.' };
  const rule = ruleFrom(input);
  if (typeof rule === 'string') return { ok: false as const, error: rule };
  const state = await readState();
  const since = days > 0 ? Date.now() - days * 86_400_000 : 0;
  const rules = { [tab]: rule } as Partial<Record<TabId, TabRule>>;
  const all = rowsOf(state).filter((r) => keyAllowed(user, r.key)).map((r) => ({ r, why: tabReason(tab as TabId, r, rules) })).filter((x) => x.why).sort((a, b) => b.r.receivedAt.localeCompare(a.r.receivedAt));
  const inside = all.filter((x) => Date.parse(x.r.receivedAt) >= since);
  const shown = inside.filter((x) => x.why !== 'excluded');
  return {
    ok: true as const, days, total: shown.length, excluded: inside.length - shown.length, older: all.filter((x) => x.why !== 'excluded').length - shown.length,
    rows: inside.slice(0, 120).map(({ r, why }) => ({ key: r.key, subject: r.subject, sender: r.sender, receivedAt: r.receivedAt, accountEmail: r.accountEmail, why }))
  };
}
