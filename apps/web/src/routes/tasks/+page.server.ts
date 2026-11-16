import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { buildRows } from '$lib/server/inbox';
import { filterTasks, isIsoDate, taskCounts, bucketOf, type TaskFilter, type TaskSort } from '$lib/server/tasks';

const FILTERS: TaskFilter[] = ['open', 'today', 'overdue', 'upcoming', 'nodate', 'done', 'all'];
const SORTS: TaskSort[] = ['due', 'priority', 'created'];
const PRIORITIES = ['high', 'normal', 'low'];

export const load: PageServerLoad = async ({ url }) => {
  const state = await readState();
  const today = new Date().toISOString().slice(0, 10);
  const filter = (FILTERS as string[]).includes(url.searchParams.get('f') || '') ? (url.searchParams.get('f') as TaskFilter) : 'open';
  const sort = (SORTS as string[]).includes(url.searchParams.get('sort') || '') ? (url.searchParams.get('sort') as TaskSort) : 'due';
  const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const tasks = filterTasks(state.tasks, filter, sort, today).map((t) => {
    const row = t.emailKey ? byKey.get(t.emailKey) : undefined;
    return { ...t, bucket: bucketOf(t, today), email: row ? { subject: row.subject, pipelineId: row.pipelineId } : null };
  });
  // Emails flagged for follow-up in the inbox that don't have a task yet.
  const linked = new Set(state.tasks.map((t) => t.emailKey));
  const followUps = rows.filter((r) => r.followUp && !linked.has(r.key)).slice(0, 50).map((r) => ({ key: r.key, subject: r.subject, sender: r.sender, due: r.due }));
  return { tasks, filter, sort, counts: taskCounts(state.tasks, today), followUps, today };
};

const clean = (f: FormData) => ({
  title: String(f.get('title') || '').trim().slice(0, 200), due: String(f.get('due') || ''),
  priority: PRIORITIES.includes(String(f.get('priority'))) ? (String(f.get('priority')) as 'high' | 'normal' | 'low') : 'normal'
});

export const actions: Actions = {
  add: async ({ request }) => {
    const f = await request.formData();
    const { title, due, priority } = clean(f);
    const emailKey = String(f.get('emailKey') || '') || undefined;
    if (!title) return fail(400, { error: 'Enter a task.' });
    if (due && !isIsoDate(due)) return fail(400, { error: 'Invalid date.' });
    await updateState((s) => { s.tasks.push({ id: crypto.randomUUID(), title, due, priority, done: false, createdAt: new Date().toISOString(), emailKey }); });
    return { added: true };
  },
  edit: async ({ request }) => {
    const f = await request.formData();
    const id = String(f.get('id') || '');
    const { title, due, priority } = clean(f);
    if (!title) return fail(400, { error: 'Enter a task.' });
    if (due && !isIsoDate(due)) return fail(400, { error: 'Invalid date.' });
    let found = false;
    await updateState((s) => { const t = s.tasks.find((x) => x.id === id); if (t) { found = true; Object.assign(t, { title, due, priority }); } });
    return found ? { edited: id } : fail(404, { error: 'Task not found.' });
  },
  toggle: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { const t = s.tasks.find((x) => x.id === id); if (t) { t.done = !t.done; if (t.done) t.completedAt = new Date().toISOString(); else delete t.completedAt; } });
    return { toggled: id };
  },
  // Local tasks only; never touches a mailbox.
  remove: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { s.tasks = s.tasks.filter((x) => x.id !== id); });
    return { removed: id };
  }
};
