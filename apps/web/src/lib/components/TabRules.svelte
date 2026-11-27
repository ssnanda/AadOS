<script lang="ts">
  // Inbox tab rules (Settings → Rules): Leads, Scanned Docs, Rent Payments. Built-in detection (read-only text, on/off)
  // + include / exclude conditions, edit, dry run. Server: $lib/server/tab-rules.ts via /emails/rules.
  type C = { field: string; op: string; text: string };
  type Tab = { id: string; label: string; view: string; builtInText: string[]; rule: { builtIn: boolean; include: C[]; exclude: C[] } };
  type Hit = { key: string; subject: string; sender: string; receivedAt: string; accountEmail: string; why: string };
  let tabs = $state<Tab[]>([]), error = $state(''), open = $state(''), busy = $state(false), note = $state('');
  let dry = $state<Record<string, { days: number; total: number; excluded: number; older: number; rows: Hit[] }>>({});

  async function call(payload: Record<string, unknown>) {
    const r = await fetch('/emails/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.ok === false) throw new Error(b.error || `HTTP ${r.status}`);
    return b;
  }
  $effect(() => { call({ op: 'tabs' }).then((b) => (tabs = b.tabs)).catch((e) => (error = e.message)); });
  const payload = (t: Tab) => ({ tab: t.id, builtIn: t.rule.builtIn, include: t.rule.include.filter((c) => c.text.trim()), exclude: t.rule.exclude.filter((c) => c.text.trim()) });
  async function run(t: Tab, days: number) {
    busy = true; note = '';
    try { dry = { ...dry, [t.id]: await call({ op: 'tab-dry', days, ...payload(t) }) }; } catch (e) { note = e instanceof Error ? e.message : 'Dry run failed.'; }
    busy = false;
  }
  async function save(t: Tab) {
    busy = true; note = '';
    try { note = (await call({ op: 'tab-update', ...payload(t) })).message; } catch (e) { note = e instanceof Error ? e.message : 'Save failed.'; }
    busy = false;
  }
  const add = (list: C[]) => list.push({ field: 'from', op: 'contains', text: '' });
  const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const WINDOWS = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year'], [0, 'All']] as const;
  const WHY: Record<string, string> = { 'built-in': 'built-in', yours: 'your include', excluded: 'excluded by you' };
</script>
{#snippet conds(list: C[], label: string)}
  <div class="clist"><b>{label}</b>
    {#each list as c, i (i)}<div class="c">
      <select bind:value={c.field} aria-label="Field"><option value="from">From</option><option value="subject">Subject</option><option value="to">To</option></select>
      <select bind:value={c.op} aria-label="Match"><option value="contains">contains</option><option value="regex">matches pattern</option></select>
      <input bind:value={c.text} placeholder="text" aria-label="Text">
      <button type="button" class="link" onclick={() => list.splice(i, 1)} aria-label="Remove">✕</button>
    </div>{/each}
    <button type="button" class="link" onclick={() => add(list)}>+ {label.toLowerCase()} condition</button>
  </div>
{/snippet}
{#if error}<p class="err">{error}</p>{/if}
{#each tabs as t (t.id)}
  <article class="tab">
    <div class="head"><b>{t.label}</b>{#if !t.rule.builtIn}<span class="chip">built-in off</span>{/if}{#if t.rule.include.length}<span class="chip">+{t.rule.include.length} include</span>{/if}{#if t.rule.exclude.length}<span class="chip">−{t.rule.exclude.length} exclude</span>{/if}
      <span class="sp"></span><a class="link" href={`/emails?view=${t.view}`}>Open tab</a><button type="button" onclick={() => (open = open === t.id ? '' : t.id)}>{open === t.id ? 'Close' : 'Edit · Dry run'}</button></div>
    {#if open === t.id}
      <div class="body">
        <label class="chk"><input type="checkbox" bind:checked={t.rule.builtIn}> Built-in detection</label>
        <ul class="bi" class:off={!t.rule.builtIn}>{#each t.builtInText as line}<li>{line}</li>{/each}</ul>
        {@render conds(t.rule.include, 'Include')}
        {@render conds(t.rule.exclude, 'Exclude')}
        <p class="muted">An email is in the tab when an include matches or the built-in detection does, unless an exclude matches. Tabs only label mail; nothing changes in the mailbox.</p>
        <div class="row">{#each WINDOWS as [d, l] (d)}<button type="button" class:on={dry[t.id]?.days === d} disabled={busy} onclick={() => run(t, d)}>{l}</button>{/each}<span class="sp"></span><button type="button" class="primary" disabled={busy} onclick={() => save(t)}>Save</button></div>
        {#if note}<p class="muted">{note}</p>{/if}
        {#if dry[t.id]}{@const d = dry[t.id]}
          <p><b>{d.total}</b> in the tab {d.days ? `(last ${d.days} days)` : '(all mail)'}{d.excluded ? ` · ${d.excluded} kept out by your excludes` : ''}{d.older ? ` · ${d.older} older` : ''}</p>
          {#if !d.total && d.older}<button type="button" class="link" onclick={() => run(t, d.days === 7 ? 30 : d.days === 30 ? 90 : d.days === 90 ? 365 : 0)}>Look further back</button>{/if}
          <ul class="hits">{#each d.rows as h (h.key)}<li class:ex={h.why === 'excluded'}><span class="s">{h.subject || '(no subject)'}</span><span class="m">{h.sender} · {h.accountEmail} · {when(h.receivedAt)}</span><span class="w">{WHY[h.why] || h.why}</span></li>{/each}</ul>
        {/if}
      </div>
    {/if}
  </article>
{/each}
<style>
  .tab{border:1px solid #e7ebf2;border-radius:8px;padding:6px 8px;background:#fff;margin-bottom:4px;font-size:12px}
  .head{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.sp{flex:1}.chip{background:#f1f3f8;border-radius:6px;padding:1px 7px;font-size:11px;color:#53607a}
  .body{margin-top:6px;display:grid;gap:6px}.bi{margin:0;padding-left:18px;color:#5b6a86}.bi.off{opacity:.45;text-decoration:line-through}
  .clist{display:grid;gap:4px}.c{display:grid;grid-template-columns:90px 130px 1fr auto;gap:6px}
  select,input:not([type]){border:1px solid #dbe1eb;border-radius:7px;padding:4px 6px;font:inherit;font-size:12px;min-width:0}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button.on{background:#eef1ff;border-color:#8da2f0;color:#3157de}
  .primary{background:#3157de;border-color:#3157de;color:#fff}.link{border:0;background:none;padding:0;color:#3157de;font-weight:700;text-decoration:none;cursor:pointer}
  .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.chk{display:inline-flex;gap:4px;align-items:center;font-weight:700}.muted{color:#8a95a8;margin:0}.err{color:#a5414d}p{margin:0}
  .hits{list-style:none;margin:0;padding:0;max-height:300px;overflow:auto}.hits li{display:grid;grid-template-columns:1fr auto;border-top:1px solid #eef0f5;padding:4px 0}.hits .s{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hits .m{color:#8a95a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hits .w{grid-row:1/3;grid-column:2;align-self:center;color:#1e7a47;font-weight:700}.hits li.ex{opacity:.6}.hits li.ex .w{color:#a5414d}
  @media(max-width:600px){.c{grid-template-columns:1fr 1fr auto}.c input{grid-column:1/-1}}
</style>
