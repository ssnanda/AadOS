import { json } from '@sveltejs/kit';
import { readState } from '$lib/server/aados-store';
import { buildRows, queryInbox } from '$lib/server/inbox';
import { scopeState } from '$lib/server/scope';

// Mail metrics for the iPhone home-screen widgets (the app saves this for the widget extension).
// Shared-mailbox unread is added by the app (it already loads it). All read-only.
const dayOf = (iso: string | number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export const GET = async ({ locals }) => {
  const raw = await readState();
  const state = scopeState(raw, locals.user);
  const tz = state.prefs.timeZone || 'America/New_York';
  const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
  const { counts } = queryInbox(rows, { view: 'all', pageSize: 1 }, undefined, undefined, state.tabRules);
  const today = dayOf(Date.now(), tz);
  // Received per day, last 7 days (oldest first), and today's split.
  const days = Array.from({ length: 7 }, (_, i) => dayOf(Date.now() - (6 - i) * 86_400_000, tz));
  const perDay = new Map(days.map((d) => [d, { day: d, received: 0, unread: 0 }]));
  for (const r of rows) { const e = perDay.get(dayOf(r.receivedAt, tz)); if (e) { e.received++; if (r.unread) e.unread++; } }
  const unreadRows = rows.filter((r) => r.unread);
  const accounts = state.accounts.filter((a) => !a.paused).map((a) => ({ id: a.id, email: a.email, provider: a.provider, unread: unreadRows.filter((r) => r.accountId === a.id).length })).sort((a, b) => b.unread - a.unread);
  const rulesToday = (state.mailRuleLog || []).filter((l) => dayOf(l.at, tz) === today);
  return json({
    at: new Date().toISOString(),
    unread: counts.unread,
    receivedToday: perDay.get(today)?.received || 0,
    week: [...perDay.values()],
    accounts,
    tabs: { leads: counts.leads, scans: counts.scans, rent: counts.rent },
    rulesToday: { actions: rulesToday.reduce((n, l) => n + l.count, 0), read: rulesToday.filter((l) => l.action === 'mark-read').reduce((n, l) => n + l.count, 0), trashed: rulesToday.filter((l) => l.action === 'delete').reduce((n, l) => n + l.count, 0) },
    latest: unreadRows.slice(0, 10).map((r) => ({ key: r.key, sender: (r.sender.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || r.sender), subject: r.subject, at: r.receivedAt, account: r.accountEmail }))
  }, { headers: { 'cache-control': 'no-store' } });
};
