// Asana task model shared by server and browser. Pure; unit-tested (tests/asana-model.test.ts).
// Workflow = the sections of the owner's My Tasks list: Incoming → To do → Doing → Done.

export type Stage = 'incoming' | 'todo' | 'doing' | 'done';
export const STAGES: { id: Stage; title: string }[] = [
  { id: 'incoming', title: 'Incoming' }, { id: 'todo', title: 'To do' }, { id: 'doing', title: 'Doing' }, { id: 'done', title: 'Done' }
];
const ALIASES: Record<Stage, string[]> = {
  incoming: ['incoming', 'recently assigned'], todo: ['to do', 'todo', 'to-do', 'acknowledged'], doing: ['doing', 'in progress'], done: ['done', 'complete', 'completed']
};
/** Stage of a My Tasks section by its name; null for sections outside the workflow. */
export function stageOf(sectionName: string | null | undefined): Stage | null {
  const n = (sectionName || '').trim().toLowerCase();
  return (Object.keys(ALIASES) as Stage[]).find((s) => ALIASES[s].includes(n)) ?? null;
}
/** The one button that moves a task out of its stage, and where it lands. */
export const NEXT: Record<Stage, { label: string; to: Stage } | null> = {
  incoming: { label: 'Acknowledge', to: 'todo' }, todo: { label: 'Start', to: 'doing' }, doing: { label: 'Done', to: 'done' }, done: null
};

// `recurrence` is undocumented but returned/accepted by the REST API. Shapes seen on real tasks:
// weekly {"type":"weekly","data":{"frequency":1,"days_of_week":[4]}}; monthly {"type":"monthly","data":{"frequency":1,"date":29}};
// monthly nth weekday {"type":"monthly","data":{"frequency":1,"days_of_week":[2],"nth_weekday":1}}; none {"type":"never","data":null}.
// days_of_week: 0 = Sunday … 6 = Saturday.
export type Recurrence = { type: 'never' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'periodically'; data: { frequency?: number; days_of_week?: number[]; date?: number; day?: number; month?: number; nth_weekday?: number; unit?: string } | null };
export const NO_REPEAT: Recurrence = { type: 'never', data: null };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n: number) => n === -1 ? 'last' : `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function isRecurring(r: Recurrence | null | undefined): r is Recurrence { return Boolean(r && r.type && r.type !== 'never'); }

/** "Repeats weekly on Mon, Tue", "Repeats monthly on day 15", "Repeats yearly on October 15", … */
export function recurrenceSummary(r: Recurrence | null | undefined): string {
  if (!isRecurring(r)) return '';
  const d = r.data || {}, f = Math.max(1, d.frequency || 1);
  const every = (unit: string, plain: string) => f === 1 ? plain : `every ${f} ${unit}s`;
  const days = (d.days_of_week || []).slice().sort((a, b) => a - b);
  const nth = d.nth_weekday ? `the ${ordinal(d.nth_weekday)} ${LONG_DAYS[days[0] ?? 1]}` : '';
  switch (r.type) {
    case 'daily': return `Repeats ${every('day', 'daily')}`;
    case 'weekly': return `Repeats ${every('week', 'weekly')}${days.length ? ` on ${days.map((x) => DAYS[x]).join(', ')}` : ''}`;
    case 'monthly': return `Repeats ${every('month', 'monthly')} on ${nth || `day ${d.date ?? d.day ?? 1}`}`;
    case 'yearly': return `Repeats ${every('year', 'yearly')} on ${nth ? `${nth} of ${MONTHS[(d.month || 1) - 1]}` : `${MONTHS[(d.month || 1) - 1]} ${d.date ?? d.day ?? 1}`}`;
    case 'periodically': return `Repeats ${f} ${(d.unit || 'days').replace(/s$/, '')}${f === 1 ? '' : 's'} after completion`;
  }
  return 'Repeats';
}

export type Task = {
  gid: string; name: string; notes: string; dueOn: string | null; dueAt: string | null; completed: boolean;
  projects: { gid: string; name: string }[]; sectionGid: string | null; sectionName: string | null;
  recurrence: Recurrence; assignee: { gid: string; name: string } | null; permalink: string; numSubtasks: number;
};

/** YYYY-MM-DD of `date` in `timeZone` (the owner's zone). */
export function dayIn(date: Date, timeZone = 'UTC'): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Same day next month (clamped to the month's last day). */
export const addMonth = (day: string) => { const [y, m, dd] = day.split('-').map(Number); const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(dd, last))).toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Local HH:MM of a due_at in the owner's zone, '' without a time. */
export function dueTime(t: Pick<Task, 'dueAt'>, timeZone = 'UTC'): string {
  if (!t.dueAt) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(t.dueAt));
}
/** The day a task is due in the owner's zone (due_at wins over due_on). */
export const dueDay = (t: Pick<Task, 'dueOn' | 'dueAt'>, timeZone = 'UTC') => t.dueAt ? dayIn(new Date(t.dueAt), timeZone) : t.dueOn;

/** Row badge: "8D OVERDUE", "DUE TODAY · 7:00 PM", "DUE TOMORROW", "DUE NOV 21". */
export function dueBadge(t: Pick<Task, 'dueOn' | 'dueAt'>, today: string, timeZone = 'UTC'): { text: string; tone: 'overdue' | 'today' | 'later' | 'none' } {
  const day = dueDay(t, timeZone);
  if (!day) return { text: 'NO DATE', tone: 'none' };
  const diff = daysBetween(today, day), time = dueTime(t, timeZone);
  if (diff < 0) return { text: `${-diff}D OVERDUE`, tone: 'overdue' };
  const when = diff === 0 ? 'DUE TODAY' : diff === 1 ? 'DUE TOMORROW' : `DUE ${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase()}`;
  return { text: time ? `${when} · ${time}` : when, tone: diff === 0 ? 'today' : 'later' };
}
/** Card label: "Today", "Tomorrow", "Yesterday", "Nov 9" (+ time). */
export function dueShort(t: Pick<Task, 'dueOn' | 'dueAt'>, today: string, timeZone = 'UTC'): { text: string; tone: 'overdue' | 'today' | 'later' | 'none' } {
  const day = dueDay(t, timeZone);
  if (!day) return { text: '', tone: 'none' };
  const diff = daysBetween(today, day), time = dueTime(t, timeZone);
  const text = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return { text: time ? `${text} ${time}` : text, tone: diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'later' };
}
/** Day-load colour for the reschedule chips: 0 quiet, 1–4 light, 5–8 filling, 9+ overloaded. */
export const loadTone = (n: number) => n === 0 ? 'zero' : n <= 4 ? 'light' : n <= 8 ? 'busy' : 'full';

/** Due payload for Asana: a time sets due_at (UTC instant from the owner's local day+time), else due_on. */
export function duePayload(day: string | null, time: string, timeZone = 'UTC'): { due_on: string | null; due_at?: null } | { due_at: string } {
  if (!day) return { due_on: null, due_at: null };
  if (!time) return { due_on: day, due_at: null };
  // Find the UTC instant whose wall-clock time in `timeZone` is day+time (two passes handle DST edges).
  const want = Date.parse(`${day}T${time}:00Z`);
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    guess += want - shown;
  }
  return { due_at: new Date(guess).toISOString() };
}

/** "1h 25m worked" line logged as a comment when a timer stops. */
export function workedLine(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60)), h = Math.floor(m / 60);
  return `⏱ ${h ? `${h}h ${m % 60}m` : `${m}m`} worked (AadOS timer)`;
}
