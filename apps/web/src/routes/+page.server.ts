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

export const load: PageServerLoad = async () => {
  const state = await readState();
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
  const brief = overview({ rows, tasks: state.tasks, accounts: state.accounts, today: todayIn(state.prefs.timeZone) });
  const tz = validZone(state.prefs.timeZone) ? state.prefs.timeZone : 'UTC';
  const cal = dailyCalendar(state.events, tz, Date.now(), state.calendarDisabled);
  const names = new Map(state.calendars.map((c) => [c.id, c.name]));
  const occ = (o: (typeof cal.todayEvents)[number]) => ({ key: `${o.id}|${o.occurrenceStart}`, title: o.title, start: o.start, end: o.end, allDay: o.allDay, location: o.location, calendar: names.get(o.calendarId) || '' });
  const rem = reminderLists(state.reminders);
  const calendarAccounts = state.accounts.filter((a) => a.calendar);
  const slim = (list: typeof rows) => list.map((r) => ({ key: r.key, subject: r.subject, sender: r.sender, due: r.due, account: r.accountEmail }));
  const inbox = { unread: counts.unread, needsReply: counts.needsReply, important: counts.important, bills: counts.categories['Bills'] || 0, renewals: counts.categories['Renewals'] || 0, receipts: counts.categories['Receipts'] || 0 };
  return {
    tiles, accounts: state.accounts.length, unread: counts.unread, inbox,
    tz,
    briefing: { cached: await cachedBriefing(), aiEnabled: state.ai.enabled, configured: aiConfigured(state) },
    calendar: { enabled: calendarAccounts.length, today: cal.today, todayEvents: cal.todayEvents.map(occ), next: cal.next ? occ(cal.next) : null, week: cal.week, weekTotal: cal.weekTotal,
      errors: calendarAccounts.filter((a) => a.calendarError).map((a) => ({ id: a.id, label: `${a.provider === 'gmail' ? 'Google' : 'Zoho'} Calendar · ${a.email}`, message: a.calendarError! })) },
    reminders: { waiting: rem.active.length, unread: rem.unread, items: [...rem.active, ...rem.upcoming].slice(0, 5).map((r) => ({ id: r.id, title: r.title, at: effectiveAt(r), fired: r.status === 'fired' })) },
    brief: { counts: brief.counts, important: slim(brief.important), needsReply: slim(brief.needsReply), billsRenewals: slim(brief.billsRenewals), upcoming: slim(brief.upcoming), tasksToday: brief.tasksToday.map((t) => ({ id: t.id, title: t.title })), tasksOverdue: brief.tasksOverdue.map((t) => ({ id: t.id, title: t.title, due: t.due })), errors: brief.errors }
  };
};
