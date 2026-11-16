import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readState, updateState } from '$lib/server/aados-store';
import { buildRows } from '$lib/server/inbox';

export const load: PageServerLoad = async () => {
  const state = await readState();
  const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const tasks = [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999') || b.createdAt.localeCompare(a.createdAt))
    .map((t) => ({ ...t, email: t.emailKey ? (byKey.get(t.emailKey) ? { subject: byKey.get(t.emailKey)!.subject, pipelineId: byKey.get(t.emailKey)!.pipelineId, messageId: byKey.get(t.emailKey)!.messageId } : null) : null }));
  // Emails flagged for follow-up in the inbox that don't have a task yet.
  const linked = new Set(state.tasks.map((t) => t.emailKey));
  const followUps = rows.filter((r) => r.followUp && !linked.has(r.key)).slice(0, 50).map((r) => ({ key: r.key, subject: r.subject, sender: r.sender, due: r.due, receivedAt: r.receivedAt }));
  return { tasks, followUps, today: new Date().toISOString().slice(0, 10) };
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const actions: Actions = {
  add: async ({ request }) => {
    const f = await request.formData();
    const title = String(f.get('title') || '').trim().slice(0, 200);
    const due = String(f.get('due') || '');
    const emailKey = String(f.get('emailKey') || '') || undefined;
    if (!title) return fail(400, { error: 'Enter a task.' });
    if (due && !DATE.test(due)) return fail(400, { error: 'Invalid date.' });
    await updateState((s) => { s.tasks.push({ id: crypto.randomUUID(), title, due, done: false, createdAt: new Date().toISOString(), emailKey }); });
    return { added: true };
  },
  toggle: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { const t = s.tasks.find((x) => x.id === id); if (t) t.done = !t.done; });
    return { toggled: id };
  },
  // Local tasks only; never touches a mailbox.
  remove: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    await updateState((s) => { s.tasks = s.tasks.filter((x) => x.id !== id); });
    return { removed: id };
  }
};
