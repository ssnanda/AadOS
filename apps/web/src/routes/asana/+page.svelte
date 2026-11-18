<script lang="ts">
  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import TaskDetail from '$lib/components/asana/TaskDetail.svelte';
  import NewTask from '$lib/components/asana/NewTask.svelte';
  import RecurrenceEditor from '$lib/components/asana/RecurrenceEditor.svelte';
  import { asanaApi } from '$lib/asana-client';
  import { NEXT, STAGES, addDays, addMonth, dueBadge, dueDay, dueShort, isRecurring, loadTone, recurrenceSummary, stageOf, type Stage, type Task } from '$lib/asana-model';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  type View = 'my' | 'board' | 'calendar' | 'people' | 'recurring';
  type Timer = { name: string; startedAt: string; note: string };
  const VIEWS: [View, string, string][] = [['my', 'My Tasks', '☰'], ['board', 'Board', '▥'], ['calendar', 'Calendar', '▦'], ['people', 'People & Teams', '◉'], ['recurring', 'Recurring', '⟳']];
  const initial = page.url.searchParams.get('view') as View;
  let view = $state<View>(VIEWS.some(([v]) => v === initial) ? initial : 'my');
  const setView = (v: View) => { view = v; const u = new URL(page.url); u.searchParams.set('view', v); replaceState(u, {}); };

  // Local working copy: every change shows at once and rolls back if Asana refuses.
  let tasks = $state<Task[]>([]);
  let timers = $state<Record<string, Timer>>({});
  $effect(() => { const d = data; untrack(() => { if (d.connected) { tasks = d.tasks; timers = { ...d.timers }; } }); });
  const tz = $derived(data.timeZone), today = $derived(data.today);
  const projects = $derived(data.connected ? data.projects : []);

  let showAll = $state(false), selected = $state<string[]>([]), detailGid = $state(''), creating = $state(false), notice = $state('');
  let undo = $state<{ label: string; tasks: Task[] } | null>(null), undoTimer: ReturnType<typeof setTimeout> | undefined;
  let ai = $state<{ title: string; text: string } | null>(null), aiBusy = $state('');
  let timePick = $state<{ gid: string; value: string } | null>(null), repeatEdit = $state(''), addTimeOpen = $state(false), addTimeValue = $state('09:00');
  let collapsed = $state<string[]>([]), dueOnly = $state(false), refreshing = $state(false), token = $state(''), connecting = $state(false);
  let now = $state(Date.now());
  $effect(() => { dueOnly = data.dashboardDueOnly; });
  onMount(() => { const t = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(t); });

  // Board columns: the real My Tasks sections, else derived from the tasks (first-seen order).
  const sections = $derived.by(() => {
    if (data.connected && data.sections.length) return data.sections;
    const seen = new Map<string, string>();
    for (const t of tasks) if (t.sectionGid && !seen.has(t.sectionGid)) seen.set(t.sectionGid, t.sectionName || '');
    return [...seen].map(([gid, name]) => ({ gid, name }));
  });
  const byDue = (a: Task, b: Task) => (dueDay(a, tz) || '9999').localeCompare(dueDay(b, tz) || '9999') || (a.dueAt || '').localeCompare(b.dueAt || '') || a.name.localeCompare(b.name);
  const groups = $derived.by(() => {
    const inc: Task[] = [], over: Task[] = [], tod: Task[] = [], up: Task[] = [], none: Task[] = [];
    for (const t of tasks) {
      const d = dueDay(t, tz);
      if (stageOf(t.sectionName) === 'incoming') inc.push(t); else if (!d) none.push(t); else if (d < today) over.push(t); else if (d === today) tod.push(t); else up.push(t);
    }
    const g = [
      { id: 'incoming', title: 'Incoming', hint: 'Acknowledge to move into To do', tasks: inc.sort(byDue) },
      { id: 'overdue', title: 'Overdue', hint: '', tasks: over.sort(byDue) },
      { id: 'today', title: 'Today', hint: '', tasks: tod.sort(byDue) }
    ];
    if (showAll) g.push({ id: 'upcoming', title: 'Upcoming', hint: '', tasks: up.sort(byDue) }, { id: 'nodate', title: 'No due date', hint: '', tasks: none.sort((a, b) => a.name.localeCompare(b.name)) });
    return g;
  });
  const visible = $derived(view === 'recurring' ? tasks.filter((t) => isRecurring(t.recurrence)) : view === 'my' ? groups.flatMap((g) => g.tasks) : tasks);
  const incoming = $derived(tasks.filter((t) => stageOf(t.sectionName) === 'incoming'));
  const load = $derived.by(() => { const m: Record<string, number> = {}; for (const t of tasks) { const d = dueDay(t, tz); if (d) m[d] = (m[d] || 0) + 1; } return m; });
  const chips = $derived.by(() => {
    const out = [{ day: today, label: 'Today' }];
    for (let i = 1; i <= 6; i++) { const d = addDays(today, i); out.push({ day: d, label: new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) }); }
    out.push({ day: addMonth(today), label: 'Next Mo' });
    return out.map((c) => ({ ...c, md: `${Number(c.day.slice(5, 7))}/${Number(c.day.slice(8))}` }));
  });
  // A subtask opened from the detail panel isn't in My Tasks; keep it alongside.
  let opened = $state<Task | null>(null);
  const detail = $derived(tasks.find((t) => t.gid === detailGid) ?? (opened?.gid === detailGid ? opened : undefined));
  const hhmm = (t: Task) => t.dueAt ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t.dueAt)) : '';
  const clock = (iso: string) => { const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const stageTitle = (s: Stage) => STAGES.find((x) => x.id === s)?.title || '';

  const patch = (gid: string, fields: Partial<Task>) => (tasks = tasks.map((t) => (t.gid === gid ? { ...t, ...fields } : t)));
  const replace = (t: Task) => { tasks = tasks.map((x) => (x.gid === t.gid ? t : x)); if (opened?.gid === t.gid) opened = t; };
  const fail = (e: unknown) => (notice = e instanceof Error ? e.message : 'Asana request failed.');

  async function complete(gids: string[]) {
    const done = tasks.filter((t) => gids.includes(t.gid));
    if (!done.length) return;
    tasks = tasks.filter((t) => !gids.includes(t.gid)); selected = selected.filter((g) => !gids.includes(g));
    if (gids.includes(detailGid)) detailGid = '';
    const nextTimers = { ...timers }; for (const g of gids) delete nextTimers[g]; timers = nextTimers;
    undo = { label: done.length === 1 ? `Completed “${done[0].name}”` : `Completed ${done.length} tasks`, tasks: done };
    clearTimeout(undoTimer); undoTimer = setTimeout(() => (undo = null), 10_000);
    try { await asanaApi('complete', { gids }); } catch (e) { tasks = [...tasks, ...done]; undo = null; fail(e); }
  }
  async function reopen() {
    const u = undo; if (!u) return; undo = null; tasks = [...tasks, ...u.tasks];
    try { await asanaApi('complete', { gids: u.tasks.map((t) => t.gid), completed: false }); } catch (e) { fail(e); }
  }
  async function toStage(list: Task[], to: Stage) {
    if (to === 'done') return complete(list.map((t) => t.gid));
    const sec = sections.find((s) => stageOf(s.name) === to), before = list.map((t) => ({ gid: t.gid, sectionGid: t.sectionGid, sectionName: t.sectionName }));
    if (sec) for (const t of list) patch(t.gid, { sectionGid: sec.gid, sectionName: sec.name });
    try {
      if (to === 'doing' && list.length === 1) { await asanaApi('timerStart', { gid: list[0].gid, name: list[0].name, toDoing: true }); timers = { ...timers, [list[0].gid]: { name: list[0].name, startedAt: new Date().toISOString(), note: '' } }; }
      else await asanaApi('stage', { gids: list.map((t) => t.gid), stage: to });
    } catch (e) { for (const b of before) patch(b.gid, b); fail(e); }
  }
  async function moveToSection(gid: string, sectionGid: string) {
    const s = sections.find((x) => x.gid === sectionGid), t = tasks.find((x) => x.gid === gid);
    if (!s || !t || t.sectionGid === sectionGid) return;
    if (stageOf(s.name) === 'done') return complete([gid]);
    const before = { sectionGid: t.sectionGid, sectionName: t.sectionName };
    patch(gid, { sectionGid, sectionName: s.name });
    try { await asanaApi('section', { gid, section: sectionGid }); } catch (e) { patch(gid, before); fail(e); }
  }
  /** Reschedule (each task keeps its own time unless `time` is given). */
  async function setDue(list: Task[], day: string | null, time?: string) {
    const before = list.map((t) => ({ gid: t.gid, dueOn: t.dueOn, dueAt: t.dueAt }));
    for (const t of list) patch(t.gid, { dueOn: day, dueAt: null });
    try {
      await Promise.all(list.map(async (t) => { const r = await asanaApi<{ tasks: Task[] }>('due', { gid: t.gid, day, time: time ?? hhmm(t) }); if (r.tasks[0]) replace(r.tasks[0]); }));
    } catch (e) { for (const b of before) patch(b.gid, b); fail(e); }
  }
  async function addTimeToTasks() {
    const list = (selected.length ? tasks.filter((t) => selected.includes(t.gid)) : visible.filter((t) => !t.dueAt)).filter((t) => dueDay(t, tz));
    addTimeOpen = false;
    // Each task keeps its own due day; only the time is set.
    await Promise.all(list.map(async (t) => { try { const r = await asanaApi<{ tasks: Task[] }>('due', { gid: t.gid, day: dueDay(t, tz), time: addTimeValue }); if (r.tasks[0]) replace(r.tasks[0]); } catch (e) { fail(e); } }));
  }
  async function saveRepeat(t: Task, r: Task['recurrence']) {
    repeatEdit = ''; const before = t.recurrence; patch(t.gid, { recurrence: r });
    try { const res = await asanaApi<{ task: Task }>('recurrence', { gid: t.gid, recurrence: r }); replace(res.task); } catch (e) { patch(t.gid, { recurrence: before }); fail(e); }
  }
  async function deleteSelected() {
    const list = tasks.filter((t) => selected.includes(t.gid)); if (!list.length || !confirm(`Delete ${list.length} task${list.length === 1 ? '' : 's'} in Asana?`)) return;
    tasks = tasks.filter((t) => !selected.includes(t.gid)); selected = [];
    try { await asanaApi('delete', { gids: list.map((t) => t.gid) }); } catch (e) { tasks = [...tasks, ...list]; fail(e); }
  }
  async function timerToggle(t: Task) {
    if (timers[t.gid]) { const nt = { ...timers }; delete nt[t.gid]; timers = nt; await asanaApi('timerStop', { gid: t.gid }).catch(fail); }
    else { timers = { ...timers, [t.gid]: { name: t.name, startedAt: new Date().toISOString(), note: '' } }; await asanaApi('timerStart', { gid: t.gid, name: t.name }).catch(fail); }
  }
  async function runAi(kind: 'plan' | 'summarize' | 'help', title: string) {
    aiBusy = kind;
    try { const r = await asanaApi<{ text: string }>('ai', { kind, gids: kind === 'help' ? [selected[0] || detailGid] : kind === 'summarize' ? visible.map((t) => t.gid) : [] }); ai = { title, text: r.text }; }
    catch (e) { fail(e); } finally { aiBusy = ''; }
  }
  async function refresh() { refreshing = true; await invalidateAll(); refreshing = false; }
  async function connect() { connecting = true; notice = ''; try { await asanaApi('connect', { token }); token = ''; await invalidateAll(); } catch (e) { fail(e); } finally { connecting = false; } }
  async function disconnect() { if (!confirm('Disconnect Asana from AadOS? Your Asana data is not changed.')) return; await asanaApi('disconnect').catch(fail); await invalidateAll(); }
  const toggle = (gid: string, on: boolean) => (selected = on ? [...new Set([...selected, gid])] : selected.filter((g) => g !== gid));

  // Calendar
  let month = $state('');
  $effect(() => { if (!month) month = today.slice(0, 7); });
  const calDays = $derived.by(() => {
    if (!month) return [];
    const first = new Date(`${month}-01T12:00:00Z`), start = addDays(`${month}-01`, -first.getUTCDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  });
  const shiftMonth = (n: number) => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); month = d.toISOString().slice(0, 7); };

  // People & Teams (loaded when opened)
  let people = $state<{ teams: string[]; people: { gid: string; name: string; teams: string[]; tasks: Task[]; error: string }[] } | null>(null), peopleBusy = $state(false), openPerson = $state('');
  $effect(() => { if (view === 'people' && !people && !peopleBusy && data.connected) untrack(loadPeople); });
  async function loadPeople() { peopleBusy = true; try { people = await asanaApi('people'); } catch (e) { fail(e); } finally { peopleBusy = false; } }
  const countsOf = (list: Task[]) => { let o = 0, d = 0, u = 0, n = 0; for (const t of list) { const x = dueDay(t, tz); if (!x) n++; else if (x < today) o++; else if (x === today) d++; else u++; } return { o, d, u, n }; };

  let dragGid = '';
</script>

<svelte:head><title>Asana · AadOS</title></svelte:head>
<AppShell title="Asana">
<main class:withDetail={Boolean(detail)}>
  {#if !data.connected}
    <section class="connect">
      <h1>Connect Asana</h1>
      <p>Create a personal access token in Asana (<a href="https://app.asana.com/0/my-apps" target="_blank" rel="noopener noreferrer">My apps → Personal access token</a>) and paste it here. It is stored encrypted; tasks are read live from Asana.</p>
      <form onsubmit={(e) => { e.preventDefault(); connect(); }}><input type="password" bind:value={token} placeholder="Personal access token" autocomplete="off"><button class="primary" disabled={connecting || !token.trim()}>{connecting ? 'Connecting…' : 'Connect'}</button></form>
      {#if notice}<p class="err">{notice}</p>{/if}
    </section>
  {:else}
  <div class="topline"><label class="chk"><input type="checkbox" bind:checked={dueOnly} onchange={() => asanaApi('prefs', { dashboardDueOnly: dueOnly }).catch(fail)}> Dashboard due tasks only</label><span class="sp"></span><small class="muted">{data.workspace}{data.user ? ` · ${data.user}` : ''}</small><button class="ghost" onclick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button><button class="ghost" onclick={disconnect}>Disconnect</button></div>
  <header class="head">
    <h1>Asana — {VIEWS.find(([v]) => v === view)?.[1]}</h1>
    <nav class="tabs">{#each VIEWS as [v, label, icon] (v)}<button class="tab {v}" class:on={view === v} onclick={() => setView(v)}><span>{icon}</span> {label}</button>{/each}<button class="newtask" onclick={() => (creating = true)}>⊕ New Task</button></nav>
  </header>
  <div class="actions">
    <button class="act help" disabled={!data.aiAvailable || (!selected[0] && !detailGid) || Boolean(aiBusy)} onclick={() => runAi('help', 'Help me do this')} title={data.aiAvailable ? 'Select one task' : 'Turn on AI in Settings → AI'}>✦ {aiBusy === 'help' ? 'Thinking…' : 'Help me do this'}</button>
    <button class="act plan" disabled={!data.aiAvailable || Boolean(aiBusy)} onclick={() => runAi('plan', 'Plan my day')}>☀ {aiBusy === 'plan' ? 'Planning…' : 'Plan my day'}</button>
    <button class="act sum" disabled={!data.aiAvailable || Boolean(aiBusy)} onclick={() => runAi('summarize', 'Summary')}>☰ {aiBusy === 'summarize' ? 'Summarizing…' : 'Summarize view'}</button>
    <button class="act all" class:on={showAll} onclick={() => (showAll = !showAll)}>☷ {showAll ? 'Due only' : 'Show all'}</button>
    <span class="relw"><button class="act time" onclick={() => (addTimeOpen = !addTimeOpen)}>◷ Add time to tasks</button>
      {#if addTimeOpen}<span class="pop timepop"><input type="time" bind:value={addTimeValue}><button onclick={addTimeToTasks}>Apply to {selected.length ? `${selected.length} selected` : 'tasks without a time'}</button><button onclick={() => (addTimeOpen = false)}>✕</button></span>{/if}</span>
    {#if incoming.length}<button class="act ack" onclick={() => toStage(incoming, 'todo')}>👍 Acknowledge all {incoming.length}</button>{/if}
  </div>
  {#if data.error}<div class="alert">{data.error}</div>{/if}
  {#if notice}<div class="alert">{notice} <button class="link" onclick={() => (notice = '')}>Dismiss</button></div>{/if}
  {#if ai}<div class="aibox"><header><strong>✦ {ai.title}</strong><button class="link" onclick={() => (ai = null)}>✕</button></header><pre>{ai.text}</pre></div>{/if}
  {#if selected.length}<div class="bulk"><strong>{selected.length} selected</strong><button onclick={() => complete(selected)}>✓ Complete</button><button onclick={() => toStage(tasks.filter((t) => selected.includes(t.gid)), 'todo')}>👍 Acknowledge</button><button onclick={() => setDue(tasks.filter((t) => selected.includes(t.gid)), today)}>Today</button><button onclick={() => setDue(tasks.filter((t) => selected.includes(t.gid)), addDays(today, 1))}>Tomorrow</button><button onclick={() => setDue(tasks.filter((t) => selected.includes(t.gid)), addMonth(today))}>Next month</button><button class="danger" onclick={deleteSelected}>🗑 Delete</button><button class="link" onclick={() => (selected = [])}>Clear</button></div>{/if}

  <div class="split">
  <div class="mainview">
  {#if view === 'my'}
    {#each groups as g (g.id)}{#if g.tasks.length || g.id !== 'incoming'}
      <section class="group">
        <h2 class={g.id}>{g.title.toUpperCase()} ({g.tasks.length}){#if g.hint}<small>{g.hint}</small>{/if}{#if g.tasks.length}<button class="link selall" onclick={() => (selected = [...new Set([...selected, ...g.tasks.map((t) => t.gid)])])}>Select all {g.tasks.length}</button>{/if}</h2>
        {#if !g.tasks.length}<p class="muted empty">Nothing here.</p>{/if}
        <ul class="rows">{#each g.tasks as t (t.gid)}{@const st = stageOf(t.sectionName)}{@const nx = st ? NEXT[st] : null}{@const b = dueBadge(t, today, tz)}
          <li class="trow" class:sel={selected.includes(t.gid)} class:active={detailGid === t.gid}>
            <input type="checkbox" checked={selected.includes(t.gid)} onchange={(e) => toggle(t.gid, e.currentTarget.checked)} aria-label={`Select ${t.name}`}>
            <button class="circle" title="Mark complete" aria-label="Mark complete" onclick={() => complete([t.gid])}>✓</button>
            <span class="badge {b.tone}">{b.text}</span>
            <span class="relw">{#if dueDay(t, tz)}<button class="timebtn" class:has={Boolean(t.dueAt)} onclick={() => (timePick = timePick?.gid === t.gid ? null : { gid: t.gid, value: hhmm(t) || '09:00' })}>◷ {t.dueAt ? 'Edit time' : 'Add time'}</button>{/if}
              {#if timePick?.gid === t.gid}<span class="pop timepop"><input type="time" bind:value={timePick.value}><button onclick={() => { const v = timePick?.value || ''; timePick = null; setDue([t], dueDay(t, tz), v); }}>Set</button>{#if t.dueAt}<button onclick={() => { timePick = null; setDue([t], dueDay(t, tz), ''); }}>Remove</button>{/if}<button onclick={() => (timePick = null)}>✕</button></span>{/if}</span>
            <button class="tname" onclick={() => (detailGid = t.gid)}><strong>{t.name}</strong>{#if t.projects[0]}<small>{t.projects.map((p) => p.name).join(', ')}</small>{/if}</button>
            {#if st}<span class="stage {st}">{stageTitle(st).toUpperCase()}</span>{/if}
            {#if nx}<button class="next {st}" onclick={() => toStage([t], nx.to)}>{st === 'incoming' ? '👍' : st === 'todo' ? '▶' : '✓'} {nx.label}</button>{/if}
            {#if timers[t.gid]}<button class="tick" onclick={() => timerToggle(t)} title="Stop and log the time">⏸ {clock(timers[t.gid].startedAt)}</button>{/if}
            <span class="relw"><button class="rep" class:none={!isRecurring(t.recurrence)} onclick={() => (repeatEdit = repeatEdit === t.gid ? '' : t.gid)}>⟳ {recurrenceSummary(t.recurrence) || 'Repeat'} ✎</button>
              {#if repeatEdit === t.gid}<div class="pop"><RecurrenceEditor value={t.recurrence} oncancel={() => (repeatEdit = '')} onsave={(r) => saveRepeat(t, r)} /></div>{/if}</span>
            <span class="days">{#each chips as c (c.day)}{@const n = load[c.day] || 0}<button class="day {loadTone(n)}" class:cur={dueDay(t, tz) === c.day} onclick={() => setDue([t], c.day)} title={`Move to ${c.day}`}><i>{n}</i><b>{c.label}</b><small>{c.md}</small></button>{/each}</span>
          </li>{/each}</ul>
      </section>
    {/if}{/each}
  {:else if view === 'board'}
    <p class="hint">Drag cards between columns. Dropping on Done completes the task. Collapse a column with its chevron.</p>
    <div class="board">{#each sections as s (s.gid)}{@const st = stageOf(s.name)}{@const col = tasks.filter((t) => t.sectionGid === s.gid).sort(byDue)}{@const shut = collapsed.includes(s.gid)}
      <section class="col" class:shut role="list" ondragover={(e) => e.preventDefault()} ondrop={(e) => { e.preventDefault(); if (dragGid) moveToSection(dragGid, s.gid); dragGid = ''; }}>
        <header><strong>{s.name}</strong><i>{col.length}</i><button class="chev" onclick={() => (collapsed = shut ? collapsed.filter((x) => x !== s.gid) : [...collapsed, s.gid])} aria-label={shut ? 'Expand' : 'Collapse'}>{shut ? '›' : '‹'}</button></header>
        {#if !shut}{#each col as t (t.gid)}{@const ds = dueShort(t, today, tz)}
          <article class="card" class:active={detailGid === t.gid} draggable="true" ondragstart={() => (dragGid = t.gid)} role="listitem">
            <div class="ctop"><input type="checkbox" checked={selected.includes(t.gid)} onchange={(e) => toggle(t.gid, e.currentTarget.checked)} aria-label="Select"><button class="circle" onclick={() => complete([t.gid])} aria-label="Complete">✓</button><button class="tname" onclick={() => (detailGid = t.gid)}>{t.name}</button></div>
            {#if t.projects[0]}<span class="ptag">{t.projects[0].name}</span>{/if}
            <div class="cfoot"><span class="due {ds.tone}">{ds.text}</span>{#if isRecurring(t.recurrence)}<span class="muted" title={recurrenceSummary(t.recurrence)}>⟳</span>{/if}<span class="sp"></span>
              {#if st === 'incoming'}<button class="next incoming" onclick={() => toStage([t], 'todo')}>👍 Acknowledge</button>
              {:else if st === 'todo'}<button class="next todo" onclick={() => toStage([t], 'doing')}>▶ Start</button>
              {:else if st === 'doing'}<button class="soft" onclick={() => timerToggle(t)}>{timers[t.gid] ? `⏸ ${clock(timers[t.gid].startedAt)}` : '▶ Start timer'}</button><button class="next doing" onclick={() => complete([t.gid])}>✓ Done</button>{/if}</div>
          </article>{/each}{/if}
      </section>{:else}<p class="muted">Your My Tasks list has no sections. Add Incoming / To do / Doing / Done in Asana, then Refresh.</p>{/each}</div>
  {:else if view === 'calendar'}
    <div class="calhead"><button onclick={() => shiftMonth(-1)}>‹</button><strong>{new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><button onclick={() => shiftMonth(1)}>›</button><button onclick={() => (month = today.slice(0, 7))}>Today</button><small class="muted">Drag a task to another day to reschedule.</small></div>
    <div class="cal">{#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as w (w)}<b class="wd">{w}</b>{/each}
      {#each calDays as d (d)}{@const list = tasks.filter((t) => dueDay(t, tz) === d).sort(byDue)}
        <div class="cell" class:other={!d.startsWith(month)} class:today={d === today} role="list" ondragover={(e) => e.preventDefault()} ondrop={(e) => { e.preventDefault(); const t = tasks.find((x) => x.gid === dragGid); if (t) setDue([t], d); dragGid = ''; }}>
          <span class="dn">{Number(d.slice(8))}</span>
          {#each list as t (t.gid)}<button class="ctask" class:over={d < today} draggable="true" ondragstart={() => (dragGid = t.gid)} onclick={() => (detailGid = t.gid)} title={t.name}>{t.dueAt ? `${new Date(t.dueAt).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })} ` : ''}{t.name}</button>{/each}
        </div>{/each}</div>
  {:else if view === 'people'}
    {#if peopleBusy}<p class="muted">Loading people and their tasks…</p>{:else if people}
      <div class="calhead"><small class="muted">{people.teams.length ? `Teams: ${people.teams.join(', ')}` : 'Workspace members'}</small><span class="sp"></span><button onclick={loadPeople}>Reload</button></div>
      <div class="people">{#each people.people as p (p.gid)}{@const c = countsOf(p.tasks)}
        <article class="person">
          <header><span class="av">{p.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span><div><strong>{p.name}</strong><small>{p.teams.join(', ')}</small></div></header>
          <div class="counts"><span class="o">{c.o} overdue</span><span class="d">{c.d} today</span><span>{c.u} upcoming</span><span class="muted">{c.n} no date</span></div>
          {#if p.error}<small class="err">{p.error}</small>{/if}
          <ul>{#each p.tasks.sort(byDue).slice(0, openPerson === p.gid ? 200 : 6) as t (t.gid)}{@const ds = dueShort(t, today, tz)}<li><span class="due {ds.tone}">{ds.text || '—'}</span><a href={t.permalink} target="_blank" rel="noopener noreferrer">{t.name}</a></li>{/each}</ul>
          {#if p.tasks.length > 6}<button class="link" onclick={() => (openPerson = openPerson === p.gid ? '' : p.gid)}>{openPerson === p.gid ? 'Show less' : `Show all ${p.tasks.length}`}</button>{/if}
        </article>{/each}</div>
    {/if}
  {:else if view === 'recurring'}
    <ul class="rows">{#each tasks.filter((t) => isRecurring(t.recurrence)).sort((a, b) => a.name.localeCompare(b.name)) as t (t.gid)}{@const ds = dueShort(t, today, tz)}
      <li class="trow rec">
        <button class="circle" onclick={() => complete([t.gid])} aria-label="Complete">✓</button>
        <button class="tname" onclick={() => (detailGid = t.gid)}><strong>{t.name}</strong>{#if t.projects[0]}<small>{t.projects[0].name}</small>{/if}</button>
        <span class="due {ds.tone}">Next: {ds.text || '—'}</span>
        <span class="relw"><button class="rep" onclick={() => (repeatEdit = repeatEdit === t.gid ? '' : t.gid)}>⟳ {recurrenceSummary(t.recurrence)} ✎</button>
          {#if repeatEdit === t.gid}<div class="pop"><RecurrenceEditor value={t.recurrence} oncancel={() => (repeatEdit = '')} onsave={(r) => saveRepeat(t, r)} /></div>{/if}</span>
      </li>{:else}<li class="muted">No repeating tasks.</li>{/each}</ul>
  {/if}
  </div>
  {#if detail}<TaskDetail task={detail} onopen={(t) => { opened = t; detailGid = t.gid; }} {sections} timeZone={tz} timer={timers[detail.gid]} {now} aiAvailable={data.aiAvailable} onchange={replace} onremove={(g) => { tasks = tasks.filter((t) => t.gid !== g); detailGid = ''; }} onclose={() => (detailGid = '')} ontimer={(g, tm) => { const nt = { ...timers }; if (tm) nt[g] = tm; else delete nt[g]; timers = nt; }} />{/if}
  </div>
  {/if}
  {#if undo}<div class="toast">{undo.label}<button onclick={reopen}>Undo</button></div>{/if}
  {#if creating && data.connected}<NewTask projects={projects} {today} oncreated={(t) => (tasks = [...tasks, t])} onclose={() => (creating = false)} />{/if}
</main>
</AppShell>

<style>
  main{padding:4px 0 60px;font-size:13px;color:#29344c}
  .connect{max-width:560px;background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:20px;display:grid;gap:10px}.connect h1{margin:0}.connect form{display:flex;gap:8px}.connect input{flex:1}
  input{border:1px solid #d9dfeb;border-radius:7px;padding:6px 8px;font:inherit}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;color:#43516c;cursor:pointer}button:disabled{opacity:.5;cursor:default}
  .primary{background:#3157de;border-color:#3157de;color:#fff}.ghost{background:#f2f3f6;border-color:#e4e7ee;color:#6b7690;font-weight:600}.link{border:0;background:none;color:#3157de;padding:0}.danger{color:#b53c50}
  .topline{display:flex;gap:8px;align-items:center;margin-bottom:6px}.chk{display:flex;gap:6px;align-items:center}.sp{flex:1}.muted{color:#8a95a8}.err{color:#a5414d}
  .head{display:flex;gap:12px 16px;align-items:center;flex-wrap:wrap}.head h1{margin:0;font-size:24px;letter-spacing:-.5px;white-space:nowrap}
  .tabs{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .tab,.newtask{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;height:40px;box-sizing:border-box;padding:0 15px;font-size:14px;line-height:1;border-radius:11px;border-width:2px;flex:none}
  .tab span{font-size:14px;line-height:1;width:16px;text-align:center}
  .tab.my{border-color:#d9d2ff;color:#6a4fe0;background:#f6f3ff}.tab.board{border-color:#cfe0ff;color:#2f6fe4;background:#f2f7ff}.tab.calendar{border-color:#cfe6d6;color:#2a8a55;background:#f2faf5}.tab.people{border-color:#cdeef0;color:#239aa5;background:#f1fbfc}.tab.recurring{border-color:#ddd8ff;color:#5b52e0;background:#f5f4ff}
  .tab.on.my{background:#6a4fe0;border-color:#6a4fe0;color:#fff}.tab.on.board{background:#2f7cf6;border-color:#2f7cf6;color:#fff}.tab.on.calendar{background:#2a9d5c;border-color:#2a9d5c;color:#fff}.tab.on.people{background:#239aa5;border-color:#239aa5;color:#fff}.tab.on.recurring{background:#5b52e0;border-color:#5b52e0;color:#fff}
  .newtask{background:#e95f63;border-color:#e95f63;color:#fff;box-shadow:0 4px 14px #e95f6355}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center}.act{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;height:36px;box-sizing:border-box;border-radius:999px;padding:0 15px;font-size:13px;border-width:2px;line-height:1}
  .act:disabled{opacity:.45}
  .act.help{background:#f2f3f6;border-color:#f2f3f6;color:#8a95a8}.act.help:not(:disabled){color:#6a3fd6;background:#f3edff;border-color:#e3d6ff}.act.plan{background:#f2994a;border-color:#f2994a;color:#fff}.act.sum{background:#2f7cf6;border-color:#2f7cf6;color:#fff}
  .act.all{background:#f6ecfa;border-color:#e6cdf2;color:#a03fc9}.act.all.on{background:#a03fc9;color:#fff}.act.time{background:#eef8f0;border-color:#cfe6d6;color:#2a8a55}.act.ack{background:#6a4fe0;border-color:#6a4fe0;color:#fff}
  .relw{position:relative;display:inline-flex}.pop{position:absolute;top:calc(100% + 4px);left:0;z-index:30}.timepop{display:flex;gap:5px;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:7px;box-shadow:0 8px 24px #151c2d22;white-space:nowrap}
  .alert{background:#fff3f3;border:1px solid #f3c9cf;color:#a5414d;border-radius:10px;padding:8px 12px;margin-bottom:8px}
  .aibox{background:#faf7ff;border:1px solid #ece3ff;border-radius:12px;padding:10px 14px;margin-bottom:10px}.aibox header{display:flex;justify-content:space-between}.aibox pre{white-space:pre-wrap;font:13px/1.5 system-ui,sans-serif;margin:6px 0 0}
  .bulk{position:sticky;top:0;z-index:10;display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:#eef1ff;border:1px solid #cfd8ff;border-radius:10px;padding:7px 10px;margin-bottom:8px}
  .split{display:block}main.withDetail .split{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:14px;align-items:start}
  @media(max-width:1000px){main.withDetail .split{display:block}main.withDetail .split > :global(.detail){position:fixed;inset:0;z-index:50;max-height:none;border-radius:0}}
  .group h2{display:flex;gap:10px;align-items:baseline;font-size:13px;letter-spacing:.5px;margin:16px 0 8px}.group h2 small{color:#8a95a8;font-weight:500;letter-spacing:0}.group h2 .selall{margin-left:auto;font-size:13px}
  h2.incoming{color:#e8862a}h2.overdue{color:#d9534f}h2.today{color:#2a9d5c}h2.upcoming,h2.nodate{color:#6b7690}.empty{margin:0 0 6px}
  .rows{list-style:none;margin:0;padding:0;display:grid;gap:8px}
  .trow{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:10px 14px}.trow.sel{background:#f3f6ff;border-color:#cfd8ff}.trow.active{border-color:#8da2f0;box-shadow:0 0 0 2px #dfe6ff}
  .trow input[type=checkbox]{width:20px;height:20px}
  .circle{width:34px;height:34px;border-radius:50%;padding:0;font-size:15px;color:#6b7690;border:2px solid #b9c1d1;flex:none}.circle:hover{background:#2a9d5c;border-color:#2a9d5c;color:#fff}
  .badge{font-size:11px;font-weight:800;letter-spacing:.5px;border-radius:7px;padding:5px 9px}.badge.overdue{background:#fdeceb;color:#d9534f}.badge.today{background:#eaf2ff;color:#2f6fe4}.badge.later{background:#f2f3f6;color:#6b7690}.badge.none{background:#f7f7f9;color:#a0a8b8}
  .timebtn{border-style:dashed;border-radius:999px;color:#8a95a8;font-weight:600}.timebtn.has{border-style:solid;background:#eef3ff;border-color:#cfdcff;color:#2f6fe4}
  .tname{border:0;background:none;padding:0;text-align:left;display:grid;gap:2px;min-width:180px;flex:1}.tname strong{font-size:15px;color:#1f2a44}.tname small{color:#6b7690;font-size:12px;font-weight:500}
  .stage{font-size:11px;font-weight:800;letter-spacing:.6px;border-radius:7px;padding:5px 9px}.stage.incoming{background:#fff1e3;color:#e8862a}.stage.todo{background:#eef1ff;color:#3157de}.stage.doing{background:#e7f1ff;color:#2f7cf6}.stage.done{background:#e9f7ef;color:#2a9d5c}
  .next{border-radius:999px;padding:6px 13px;color:#fff}.next.incoming{background:#6a4fe0;border-color:#6a4fe0}.next.todo{background:#2f7cf6;border-color:#2f7cf6}.next.doing{background:#2a9d5c;border-color:#2a9d5c}
  .tick{background:#e7f1ff;border-color:#cfe0ff;color:#2f6fe4;font-variant-numeric:tabular-nums;border-radius:999px}
  .rep{border-radius:999px;background:#eef3ff;border-color:#dfe8ff;color:#2f6fe4;font-size:13px;padding:6px 12px}.rep.none{background:none;border-style:dashed;color:#a0a8b8;font-weight:600}
  .days{display:flex;gap:4px;margin-left:auto}.day{display:grid;justify-items:center;gap:0;padding:3px 7px;border-radius:9px;min-width:52px;border-width:2px;background:#f7f8fa}.day i{font-style:normal;font-size:10px;font-weight:800}.day b{font-size:12px}.day small{font-size:10px;color:#6b7690;font-weight:600}
  .day.zero{border-color:#eceef2}.day.zero i{color:#a0a8b8}.day.light{border-color:#bfe3cb}.day.light i{color:#2a9d5c}.day.busy{border-color:#f6d2a8}.day.busy i{color:#e8862a}.day.full{border-color:#f3b7b5}.day.full i{color:#d9534f}.day.cur{background:#3157de;border-color:#3157de;color:#fff}.day.cur small,.day.cur i{color:#fff}
  .hint{color:#8a95a8;margin:0 0 8px}
  .board{display:flex;gap:14px;align-items:flex-start;overflow-x:auto;padding-bottom:10px}
  .col{background:#f0f1f4;border-radius:14px;padding:10px;width:320px;flex:none;display:grid;gap:10px}.col.shut{width:auto}.col header{display:flex;gap:8px;align-items:center;font-size:15px}.col header i{font-style:normal;color:#8a95a8}.chev{margin-left:auto;border:0;background:none;font-size:18px;color:#6b7690}
  .card{background:#fff;border-radius:12px;padding:12px;display:grid;gap:8px;box-shadow:0 1px 2px #151c2d14;cursor:grab}.card.active{outline:2px solid #8da2f0}
  .ctop{display:flex;gap:9px;align-items:flex-start}.ctop .circle{width:30px;height:30px}.ctop .tname{font-size:14px;font-weight:600;min-width:0;color:#1f2a44}
  .ptag{justify-self:start;background:#f0f1f4;border-radius:7px;padding:3px 8px;font-size:12px;color:#53607a}
  .cfoot{display:flex;gap:6px;align-items:center}.due{font-weight:700;font-size:12px}.due.overdue{color:#d9534f}.due.today{color:#2a9d5c}.due.later{color:#6b7690}.soft{background:#eaf2ff;border-color:#eaf2ff;color:#2f7cf6;border-radius:999px}
  .calhead{display:flex;gap:8px;align-items:center;margin-bottom:8px}
  .cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.wd{font-size:11px;color:#8a95a8;text-align:center}
  .cell{background:#fff;border:1px solid #e4e9f2;border-radius:8px;min-height:96px;padding:4px;display:flex;flex-direction:column;gap:3px;overflow:hidden}.cell.other{background:#f8f9fb;opacity:.7}.cell.today{border-color:#2a9d5c;box-shadow:inset 0 0 0 1px #2a9d5c}
  .dn{font-size:11px;font-weight:800;color:#6b7690}.ctask{text-align:left;font-size:11px;font-weight:600;padding:2px 5px;border-radius:5px;background:#eef3ff;border:0;color:#2f4fa8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ctask.over{background:#fdeceb;color:#b5403c}
  .people{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}.person{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:12px;display:grid;gap:8px}
  .person header{display:flex;gap:10px;align-items:center}.person header div{display:grid}.person header small{color:#8a95a8}.av{width:36px;height:36px;border-radius:50%;background:#e7f6f7;color:#239aa5;display:grid;place-items:center;font-weight:800}
  .counts{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;font-weight:700}.counts .o{color:#d9534f}.counts .d{color:#2a9d5c}
  .person ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}.person li{display:flex;gap:8px;font-size:12px}.person li .due{flex:none;width:64px}.person li a{color:#29344c;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .trow.rec .due{min-width:110px}
  .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2a44;color:#fff;border-radius:12px;padding:10px 14px;display:flex;gap:12px;align-items:center;z-index:70;box-shadow:0 10px 30px #151c2d55}.toast button{background:#fff;color:#1f2a44}
  @media(max-width:700px){.days{margin-left:0;overflow-x:auto;max-width:100%}.tname{min-width:0;flex-basis:100%}}
</style>
