<script lang="ts">
  // Email → Asana task. AI drafts title/due/project/notes from the email (editable); checked attachments are
  // uploaded to the task; the email is then marked read, so the follow-up lives in Asana, not the inbox.
  import { asanaApi } from '$lib/asana-client';
  // title/due: optional pre-fill (e.g. the AI card's suggested follow-up) that wins over the drafted values.
  let { emailKey, subject, title = '', due = '', oncreated, onclose }: { emailKey: string; subject: string; title?: string; due?: string; oncreated: (note: string, markedRead: boolean) => void; onclose: () => void } = $props();
  type Att = { id: string; name: string; size: number; mime: string };
  let loading = $state(true), busy = $state(false), error = $state(''), notConnected = $state(false), aiNote = $state('');
  let name = $state(''), notes = $state(''), day = $state(''), time = $state(''), project = $state(''), markRead = $state(true);
  let projects = $state<{ gid: string; name: string }[]>([]), attachments = $state<Att[]>([]), skip = $state<string[]>([]);
  $effect(() => {
    const key = emailKey;
    name = subject; loading = true; error = ''; notConnected = false;
    asanaApi('emailDraft', { key }).then((d) => {
      if (key !== emailKey) return;
      name = title || d.name; notes = d.notes; day = (/^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '') || d.due; time = d.time || ''; project = d.project || ''; projects = d.projects; attachments = d.attachments; skip = [];
      aiNote = d.aiUsed ? '✦ Drafted by AI — check it before creating.' : d.aiError ? `AI draft unavailable (${d.aiError}); filled from the email.` : 'Filled from the email (turn on AI in Settings → AI for a smarter draft).';
    }).catch((e) => { error = e.message; notConnected = /not connected|token/i.test(e.message); }).finally(() => (loading = false));
  });
  const size = (n: number) => n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  async function create() {
    if (!name.trim()) { error = 'Give the task a name.'; return; }
    busy = true; error = '';
    try {
      const r = await asanaApi<{ note: string }>('fromEmail', { key: emailKey, name, notes, day, time, project, attachments: attachments.filter((a) => !skip.includes(a.id)).map((a) => a.id), markRead });
      oncreated(`Asana task created — ${r.note}${markRead ? '; email marked read' : ''}.`, markRead); onclose();
    } catch (e) { error = e instanceof Error ? e.message : 'Could not create the task.'; }
    finally { busy = false; }
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <form class="sheet" onsubmit={(e) => { e.preventDefault(); create(); }}>
    <h3>Create Asana task</h3>
    {#if loading}<p class="muted">✦ Reading the email and drafting the task…</p>
    {:else if notConnected}<p class="err">{error} <a href="/asana">Connect Asana</a></p>
    {:else}
      <small class="ai">{aiNote}</small>
      <label class="col">Title<input bind:value={name}></label>
      <div class="row"><label>Due <input type="date" bind:value={day}></label><label>Time <input type="time" bind:value={time}></label>
        <label>Project <select bind:value={project}><option value="">My Tasks only</option>{#each projects as p (p.gid)}<option value={p.gid}>{p.name}</option>{/each}</select></label></div>
      <div class="col"><span class="lh">Description <button type="button" class="link" onclick={() => (notes = '')}>Clear</button></span><textarea rows="10" bind:value={notes}></textarea></div>
      {#if attachments.length}<div class="col"><span class="lh">Attachments — checked ones get attached to the task</span>
        {#each attachments as a (a.id)}<label class="att"><input type="checkbox" checked={!skip.includes(a.id)} onchange={(e) => (skip = e.currentTarget.checked ? skip.filter((x) => x !== a.id) : [...skip, a.id])}> 📎 {a.name} <small>{size(a.size)}</small></label>{/each}</div>{/if}
      <label class="chk"><input type="checkbox" bind:checked={markRead}> Mark the email read after creating</label>
      {#if error}<p class="err">{error}</p>{/if}
    {/if}
    <div class="row end"><button type="button" onclick={onclose}>Cancel</button>{#if !loading && !notConnected}<button class="primary" disabled={busy}>{busy ? 'Creating…' : 'Create task'}</button>{/if}</div>
  </form>
</div>

<style>
  .backdrop{position:fixed;inset:0;background:#151c2d55;z-index:60;display:grid;place-items:start center;padding:6vh 16px;overflow:auto}
  .sheet{background:#fff;border-radius:14px;padding:18px;width:min(620px,100%);display:grid;gap:10px;box-shadow:0 20px 50px #151c2d44;font-size:13px}
  h3{margin:0}.ai{color:#6a3fd6;font-weight:600}.muted{color:#8a95a8}.err{color:#a5414d;margin:0}.err a{color:#3157de;font-weight:700}
  .col{display:grid;gap:4px;color:#53607a;font-weight:700;font-size:11px}.lh{display:flex;justify-content:space-between}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.row label{display:flex;gap:5px;align-items:center;color:#53607a;font-weight:600}.end{justify-content:flex-end}
  input,select,textarea{border:1px solid #d9dfeb;border-radius:7px;padding:6px 8px;font:inherit;font-size:13px;font-weight:400;min-width:0}textarea{resize:vertical}
  .att{display:flex;gap:6px;align-items:center;background:#f7f8fb;border-radius:7px;padding:5px 8px;font-weight:500;font-size:12px;color:#29344c}.att small{color:#8a95a8}
  .chk{display:flex;gap:6px;align-items:center;color:#53607a}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:7px 14px;font-weight:700;color:#43516c;cursor:pointer}.primary{background:#e95f63;border-color:#e95f63;color:#fff}.link{border:0;background:none;color:#3157de;padding:0;font-size:11px}
</style>
