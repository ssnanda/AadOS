// Asana REST client (personal access token; Asana → My settings → Apps → Developer apps → Personal access tokens).
// Tasks are read live from Asana every time, like the Toolbox; AadOS stores only the token (encrypted, with the
// other integration secrets), the chosen workspace and running timers.
import { readState, updateState, type AadOSState } from './aados-store';
import { NO_REPEAT, type Recurrence, type Task } from '$lib/asana-model';

const BASE = 'https://app.asana.com/api/1.0';
const TASK_FIELDS = 'name,notes,due_on,due_at,completed,permalink_url,projects.name,assignee.name,assignee_section.name,recurrence,num_subtasks';

export class AsanaError extends Error { constructor(message: string, public status = 0) { super(message); } }
type Query = Record<string, string | number | boolean | undefined>;
export type Conn = { token: string; workspace: string; workspaceName: string; timeZone: string };

async function call(token: string, method: string, path: string, opts: { query?: Query; body?: unknown; form?: FormData } = {}): Promise<any> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(opts.query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify({ data: opts.body }) : undefined), signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AsanaError(res.status === 401 ? 'Asana rejected the token. Reconnect with a new personal access token.' : json.errors?.[0]?.message || `Asana HTTP ${res.status}`, res.status);
  return json;
}
/** Every page of a list endpoint (100 per page, capped so a runaway list cannot hang a request). */
async function all(token: string, path: string, query: Query, maxPages = 20): Promise<any[]> {
  const out: any[] = [];
  let offset = '';
  for (let n = 0; n < maxPages; n++) {
    const page = await call(token, 'GET', path, { query: { ...query, limit: 100, offset: offset || undefined } });
    out.push(...(page.data || []));
    offset = page.next_page?.offset || '';
    if (!offset) break;
  }
  return out;
}

export function toTask(d: any): Task {
  return {
    gid: String(d.gid), name: String(d.name || ''), notes: String(d.notes || ''), dueOn: d.due_on || null, dueAt: d.due_at || null, completed: Boolean(d.completed),
    projects: (d.projects || []).map((p: any) => ({ gid: String(p.gid), name: String(p.name || '') })),
    sectionGid: d.assignee_section?.gid || null, sectionName: d.assignee_section?.name || null,
    recurrence: (d.recurrence?.type ? d.recurrence : NO_REPEAT) as Recurrence,
    assignee: d.assignee ? { gid: String(d.assignee.gid), name: String(d.assignee.name || '') } : null,
    permalink: String(d.permalink_url || ''), numSubtasks: Number(d.num_subtasks || 0)
  };
}

export const connectedState = (s: AadOSState) => Boolean(s.integrations.asana?.token && s.integrations.asana?.workspaceGid);
export async function connection(): Promise<Conn> {
  const s = await readState();
  const a = s.integrations.asana;
  if (!a?.token || !a.workspaceGid) throw new AsanaError('Asana is not connected.', 401);
  return { token: a.token, workspace: a.workspaceGid, workspaceName: a.workspaceName, timeZone: s.prefs.timeZone || 'UTC' };
}

/** Verify a token and save it with a workspace (the given one, else the first). Returns the workspaces. */
export async function connect(token: string, workspaceGid = '') {
  const me = await call(token.trim(), 'GET', '/users/me', { query: { opt_fields: 'name,workspaces.name' } });
  const workspaces: { gid: string; name: string }[] = (me.data.workspaces || []).map((w: any) => ({ gid: String(w.gid), name: String(w.name) }));
  if (!workspaces.length) throw new AsanaError('This Asana account has no workspace.');
  const ws = workspaces.find((w) => w.gid === workspaceGid) || workspaces[0];
  await updateState((s) => { s.integrations.asana = { token: token.trim(), workspaceGid: ws.gid, workspaceName: ws.name, userName: String(me.data.name || '') }; });
  return { workspaces, workspace: ws };
}
export async function disconnect() { await updateState((s) => { s.integrations.asana = { token: '', workspaceGid: '', workspaceName: '', userName: '' }; delete s.asanaTimers; }); }

/** All my incomplete tasks (any due date, or none). */
export async function myTasks(c: Conn): Promise<Task[]> {
  return (await all(c.token, '/tasks', { assignee: 'me', workspace: c.workspace, completed_since: 'now', opt_fields: TASK_FIELDS })).map(toTask);
}
/** My Tasks sections (the board columns). Empty when Asana won't say (columns are then derived from the tasks). */
export async function mySections(c: Conn): Promise<{ gid: string; name: string }[]> {
  try {
    const list = await call(c.token, 'GET', '/users/me/user_task_list', { query: { workspace: c.workspace, opt_fields: 'gid' } });
    return (await all(c.token, `/projects/${list.data.gid}/sections`, { opt_fields: 'name' })).map((x) => ({ gid: String(x.gid), name: String(x.name) }));
  } catch { return []; }
}
export async function projects(c: Conn) { return (await all(c.token, '/projects', { workspace: c.workspace, archived: false, opt_fields: 'name' })).map((p) => ({ gid: String(p.gid), name: String(p.name) })).sort((a, b) => a.name.localeCompare(b.name)); }
export async function users(c: Conn) { return (await all(c.token, '/users', { workspace: c.workspace, opt_fields: 'name' })).map((u) => ({ gid: String(u.gid), name: String(u.name) })); }

export async function updateTask(c: Conn, gid: string, data: Record<string, unknown>) { return toTask((await call(c.token, 'PUT', `/tasks/${gid}`, { body: data, query: { opt_fields: TASK_FIELDS } })).data); }
export async function moveToSection(c: Conn, sectionGid: string, gid: string) { await call(c.token, 'POST', `/sections/${sectionGid}/addTask`, { body: { task: gid } }); }
export async function deleteTask(c: Conn, gid: string) { await call(c.token, 'DELETE', `/tasks/${gid}`); }
export async function createTask(c: Conn, t: { name: string; notes?: string; due?: Record<string, unknown>; projects?: string[]; assignee?: string; parent?: string }) {
  const body: Record<string, unknown> = { name: t.name, notes: t.notes || '', ...(t.due || {}) };
  if (t.parent) return toTask((await call(c.token, 'POST', `/tasks/${t.parent}/subtasks`, { body, query: { opt_fields: TASK_FIELDS } })).data);
  body.workspace = c.workspace; body.assignee = t.assignee || 'me';
  if (t.projects?.length) body.projects = t.projects;
  return toTask((await call(c.token, 'POST', '/tasks', { body, query: { opt_fields: TASK_FIELDS } })).data);
}
export async function subtasks(c: Conn, gid: string) { return (await all(c.token, `/tasks/${gid}/subtasks`, { opt_fields: 'name,completed' })).map((x) => ({ gid: String(x.gid), name: String(x.name), completed: Boolean(x.completed) })); }
export async function comments(c: Conn, gid: string) {
  return (await all(c.token, `/tasks/${gid}/stories`, { opt_fields: 'type,text,created_at,created_by.name' })).filter((x) => x.type === 'comment').map((x) => ({ gid: String(x.gid), text: String(x.text || ''), at: String(x.created_at), by: String(x.created_by?.name || '') }));
}
export async function addComment(c: Conn, gid: string, text: string) { await call(c.token, 'POST', `/tasks/${gid}/stories`, { body: { text } }); }
export async function attachments(c: Conn, gid: string) { return (await all(c.token, '/attachments', { parent: gid, opt_fields: 'name,download_url,permanent_url' })).map((x) => ({ gid: String(x.gid), name: String(x.name), url: String(x.permanent_url || x.download_url || '') })); }
export async function uploadAttachment(c: Conn, gid: string, filename: string, mime: string, bytes: Uint8Array) {
  const form = new FormData();
  form.set('parent', gid);
  form.set('file', new Blob([new Uint8Array(bytes)], { type: mime || 'application/octet-stream' }), filename); // copy: Blob needs an ArrayBuffer-backed view
  await call(c.token, 'POST', '/attachments', { form });
}

/** People & Teams: everyone in my teams (plus me) with their incomplete tasks. One person failing never blanks the rest. */
export async function people(c: Conn) {
  const teams = await all(c.token, '/users/me/teams', { workspace: c.workspace, opt_fields: 'name' }).catch(() => []);
  const members = new Map<string, { gid: string; name: string; teams: string[] }>();
  for (const t of teams) for (const u of await all(c.token, `/teams/${t.gid}/users`, { opt_fields: 'name' }).catch(() => [])) {
    const m = members.get(u.gid) || { gid: String(u.gid), name: String(u.name), teams: [] };
    m.teams.push(String(t.name)); members.set(u.gid, m);
  }
  if (!members.size) for (const u of await users(c).catch(() => [])) members.set(u.gid, { ...u, teams: [] });
  const list = [...members.values()];
  const out: { gid: string; name: string; teams: string[]; tasks: Task[]; error: string }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < list.length) {
      const m = list[next++];
      try { out.push({ ...m, tasks: (await all(c.token, '/tasks', { assignee: m.gid, workspace: c.workspace, completed_since: 'now', opt_fields: TASK_FIELDS }, 5)).map(toTask), error: '' }); }
      catch (e) { out.push({ ...m, tasks: [], error: e instanceof Error ? e.message : 'Could not read tasks' }); }
    }
  }));
  return { teams: teams.map((t: any) => String(t.name)), people: out.sort((a, b) => a.name.localeCompare(b.name)) };
}
