<script lang="ts">
  // Rule builder (web): create from one or more emails (`keys`), create blank, or edit an AadOS rule (`ruleId`).
  // Same server as the phone (/emails/rules → $lib/server/rule-draft.ts). Dry run lists what the rule matches
  // in all stored mail, last 7 days first, wider on request. Nothing changes until Create / Save.
  type Cond = { field: string; op: string; text: string; label?: string; count?: number; picked: boolean };
  type Target = { value: string; label: string; disabled?: string };
  type Hit = { key: string; subject: string; sender: string; receivedAt: string; accountEmail: string; unread: boolean; wouldChange: boolean };
  let { keys = [], ruleId = '', onclose, onsaved }: { keys?: string[]; ruleId?: string; onclose: () => void; onsaved?: (message: string) => void } = $props();

  let loading = $state(true), busy = $state(false), error = $state(''), note = $state('');
  let conds = $state<Cond[]>([]), targets = $state<Target[]>([]), actions = $state<{ value: string; label: string }[]>([]);
  let body = $state(''), match = $state('all'), action = $state('mark-read'), target = $state('aados:'), mode = $state('ask'), applyExisting = $state(true);
  let dry = $state<{ days: number; total: number; older: number; label: string; rows: Hit[] } | null>(null);
  const editing = $derived(Boolean(ruleId));
  const gmail = $derived(target.startsWith('gmail:'));
  const picked = $derived(conds.filter((c) => c.picked && c.text.trim()).map((c) => ({ field: c.field, op: c.op, text: c.text.trim() })));

  async function call(payload: Record<string, unknown>) {
    const r = await fetch('/emails/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.ok === false) throw new Error(b.error || `HTTP ${r.status}`);
    return b;
  }
  $effect(() => {
    void keys; void ruleId;
    (async () => {
      loading = true; error = ''; dry = null;
      try {
        if (ruleId) {
          const [g, o] = await Promise.all([call({ op: 'get', id: ruleId }), call({ op: 'options' })]);
          conds = g.rule.conditions.map((c: Cond) => ({ ...c, picked: true }));
          match = g.rule.match; action = g.rule.action; target = g.rule.target; mode = g.rule.mode;
          targets = o.targets; actions = o.actions;
        } else if (keys.length) {
          const d = await call({ op: 'draft', keys });
          conds = d.candidates; targets = d.targets; actions = d.actions; body = d.body || '';
          target = (d.targets as Target[]).find((t) => !t.disabled)?.value || 'aados:';
        } else {
          const o = await call({ op: 'options' });
          conds = [{ field: 'from', op: 'contains', text: '', picked: true }, { field: 'subject', op: 'contains', text: '', picked: true }];
          targets = o.targets; actions = o.actions; target = 'aados:';
        }
      } catch (e) { error = e instanceof Error ? e.message : 'Could not load.'; }
      loading = false;
    })();
  });
  const rule = () => ({ conditions: picked, match, action, target, mode });
  async function dryRun(days: number) {
    busy = true; note = '';
    try { dry = await call({ op: 'preview', days, ...rule() }); } catch (e) { note = e instanceof Error ? e.message : 'Dry run failed.'; }
    busy = false;
  }
  async function save() {
    busy = true; note = '';
    try {
      const r = editing ? await call({ op: 'update', id: ruleId, ...rule() }) : await call({ op: 'create', ...rule(), applyExisting: applyExisting && target.startsWith('aados') });
      onsaved?.(r.message); onclose();
    } catch (e) { note = e instanceof Error ? e.message : 'Save failed.'; }
    busy = false;
  }
  // Body picker: the selected text inside the body box becomes a Body condition.
  let bodyBox: HTMLElement | undefined = $state();
  function useSelection() {
    const sel = window.getSelection(), text = sel?.toString().trim() || '';
    if (!text || !bodyBox || !sel?.anchorNode || !bodyBox.contains(sel.anchorNode)) { note = 'Select some text in the body first.'; return; }
    conds = [...conds, { field: 'body', op: 'contains', text: text.slice(0, 200), label: 'Body contains', picked: true }];
    note = '';
  }
  const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const WINDOWS = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year'], [0, 'All']] as const;
</script>
<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />
<div class="scrim" role="presentation" onclick={onclose}></div>
<div class="rb" role="dialog" aria-modal="true" aria-label="Rule">
  <header><strong>{editing ? 'Edit rule' : keys.length === 1 ? 'Rule from this email' : keys.length ? `Rule from ${keys.length} emails` : 'New rule'}</strong><button type="button" class="x" onclick={onclose} aria-label="Close">✕</button></header>
  {#if loading}<p class="muted">Loading…</p>
  {:else if error}<p class="err">{error}</p>
  {:else}
  <div class="scroll">
    <h4>When</h4>
    {#each conds as c, i (i)}
      <div class="cond">
        <input type="checkbox" bind:checked={c.picked} aria-label="Use this condition">
        <select bind:value={c.field} aria-label="Field"><option value="from">From</option><option value="subject">Subject</option><option value="to">To</option><option value="body">Body</option></select>
        <select bind:value={c.op} aria-label="Match"><option value="contains">contains</option><option value="regex">matches pattern</option></select>
        <input bind:value={c.text} placeholder={c.op === 'regex' ? 'regular expression' : 'text'} aria-label="Text">
        <small title={c.label}>{c.label || ''}{typeof c.count === 'number' && c.count >= 0 && c.field !== 'body' ? ` · ${c.count}` : ''}</small>
        <button type="button" class="link" onclick={() => (conds = conds.filter((_, n) => n !== i))} aria-label="Remove condition">✕</button>
      </div>
    {/each}
    <div class="row"><button type="button" class="link" onclick={() => (conds = [...conds, { field: 'subject', op: 'contains', text: '', picked: true }])}>+ Condition</button>
      {#if picked.length > 1}<select bind:value={match} aria-label="Combine"><option value="all">All must match</option><option value="any">Any matches</option></select>{/if}</div>
    {#if body}<details class="body"><summary>Pick from the body</summary><div class="text" bind:this={bodyBox}>{body}</div><button type="button" onclick={useSelection}>Use selected text</button></details>{/if}

    <h4>Then</h4>
    <div class="row"><select bind:value={action} aria-label="Action">{#each actions as a (a.value)}<option value={a.value}>{a.label}</option>{/each}</select>
      {#if !gmail}<select bind:value={mode} aria-label="Mode"><option value="ask">Ask first</option><option value="auto">Auto</option></select>{/if}
      {#if !gmail && !editing}<label class="chk"><input type="checkbox" bind:checked={applyExisting}> Also apply to emails I already have</label>{/if}</div>

    <h4>Where</h4>
    <div class="targets">{#each targets as t (t.value)}<label class:off={t.disabled} title={t.disabled || ''}><input type="radio" name="rb-target" value={t.value} bind:group={target} disabled={Boolean(t.disabled) || (editing && !t.value.startsWith('aados'))}> {t.label}{#if t.disabled}<small>{t.disabled}</small>{/if}</label>{/each}</div>
    {#if gmail}<p class="muted">Gmail filter: contains only, all conditions, mark read. Gmail applies it to new mail.</p>{/if}

    <h4>Dry run <small>nothing changes</small></h4>
    <div class="row">{#each WINDOWS as [d, l] (d)}<button type="button" class:on={dry?.days === d} disabled={busy || !picked.length} onclick={() => dryRun(d)}>{l}</button>{/each}</div>
    {#if dry}
      <p class="sum"><b>{dry.total}</b> match{dry.total === 1 ? '' : 'es'} {dry.days ? `in the last ${dry.days} days` : 'in all mail'}{dry.older ? ` · ${dry.older} older` : ''}</p>
      {#if !dry.total && dry.older}<p class="muted">None in this window. <button type="button" class="link" onclick={() => dryRun(dry!.days === 7 ? 30 : dry!.days === 30 ? 90 : dry!.days === 90 ? 365 : 0)}>Look further back</button></p>{/if}
      {#if dry.rows.length}<ul class="hits">{#each dry.rows as h (h.key)}<li class:read={!h.unread}><span class="s">{h.subject || '(no subject)'}</span><span class="m">{h.sender} · {h.accountEmail} · {when(h.receivedAt)}</span><span class="w" class:no={!h.wouldChange}>{h.wouldChange ? 'would change' : 'already done'}</span></li>{/each}</ul>{/if}
      {#if dry.total > dry.rows.length}<p class="muted">Showing the newest {dry.rows.length}.</p>{/if}
    {/if}
  </div>
  <footer>{#if note}<span class="err">{note}</span>{/if}<span class="sp"></span><button type="button" onclick={onclose}>Cancel</button><button type="button" class="primary" disabled={busy || !picked.length} onclick={save}>{editing ? 'Save' : 'Create rule'}</button></footer>
  {/if}
</div>
<style>
  .scrim{position:fixed;inset:0;background:#151c2d55;z-index:80}
  .rb{position:fixed;z-index:81;top:5vh;left:50%;transform:translateX(-50%);width:min(760px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 20px 50px #151c2d40;font-size:12px;color:#29344c}
  header{display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid #e4e9f2}header strong{flex:1;font-size:14px}
  .scroll{overflow:auto;padding:4px 14px 10px}h4{margin:10px 0 4px;font-size:12px;color:#43516c}h4 small{font-weight:400;color:#8a95a8}
  .cond{display:grid;grid-template-columns:auto 90px 130px 1fr auto auto;gap:6px;align-items:center;margin-bottom:4px}.cond small{color:#8a95a8;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  select,input:not([type]),input[type=text]{border:1px solid #dbe1eb;border-radius:7px;padding:4px 6px;font:inherit;font-size:12px;min-width:0}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button:disabled{opacity:.5;cursor:default}button.on{background:#eef1ff;border-color:#8da2f0;color:#3157de}
  .primary{background:#3157de;border-color:#3157de;color:#fff}.link{border:0;background:none;padding:0;color:#3157de}.x{border:0}
  .chk{display:inline-flex;gap:4px;align-items:center}.targets{display:grid;gap:3px}.targets label{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}.targets label.off{color:#8a95a8}.targets small{flex-basis:100%;padding-left:20px;color:#8a95a8}
  .body .text{white-space:pre-wrap;max-height:180px;overflow:auto;border:1px solid #eef0f5;border-radius:7px;padding:6px;margin:4px 0;color:#53607a}
  .sum{margin:6px 0 2px}.muted{color:#8a95a8;margin:4px 0}.err{color:#a5414d}
  .hits{list-style:none;margin:4px 0 0;padding:0;display:grid;gap:2px;max-height:260px;overflow:auto}.hits li{display:grid;grid-template-columns:1fr auto;gap:0 8px;border-top:1px solid #eef0f5;padding:4px 0}.hits li .s{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hits li.read .s{font-weight:500}.hits li .m{grid-column:1;color:#8a95a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hits li .w{grid-row:1/3;grid-column:2;align-self:center;color:#1e7a47;font-weight:700}.hits li .w.no{color:#8a95a8;font-weight:500}
  footer{display:flex;gap:6px;align-items:center;padding:8px 14px;border-top:1px solid #e4e9f2}.sp{flex:1}
  @media(max-width:600px){.cond{grid-template-columns:auto 1fr 1fr auto;}.cond input:not([type=checkbox]){grid-column:1/-1}.cond small{display:none}}
</style>
