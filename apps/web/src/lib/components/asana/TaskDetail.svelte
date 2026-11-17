<script lang="ts">
  // Task detail panel: edit name/notes/due/repeat/stage, subtasks, comments, attachments, timer, delete.
  import { untrack } from 'svelte';
  import { asanaApi } from '$lib/asana-client';
  import { dueDay, recurrenceSummary, stageOf, type Task } from '$lib/asana-model';
  import RecurrenceEditor from './RecurrenceEditor.svelte';
  type Timer = { name: string; startedAt: string; note: string };
  let { task, sections, timeZone, timer, now, aiAvailable = false, onchange, onremove, onclose, ontimer }: {
    task: Task; sections: { gid: string; name: string }[]; timeZone: string; timer?: Timer; now: number; aiAvailable?: boolean;
    onchange: (t: Task) => void; onremove: (gid: string) => void; onclose: () => void; ontimer: (gid: string, timer: Timer | null) => void;
  } = $props();

  let name = $state(''), notes = $state(''), day = $state(''), time = $state('');
  let detail = $state<{ subtasks: { gid: string; name: string; completed: boolean }[]; comments: { gid: string; text: string; at: string; by: string }[]; attachments: { gid: string; name: string; url: string }[] } | null>(null);
  let newSub = $state(''), newComment = $state(''), error = $state(''), editingRepeat = $state(false), help = $state(''), helping = $state(false), timerNote = $state('');
  $effect(() => {
    const t = task;
    untrack(() => {
      name = t.name; notes = t.notes; day = dueDay(t, timeZone) || ''; time = t.dueAt ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t.dueAt)) : '';
      detail = null; error = ''; help = ''; editingRepeat = false; timerNote = timer?.note || '';
      asanaApi('detail', { gid: t.gid }).then((d) => { if (task.gid === t.gid) detail = d; }).catch((e) => (error = e.message));
    });
  });
  async function run<T>(fn: () => Promise<T>): Promise<T | null> { error = ''; try { return await fn(); } catch (e) { error = e instanceof Error ? e.message : 'Failed.'; return null; } }
  const save = async (fields: Record<string, unknown>) => { const r = await run(() => asanaApi('update', { gid: task.gid, ...fields })); if (r?.task) onchange(r.task); };
  const saveDue = async () => { const r = await run(() => asanaApi('due', { gid: task.gid, day: day || null, time })); if (r?.tasks?.[0]) onchange(r.tasks[0]); };
  async function moveTo(section: string) {
    const s = sections.find((x) => x.gid === section);
    if (s && stageOf(s.name) === 'done') { if (await run(() => asanaApi('complete', { gid: task.gid }))) onremove(task.gid); return; }
    if (await run(() => asanaApi('section', { gid: task.gid, section }))) onchange({ ...task, sectionGid: section, sectionName: s?.name || null });
  }
  async function addSub() { const n = newSub.trim(); if (!n) return; const r = await run(() => asanaApi('create', { name: n, parent: task.gid })); if (r?.task && detail) { detail.subtasks = [...detail.subtasks, { gid: r.task.gid, name: n, completed: false }]; newSub = ''; } }
  async function toggleSub(s: { gid: string; completed: boolean }) { s.completed = !s.completed; if (!(await run(() => asanaApi('complete', { gid: s.gid, completed: s.completed })))) s.completed = !s.completed; }
  async function addComment() { const t = newComment.trim(); if (!t) return; if (await run(() => asanaApi('comment', { gid: task.gid, text: t })) && detail) { detail.comments = [...detail.comments, { gid: String(Date.now()), text: t, at: new Date().toISOString(), by: 'You' }]; newComment = ''; } }
  async function remove() { if (!confirm(`Delete “${task.name}” in Asana?`)) return; if (await run(() => asanaApi('delete', { gid: task.gid }))) onremove(task.gid); }
  async function startTimer() { if (await run(() => asanaApi('timerStart', { gid: task.gid, name: task.name }))) ontimer(task.gid, { name: task.name, startedAt: new Date().toISOString(), note: '' }); }
  async function stopTimer(complete = false) { if (await run(() => asanaApi('timerStop', { gid: task.gid, note: timerNote, complete }))) { ontimer(task.gid, null); if (complete) onremove(task.gid); else detail = await asanaApi('detail', { gid: task.gid }).catch(() => detail); } }
  async function askHelp() { helping = true; const r = await run(() => asanaApi('ai', { kind: 'help', gid: task.gid })); helping = false; if (r) help = r.text; }
  const elapsed = $derived(timer ? Math.max(0, Math.floor((now - Date.parse(timer.startedAt)) / 1000)) : 0);
  const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
</script>

<aside class="detail" aria-label="Task">
  <header><input class="name" bind:value={name} onblur={() => name.trim() && name !== task.name && save({ name })} aria-label="Task name"><button class="x" onclick={onclose} aria-label="Close">✕</button></header>
  {#if error}<p class="err">{error}</p>{/if}
  <div class="grid">
    <span>Status</span><select value={task.sectionGid || ''} onchange={(e) => moveTo(e.currentTarget.value)}>{#if !task.sectionGid}<option value="">—</option>{/if}{#each sections as s (s.gid)}<option value={s.gid}>{s.name}</option>{/each}</select>
    <span>Due</span><div class="row"><input type="date" bind:value={day} onchange={saveDue}><input type="time" bind:value={time} onchange={saveDue} disabled={!day}>{#if day}<button class="link" onclick={() => { day = ''; time = ''; saveDue(); }}>Clear</button>{/if}</div>
    <span>Repeat</span><div class="row rel"><button class="chip" onclick={() => (editingRepeat = !editingRepeat)}>⟳ {recurrenceSummary(task.recurrence) || 'Does not repeat'} ✎</button>
      {#if editingRepeat}<div class="pop"><RecurrenceEditor value={task.recurrence} oncancel={() => (editingRepeat = false)} onsave={async (r) => { const res = await run(() => asanaApi('recurrence', { gid: task.gid, recurrence: r })); if (res?.task) onchange(res.task); editingRepeat = false; }} /></div>{/if}</div>
    <span>Project</span><div>{task.projects.map((p) => p.name).join(', ') || '—'}</div>
    <span>Timer</span><div class="row">{#if timer}<b class="clock">{clock(elapsed)}</b><button onclick={() => stopTimer()}>⏸ Stop &amp; log</button><button class="done" onclick={() => stopTimer(true)}>✓ Done</button>{:else}<button onclick={startTimer}>▶ Start timer</button>{/if}</div>
  </div>
  {#if timer}<textarea rows="2" bind:value={timerNote} onblur={() => asanaApi('timerNote', { gid: task.gid, note: timerNote }).catch(() => undefined)} placeholder="Work note (logged with the time)"></textarea>{/if}
  <label class="lbl" for="notes">Description</label>
  <textarea id="notes" rows="6" bind:value={notes} onblur={() => notes !== task.notes && save({ notes })}></textarea>
  {#if aiAvailable}<div class="row"><button class="ai" onclick={askHelp} disabled={helping}>✦ {helping ? 'Thinking…' : 'Help me do this'}</button></div>{#if help}<pre class="help">{help}</pre>{/if}{/if}
  <h4>Subtasks</h4>
  {#if detail}<ul class="subs">{#each detail.subtasks as s (s.gid)}<li><input type="checkbox" checked={s.completed} onchange={() => toggleSub(s)}><span class:doneTxt={s.completed}>{s.name}</span></li>{/each}</ul>{:else}<small class="muted">Loading…</small>{/if}
  <form class="row" onsubmit={(e) => { e.preventDefault(); addSub(); }}><input bind:value={newSub} placeholder="Add subtask"><button>Add</button></form>
  {#if detail?.attachments.length}<h4>Attachments</h4><ul class="atts">{#each detail.attachments as a (a.gid)}<li><a href={a.url} target="_blank" rel="noopener noreferrer">📎 {a.name}</a></li>{/each}</ul>{/if}
  <h4>Comments</h4>
  {#if detail}<ul class="comments">{#each detail.comments as c (c.gid)}<li><small>{c.by} · {when(c.at)}</small><p>{c.text}</p></li>{:else}<li class="muted">No comments.</li>{/each}</ul>{/if}
  <form class="row" onsubmit={(e) => { e.preventDefault(); addComment(); }}><input bind:value={newComment} placeholder="Add a comment"><button>Post</button></form>
  <footer>{#if task.permalink}<a href={task.permalink} target="_blank" rel="noopener noreferrer">Open in Asana ↗</a>{/if}<span class="sp"></span><button class="danger" onclick={remove}>Delete task</button></footer>
</aside>

<style>
  .detail{position:sticky;top:12px;align-self:start;max-height:calc(100vh - 40px);overflow:auto;background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:14px;display:grid;gap:9px;font-size:13px}
  header{display:flex;gap:8px}.name{flex:1;font-size:17px;font-weight:800;border:1px solid transparent;border-radius:7px;padding:4px 6px}.name:hover,.name:focus{border-color:#d9dfeb}
  .x{border:0;background:none;font-size:15px;cursor:pointer;color:#8a95a8}
  .grid{display:grid;grid-template-columns:70px 1fr;gap:7px 10px;align-items:center}.grid>span{color:#8a95a8;font-size:11px;font-weight:800;text-transform:uppercase}
  .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.rel{position:relative}.pop{position:absolute;top:34px;left:0;z-index:20}
  input,select,textarea{border:1px solid #d9dfeb;border-radius:7px;padding:5px 7px;font:inherit;font-size:13px;min-width:0}textarea{width:100%;box-sizing:border-box;resize:vertical}form.row input{flex:1}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:5px 10px;font-size:12px;font-weight:700;color:#43516c;cursor:pointer}button:hover{border-color:#8da2f0;color:#3157de}
  .chip{background:#eef3ff;border-color:#cfdcff;color:#3157de}.done{background:#2a9d5c;border-color:#2a9d5c;color:#fff}.danger{color:#b53c50}.ai{background:#f3edff;border-color:#d9c9ff;color:#6a3fd6}
  .link{border:0;background:none;color:#3157de;padding:0}.clock{font-variant-numeric:tabular-nums;color:#3157de}
  .lbl,h4{margin:4px 0 0;font-size:11px;font-weight:800;text-transform:uppercase;color:#8a95a8}
  ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}.subs li{display:flex;gap:7px;align-items:center}.doneTxt{text-decoration:line-through;color:#8a95a8}
  .comments li{background:#f7f8fb;border-radius:8px;padding:6px 8px}.comments small{color:#8a95a8}.comments p{margin:2px 0 0;white-space:pre-wrap}
  .help{white-space:pre-wrap;font:12px/1.5 system-ui,sans-serif;background:#faf7ff;border:1px solid #ece3ff;border-radius:8px;padding:8px;margin:0}
  .err{color:#a5414d;margin:0}.muted{color:#8a95a8}footer{display:flex;align-items:center;gap:8px;border-top:1px solid #eef0f5;padding-top:8px}footer a{color:#3157de;font-weight:700;text-decoration:none}.sp{flex:1}
</style>
