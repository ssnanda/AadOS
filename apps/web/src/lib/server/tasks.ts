// Task bucketing/sorting and the daily overview. Pure (type-only imports) so it is unit-tested with `node --test`.
import type { Task } from './aados-store';
import type { InboxRow } from './inbox.ts';

export type TaskFilter = 'open' | 'today' | 'overdue' | 'upcoming' | 'nodate' | 'done' | 'all';
export type TaskSort = 'due' | 'priority' | 'created';
const RANK = { high: 0, normal: 1, low: 2 } as const;
export const priorityOf = (task: Pick<Task, 'priority'>) => task.priority || 'normal';

export type Bucket = 'overdue' | 'today' | 'upcoming' | 'nodate' | 'done';
export const bucketOf = (task: Pick<Task, 'due' | 'done'>, today: string): Bucket =>
  task.done ? 'done' : !task.due ? 'nodate' : task.due < today ? 'overdue' : task.due === today ? 'today' : 'upcoming';

export function taskCounts(tasks: Task[], today: string) {
  const counts = { open: 0, today: 0, overdue: 0, upcoming: 0, nodate: 0, done: 0, all: tasks.length };
  for (const task of tasks) { const b = bucketOf(task, today); counts[b]++; if (b !== 'done') counts.open++; }
  return counts;
}

export function filterTasks(tasks: Task[], filter: TaskFilter, sort: TaskSort, today: string, opts: { q?: string; tag?: string } = {}): Task[] {
  const terms = (opts.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (t: Task) => `${t.title} ${t.notes || ''} ${(t.tags || []).join(' ')}`.toLowerCase();
  const keep = tasks.filter((t) => (filter === 'all' || (filter === 'open' ? !t.done : bucketOf(t, today) === filter))
    && (!opts.tag || (t.tags || []).includes(opts.tag)) && terms.every((term) => hay(t).includes(term)));
  const due = (t: Task) => t.due || '9999-12-31';
  const cmp: Record<TaskSort, (a: Task, b: Task) => number> = {
    due: (a, b) => due(a).localeCompare(due(b)) || (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') || RANK[priorityOf(a)] - RANK[priorityOf(b)],
    priority: (a, b) => RANK[priorityOf(a)] - RANK[priorityOf(b)] || due(a).localeCompare(due(b)),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt)
  };
  // Open tasks always come before done ones.
  return [...keep].sort((a, b) => Number(a.done) - Number(b.done) || cmp[sort](a, b) || a.id.localeCompare(b.id));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** An open task that is the same thing: same linked email/event, or same title and due date. */
export function findDuplicate(tasks: Task[], candidate: { title: string; due?: string; emailKey?: string; eventKey?: string }, ignoreId = ''): Task | undefined {
  return tasks.find((t) => t.id !== ignoreId && !t.done && (
    (candidate.emailKey && t.emailKey === candidate.emailKey) || (candidate.eventKey && t.eventKey === candidate.eventKey)
    || (norm(t.title) === norm(candidate.title) && (t.due || '') === (candidate.due || ''))));
}

/** Tags: trimmed, lower-case, unique, at most 8 of 24 chars. */
export const parseTags = (value: string) => [...new Set(value.split(',').map((t) => t.trim().toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 8);
export const allTags = (tasks: Task[]) => [...new Set(tasks.flatMap((t) => t.tags || []))].sort();
export const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export type Overview = {
  important: InboxRow[]; needsReply: InboxRow[]; billsRenewals: InboxRow[]; upcoming: InboxRow[];
  tasksToday: Task[]; tasksOverdue: Task[]; counts: { important: number; needsReply: number; billsRenewals: number; upcoming: number };
  errors: { id: string; label: string; message: string }[];
};

/** Daily overview from real data only; every list is empty when there is nothing to show. */
export function overview(input: { rows: InboxRow[]; tasks: Task[]; accounts: { id: string; provider: string; email: string; lastError?: string }[]; today: string }, limit = 5): Overview {
  const { rows, tasks, today } = input;
  const important = rows.filter((r) => r.importance === 'high' && r.unread);
  const needsReply = rows.filter((r) => r.action === 'reply' && !r.reviewed);
  const bills = rows.filter((r) => (r.categories.includes('Bills') || r.categories.includes('Renewals')) && r.unread);
  const horizon = addDays(today, 14);
  const upcoming = rows.filter((r) => r.due && r.due >= today && r.due <= horizon && !r.reviewed).sort((a, b) => a.due.localeCompare(b.due));
  return {
    important: important.slice(0, limit), needsReply: needsReply.slice(0, limit), billsRenewals: bills.slice(0, limit), upcoming: upcoming.slice(0, limit),
    tasksToday: filterTasks(tasks, 'today', 'priority', today), tasksOverdue: filterTasks(tasks, 'overdue', 'due', today),
    counts: { important: important.length, needsReply: needsReply.length, billsRenewals: bills.length, upcoming: upcoming.length },
    errors: input.accounts.filter((a) => a.lastError).map((a) => ({ id: a.id, label: `${a.provider === 'gmail' ? 'Gmail' : 'Zoho'} · ${a.email}`, message: a.lastError! }))
  };
}
