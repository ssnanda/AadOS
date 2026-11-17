<script lang="ts">
  // New Task: name, description, project, due day/time, repeat. Assigned to me.
  import { asanaApi } from '$lib/asana-client';
  import { NO_REPEAT, recurrenceSummary, type Recurrence, type Task } from '$lib/asana-model';
  import RecurrenceEditor from './RecurrenceEditor.svelte';
  let { projects, today, oncreated, onclose }: { projects: { gid: string; name: string }[]; today: string; oncreated: (t: Task) => void; onclose: () => void } = $props();
  let name = $state(''), notes = $state(''), project = $state(''), day = $state(''), time = $state('');
  let recurrence = $state<Recurrence>(NO_REPEAT), editing = $state(false), busy = $state(false), error = $state('');
  $effect(() => { if (!day) day = today; });
  async function create() {
    if (!name.trim()) { error = 'Give the task a name.'; return; }
    busy = true; error = '';
    try { const r = await asanaApi<{ task: Task }>('create', { name, notes, project, day, time, recurrence }); oncreated(r.task); onclose(); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not create the task.'; }
    finally { busy = false; }
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <form class="sheet" onsubmit={(e) => { e.preventDefault(); create(); }}>
    <h3>New task</h3>
    <!-- svelte-ignore a11y_autofocus -->
    <input class="title" bind:value={name} placeholder="Task name" aria-label="Task name" autofocus>
    <div class="row"><label>Due <input type="date" bind:value={day}></label><label>Time <input type="time" bind:value={time} disabled={!day}></label>
      <label>Project <select bind:value={project}><option value="">My Tasks only</option>{#each projects as p (p.gid)}<option value={p.gid}>{p.name}</option>{/each}</select></label></div>
    <div class="rel"><button type="button" class="chip" onclick={() => (editing = !editing)}>⟳ {recurrenceSummary(recurrence) || 'Does not repeat'} ✎</button>
      {#if editing}<div class="pop"><RecurrenceEditor value={recurrence} oncancel={() => (editing = false)} onsave={(r) => { recurrence = r; editing = false; }} /></div>{/if}</div>
    <textarea rows="5" bind:value={notes} placeholder="Description"></textarea>
    {#if error}<p class="err">{error}</p>{/if}
    <div class="row end"><button type="button" onclick={onclose}>Cancel</button><button class="primary" disabled={busy}>{busy ? 'Creating…' : 'Create task'}</button></div>
  </form>
</div>

<style>
  .backdrop{position:fixed;inset:0;background:#151c2d55;z-index:60;display:grid;place-items:start center;padding:8vh 16px}
  .sheet{background:#fff;border-radius:14px;padding:18px;width:min(560px,100%);display:grid;gap:10px;box-shadow:0 20px 50px #151c2d44;font-size:13px}
  h3{margin:0}.title{font-size:16px;font-weight:700}
  input,select,textarea{border:1px solid #d9dfeb;border-radius:7px;padding:6px 8px;font:inherit;min-width:0}textarea{resize:vertical}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.row label{display:flex;gap:5px;align-items:center;color:#53607a;font-weight:600}.end{justify-content:flex-end}
  .rel{position:relative}.pop{position:absolute;top:34px;left:0;z-index:5}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:7px 14px;font-weight:700;color:#43516c;cursor:pointer}.primary{background:#e95f63;border-color:#e95f63;color:#fff}
  .chip{background:#eef3ff;border-color:#cfdcff;color:#3157de;padding:5px 10px;font-size:12px}.err{color:#a5414d;margin:0}
</style>
