import type { PageServerLoad } from './$types';
import { pipelineFolders, readState, visiblePipelines } from '$lib/server/aados-store';
import { isUnread } from '$lib/server/search';
import { buildRows, queryInbox } from '$lib/server/inbox';
import { overview } from '$lib/server/tasks';
import { dailyCalendar } from '$lib/server/daily';
import { effectiveAt, reminderLists } from '$lib/server/reminders';
import { validZone } from '$lib/calendar/model';
import { todayIn } from '$lib/calendar/view';
import { cachedBriefing } from '$lib/server/ai/briefing-service';
import { aiConfigured } from '$lib/server/ai/service';
import * as asanaApi from '$lib/server/asana';
import { calendarAccounts as visibleCalendarAccounts, scopeState } from '$lib/server/scope';
import { hasDatabase } from '$lib/server/aados-store';
import * as bb from '$lib/server/bluebubbles';
import { addressKey, categorize, isUnread as isUnreadChat, preview, SPAM_REPORT_NUMBER } from '$lib/messages-model';
import { db as financeDb, loadAll, portfolioSeries } from '$lib/server/finance/db';
import { currentSignals } from '$lib/server/finance/refresh';
import { billScore, type Attention } from '$lib/attention';

// A slow provider (BlueBubbles over the tunnel, Postgres) resolves to null instead of hanging the streamed card.
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
import { can } from '$lib/server/auth';
import { dayIn, dueDay, dueShort, stageOf } from '$lib/asana-model';

export const load: PageServerLoad = async ({ locals }) => {
  // Family members see only their mailboxes and the sections they were given.
  const user = locals.user;
  const full = scopeState(await readState(), user);
  const state = { ...full, events: can(user, 'calendar') ? full.events : [], tasks: can(user, 'tasks') ? full.tasks : [], reminders: can(user, 'reminders') ? full.reminders : [], accounts: full.accounts.map((a) => (!a.calendarOff && (a.ownerId || can(user, 'calendar')) ? a : { ...a, calendar: false })) };
  const visibleCal = visibleCalendarAccounts(full, user);
  const calOff = new Set(full.accounts.filter((a) => a.calendarOff || !visibleCal.has(a.id)).map((a) => a.id));
  // Only calendars this user may see: their own linked accounts, plus the owner's with the Calendar permission.
  state.events = full.events.filter((e) => visibleCal.has(e.accountId) && !calOff.has(e.accountId));
  const tiles = visiblePipelines(state).map((p) => {
    const items = state.items.filter((i) => i.pipelineId === p.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const unread = items.filter(isUnread);
    return {
      id: p.id, name: p.name, parser: p.parser, source: p.source, enabled: p.enabled, lastSync: p.lastSync, lastError: p.lastError,
      account: [...new Set(pipelineFolders(p).map((f) => state.accounts.find((a) => a.id === f.accountId)?.email).filter(Boolean))].join(', '), count: unread.length,
      kinds: Object.entries(items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 4),
      latest: items.slice(0, 3).map((i) => ({ id: i.id, subject: i.subject, sender: i.sender, receivedAt: i.receivedAt }))
    };
  });
  // Deduplicated across accounts and views; the page size of 1 keeps this cheap (only counts are used).
  const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
  const { counts } = queryInbox(rows, { view: 'all', pageSize: 1 });
  const brief = overview({ rows, tasks: state.tasks, accounts: state.accounts, today: todayIn(state.prefs.timeZone) }, 8);
  const tz = validZone(state.prefs.timeZone) ? state.prefs.timeZone : 'UTC';
  const cal = dailyCalendar(state.events, tz, Date.now(), state.calendarDisabled);
  const names = new Map(state.calendars.map((c) => [c.id, c.name]));
  const occ = (o: (typeof cal.todayEvents)[number]) => ({ key: `${o.id}|${o.occurrenceStart}`, title: o.title, start: o.start, end: o.end, allDay: o.allDay, location: o.location, calendar: names.get(o.calendarId) || '' });
  const rem = reminderLists(state.reminders);
  const calendarAccounts = state.accounts.filter((a) => a.calendar);
  const slim = (list: typeof rows) => list.map((r) => ({ key: r.key, subject: r.subject, sender: r.sender, due: r.due, account: r.accountEmail }));
  const inbox = { unread: counts.unread, needsReply: counts.needsReply, important: counts.important, bills: counts.categories['Bills'] || 0, renewals: counts.categories['Renewals'] || 0, receipts: counts.categories['Receipts'] || 0 };
  // Asana card, streamed (not awaited) so the dashboard never waits on Asana. "Dashboard due tasks only" (Asana page)
  // limits it to today/overdue; otherwise Incoming tasks show too.
  const asana = can(user, 'asana') && asanaApi.connectedState(state) ? (async () => {
    const today = dayIn(new Date(), tz), dueOnly = Boolean(state.prefs.asanaDashboardDueOnly);
    const all = await asanaApi.myTasks(await asanaApi.connection());
    const list = all.filter((t) => { const d = dueDay(t, tz); return (d && d <= today) || (!dueOnly && stageOf(t.sectionName) === 'incoming'); })
      .sort((a, b) => (dueDay(a, tz) || '9999').localeCompare(dueDay(b, tz) || '9999'));
    const attention: Attention[] = list.map((t) => ({ t, due: dueShort(t, today, tz) })).filter((x) => x.due.tone === 'overdue' || x.due.tone === 'today')
      .map(({ t, due }) => ({ id: `asana:${t.gid}`, source: 'asana', title: t.name, why: due.tone === 'overdue' ? `Overdue · was due ${due.text}` : `Due ${due.text}`, href: t.permalink || '/asana', external: Boolean(t.permalink), score: due.tone === 'overdue' ? 82 : 64 }));
    return { total: list.length, items: list.slice(0, 8).map((t) => ({ gid: t.gid, name: t.name, due: dueShort(t, today, tz), link: t.permalink })), attention };
  })().catch(() => null) : null;
  // ── Needs your attention: everything ranked in one list (synchronous sources here; Messages, Asana and Finance stream in).
  const today = cal.today;
  const emailHref = (r: { subject: string }) => `/emails?view=all&q=${encodeURIComponent(r.subject || '')}`;
  const attention: Attention[] = [
    ...rem.active.filter((r) => r.status === 'fired').map((r) => ({ id: `rem:${r.id}`, source: 'reminder' as const, title: r.title, why: 'Reminder went off', href: '/reminders', score: 88, at: effectiveAt(r) })),
    ...brief.tasksOverdue.map((t) => ({ id: `task:${t.id}`, source: 'task' as const, title: t.title, why: `Overdue · due ${t.due}`, href: '/tasks?f=overdue', score: 80 })),
    ...brief.tasksToday.map((t) => ({ id: `task:${t.id}`, source: 'task' as const, title: t.title, why: 'Due today', href: '/tasks?f=today', score: 62 })),
    ...brief.billsRenewals.map((r) => ({ id: `email:${r.key}`, source: 'bill' as const, title: r.subject || '(no subject)', why: `${r.due ? `Due ${r.due}` : 'Bill / renewal'} · ${r.sender}`, href: emailHref(r), score: billScore(r.due, today), at: r.receivedAt })),
    ...brief.needsReply.map((r) => ({ id: `email:${r.key}`, source: 'email' as const, title: r.subject || '(no subject)', why: `Waiting on your reply · ${r.sender}`, href: emailHref(r), score: 66, at: r.receivedAt })),
    ...brief.important.map((r) => ({ id: `email:${r.key}`, source: 'email' as const, title: r.subject || '(no subject)', why: `Important · ${r.sender}`, href: emailHref(r), score: 56, at: r.receivedAt })),
    ...brief.upcoming.map((r) => ({ id: `email:${r.key}`, source: 'email' as const, title: r.subject || '(no subject)', why: `Deadline ${r.due || 'soon'} · ${r.sender}`, href: emailHref(r), score: billScore(r.due, today) - 6, at: r.receivedAt })),
    ...[...brief.errors, ...calendarAccounts.filter((a) => a.calendarError).map((a) => ({ id: `cal-${a.id}`, label: `Calendar · ${a.email}`, message: a.calendarError! }))]
      .map((e) => ({ id: `sys:${e.id}`, source: 'system' as const, title: `${e.label} isn't syncing`, why: e.message.slice(0, 140), href: '/settings/emails', score: 50 }))
  ];
  // Messages (BlueBubbles): unread texts from real people first, then threads you read but never answered (3 days).
  // Spam, the 7726 report thread, codes and marketing never show here.
  const messages = can(user, 'messages') && bb.bbConfigured(full) ? withTimeout((async () => {
    const { chats, names } = await bb.chatsWithNames(await bb.bbConnection(), 80);
    const spam = new Set(full.messageSpam ?? []), readAt = full.messagesRead || {};
    const out: Attention[] = [];
    for (const c of chats) {
      if (!c.last || c.last.fromMe || c.participants.some((p) => spam.has(addressKey(p)) || addressKey(p) === SPAM_REPORT_NUMBER)) continue;
      const cat = categorize(c, names), unread = isUnreadChat(c, readAt), age = Date.now() - c.last.at;
      if (cat === 'marketing' || cat === 'codes' || cat === 'unknown' && !unread) continue;
      const text = preview(c.last).slice(0, 120);
      if (unread) out.push({ id: `msg:${c.guid}`, source: 'message', title: c.title, why: text, href: `/messages?chat=${encodeURIComponent(c.guid)}`, score: cat === 'personal' ? 84 : cat === 'health' ? 70 : cat === 'groups' ? 52 : 46, at: new Date(c.last.at).toISOString() });
      else if (cat === 'personal' && age < 3 * 86_400_000) out.push({ id: `msg:${c.guid}`, source: 'message', title: c.title, why: `You haven't replied · ${text}`, href: `/messages?chat=${encodeURIComponent(c.guid)}`, score: 60, at: new Date(c.last.at).toISOString() });
    }
    return out;
  })(), 9000) : null;
  // Finance pulse + insights (owner's finance permission only); never blocks the page.
  const finance = can(user, 'finance') && hasDatabase() ? withTimeout((async () => {
    const q = await financeDb(), data = await loadAll(q);
    if (!data.holdings.length && !data.properties.length) return null;
    const [{ signals, summary }, series] = await Promise.all([currentSignals(q, data), portfolioSeries(q)]);
    const prev = summary.netWorth - summary.dayChange;
    return {
      netWorth: summary.netWorth, dayChange: summary.dayChange, dayPct: prev > 0 ? (summary.dayChange / prev) * 100 : 0,
      spark: series.slice(-30).map((p) => p.total),
      attention: signals.filter((x) => x.score >= 40).sort((a, b) => b.score - a.score).slice(0, 4)
        .map((x) => ({ id: `fin:${x.id}`, source: 'finance' as const, title: x.title, why: x.next || x.why, href: '/finance', score: Math.round(30 + x.score * 0.4) }))
    };
  })(), 9000) : null;
  return {
    attention, messages, finance,
    greetingName: user?.name || '',
    asana,
    tiles, accounts: state.accounts.length, unread: counts.unread, inbox,
    tz,
    briefing: { cached: can(user, 'assistant') ? await cachedBriefing() : null, aiEnabled: state.ai.enabled, configured: aiConfigured(state) },
    calendar: { enabled: calendarAccounts.length, today: cal.today, todayEvents: cal.todayEvents.map(occ), next: cal.next ? occ(cal.next) : null, week: cal.week, weekTotal: cal.weekTotal,
      errors: calendarAccounts.filter((a) => a.calendarError).map((a) => ({ id: a.id, label: `${a.provider === 'gmail' ? 'Google' : 'Zoho'} Calendar · ${a.email}`, message: a.calendarError! })) },
    reminders: { waiting: rem.active.length, unread: rem.unread, items: [...rem.active, ...rem.upcoming].slice(0, 5).map((r) => ({ id: r.id, title: r.title, at: effectiveAt(r), fired: r.status === 'fired' })) },
    brief: { counts: brief.counts, important: slim(brief.important), needsReply: slim(brief.needsReply), billsRenewals: slim(brief.billsRenewals), upcoming: slim(brief.upcoming), tasksToday: brief.tasksToday.map((t) => ({ id: t.id, title: t.title })), tasksOverdue: brief.tasksOverdue.map((t) => ({ id: t.id, title: t.title, due: t.due })), errors: brief.errors }
  };
};
