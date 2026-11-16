import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { buildRows } from '$lib/server/inbox';
import { allTags, filterTasks, findDuplicate, isIsoDate, isTime, parseTags, taskCounts, bucketOf, type TaskFilter, type TaskSort } from '$lib/server/tasks';
import { tick } from '$lib/server/reminders';
import { todayIn } from '$lib/calendar/view';

const FILTERS: TaskFilter[] = ['open', 'today', 'overdue', 'upcoming', 'nodate', 'done', 'all'];
const SORTS: TaskSort[] = ['due', 'priority', 'created'];
const PRIORITIES = ['high', 'normal', 'low'];

export const load: PageServerLoad = async ({ url }) => {
  const state = await readState();
  const today = todayIn(state.prefs.timeZone);
  const filter = (FILTERS as string[]).includes(url.searchParams.get('f') || '') ? (url.searchParams.get('f') as TaskFilter) : 'open';
  const sort = (SORTS as string[]).includes(url.searchParams.get('sort') || '') ? (url.searchParams.get('sort') as TaskSort) : 'due';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const tags = allTags(state.tasks);
  const tag = tags.includes(url.searchParams.get('tag') || '') ? url.searchParams.get('tag')! : '';
  const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const events = new Map(state.events.map((e) => [e.id, e]));
  const tasks = filterTasks(state.tasks, filter, sort, today, { q, tag }).map((t) => {
    const row = t.emailKey ? byKey.get(t.emailKey) : undefined;
    const [eventId, occ] = (t.eventKey || '').split('|');
    const event = eventId ? events.get(eventId) : undefined;
    return { ...t, bucket: bucketOf(t, today), email: row ? { subject: row.subject, href: `/emails?view=all&q=${encodeURIComponent(row.subject.slice(0, 60))}` } : null,
      event: t.eventKey ? { title: event?.title || 'Calendar event', href: `/calendar?view=day&date=${(occ || '').slice(0, 10)}` } : null };
  });
  // Emails flagged for follow-up in the inbox that don't have a task yet.
  const linked = new Set(state.tasks.map((t) => t.emailKey));
  const followUps = rows.filter((r) => r.followUp && !linked.has(r.key)).slice(0, 50).map((r) => ({ key: r.key, subject: r.subject, sender: r.sender, due: r.due }));
  return { tasks, filter, sort, q, tag, tags, counts: taskCounts(state.tasks, today), followUps, today };
};

function clean(f: FormData) {
  const due = String(f.get('due') || ''), dueTime = String(f.get('dueTime') || '');
  return {
    title: String(f.get('title') || '').trim().slice(0, 200), due, dueTime: due ? dueTime : '',
    priority: PRIORITIES.includes(String(f.get('priority'))) ? (String(f.get('priority')) as 'high' | 'normal' | 'low') : 'normal',
    notes: String(f.get('notes') || '').trim().slice(0, 2000), tags: parseTags(String(f.get('tags') || ''))
  };
}
const invalid = (v: ReturnType<typeof clean>) => !v.title ? 'Enter a task.' : v.due && !isIsoDate(v.due) ? 'Invalid date.' : v.dueTime && !isTime(v.dueTime) ? 'Invalid time.' : '';

export const actions: Actions = {
  add: async ({ request }) => {
    const f = await request.formData();
    const v = clean(f);
    const emailKey = String(f.get('emailKey') || '') || undefined, eventKey = String(f.get('eventKey') || '') || undefined;
    const problem = invalid(v);
    if (problem) return fail(400, { error: problem });
    let duplicate = '';
    await updateState((s) => {
      // Same title + due date, or already linked to this email/event: don't create a second copy (force=1 overrides).
      const existing = f.get('force') === '1' ? undefined : findDuplicate(s.tasks, { title: v.title, due: v.due, emailKey, eventKey });
      if (existing) { duplicate = existing.title; return; }
      s.tasks.push({ id: crypto.randomUUID(), title: v.title, due: v.due, priority: v.priority, done: false, createdAt: new Date().toISOString(), emailKey, eventKey, ...(v.dueTime ? { dueTime: v.dueTime } : {}), ...(v.notes ? { notes: v.notes } : {}), ...(v.tags.length ? { tags: v.tags } : {}) });
      tick(s);
    });
    return duplicate ? fail(409, { error: `Already on your list: “${duplicate}”.`, duplicate: true, values: { ...v, tags: v.tags.join(', '), emailKey: emailKey || '', eventKey: eventKey || '' } }) : { added: true };
  },
  edit: async ({ request }) => {
    const f = await request.formData();
    const id = String(f.get('id') || '');
    const v = clean(f);
    const problem = invalid(v);
    if (problem) return fail(400, { error: problem });
    let found = false;
    await updateState((s) => {
      const t = s.tasks.find((x) => x.id === id);
      if (!t) return;
      found = true;
      Object.assign(t, { title: v.title, due: v.due, priority: v.priority, dueTime: v.dueTime || undefined, notes: v.notes || undefined, tags: v.tags.length ? v.tags : undefined });
      tick(s);
    });
    return found ? { edited: id } : fail(404, { error: 'Task not found.' });
  },
  toggle: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { const t = s.tasks.find((x) => x.id === id); if (t) { t.done = !t.done; if (t.done) t.completedAt = new Date().toISOString(); else delete t.completedAt; tick(s); } });
    return { toggled: id };
  },
  // Local tasks only; never touches a mailbox or calendar.
  remove: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { s.tasks = s.tasks.filter((x) => x.id !== id); tick(s); });
    return { removed: id };
  }
};
