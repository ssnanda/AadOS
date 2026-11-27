<script lang="ts">
  // Settings → Rules. Safety model and data come from +page.server.ts / $lib/server/mail-rules.ts.
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import RuleBuilder from '$lib/components/RuleBuilder.svelte';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const acct = (id: string) => data.accounts.find((a) => a.id === id);
  const acctLabel = (id: string) => (id ? acct(id)?.email || id : 'All accounts');
  const gmailWithFilter = (ids: string[]) => data.accounts.filter((a) => a.provider === 'gmail' && a.canFilter && ids.includes(a.id));
  const labelName = (labels: { id: string; name: string }[], id: string) => labels.find((l) => l.id === id)?.name || id;
  // Gmail may omit `criteria` or `action` (e.g. forward-only or legacy filters).
  type GFilter = { criteria?: Record<string, unknown>; action?: { addLabelIds?: string[]; removeLabelIds?: string[]; forward?: string } };
  const describeFilter = (f: GFilter, labels: { id: string; name: string }[]) => {
    const a = f.action || {};
    const what = [...(a.addLabelIds || []).map((l) => (l === 'TRASH' ? 'delete' : `label ${labelName(labels, l)}`)), ...(a.removeLabelIds?.includes('UNREAD') ? ['mark read'] : []), ...(a.removeLabelIds?.includes('INBOX') ? ['skip inbox'] : []), ...(a.forward ? [`forward to ${a.forward}`] : [])];
    return `${Object.entries(f.criteria || {}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join(', ') || 'any mail'} → ${what.join(', ') || 'no action'}`;
  };
  const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const zohoUrl = (dc: string) => `https://mail.zoho.${dc}/zm/#settings`;
  // Rule builder (new / edit, with dry run). `ruleId` '' = new rule.
  let builder = $state<{ ruleId: string } | null>(null), saved = $state('');
  const openBuilder = (ruleId = '') => { builder = { ruleId }; saved = ''; };
</script>
<svelte:head><title>Rules · Settings · AadOS</title></svelte:head>
<main>
<h1>Email rules</h1>
{#if saved}<div class="ok">{saved}</div>{/if}
{#if builder}<RuleBuilder ruleId={builder.ruleId} onclose={() => (builder = null)} onsaved={(m) => { saved = m; void invalidateAll(); }} />{/if}
{#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}
{#if form && 'ok' in form && form.ok}<div class="ok">{form.ok}</div>{/if}
<details class="how"><summary>How rules act</summary><p>AadOS rules act automatically only on mail that arrives after the rule exists, and only in <b>Auto</b> mode. <b>Ask</b> rules collect matches here for Apply / Skip. Existing mail changes only with <b>Apply now</b>. Delete moves to the mailbox Trash. Gmail filters run inside Gmail on new mail. <b>matches pattern</b> = case-insensitive regular expression (e.g. <code>Online Payment:.*LLC</code>). Body conditions use the search index; new mail is read from the mailbox when a rule needs it. Every AadOS action is logged below.</p></details>

<section>
  <h2>Suggestions <small>{data.suggestions.length}</small></h2>
  {#if !data.suggestions.length}<p class="muted">No suggestions right now.</p>{:else}
  <div class="table">{#each data.suggestions as s (s.address)}
    <form method="POST" action="?/adopt" use:enhance class="srow">
      <input type="hidden" name="field" value="from"><input type="hidden" name="text" value={s.address}>
      <div class="who"><b title={s.address}>{s.name}</b><small>{s.address} · {s.reason}</small></div>
      <select name="action" aria-label="Action"><option value="mark-read" selected={s.action === 'mark-read'}>Mark read</option><option value="delete" selected={s.action === 'delete'}>Delete (Trash)</option><option value="importance-high">Mark important</option></select>
      <select name="target" aria-label="Where">
        {#each gmailWithFilter(s.accounts) as g (g.id)}<option value={`gmail:${g.id}`}>Gmail filter · {g.email}</option>{/each}
        {#each s.accounts as id (id)}<option value={`aados:${id}`}>AadOS · {acctLabel(id)}</option>{/each}
        <option value="aados:">AadOS · all accounts</option>
      </select>
      <select name="mode" aria-label="Mode"><option value="ask">Ask first</option><option value="auto">Auto</option></select>
      <button>Create</button>
      <button formaction="?/dismiss" name="address" value={s.address} class="link">Hide</button>
    </form>
  {/each}</div>{/if}
</section>

<section>
  <h2>AadOS rules <small>{data.rules.length}</small></h2>
  <button type="button" class="newrule" onclick={() => openBuilder()}>+ New rule</button>
  {#if !data.rules.length}<p class="muted">No AadOS rules yet.</p>{/if}
  {#each data.rules as r (r.id)}
    <article class="rule" class:off={!r.enabled}>
      <div class="rhead">
        <b>{r.label}</b><span class="chip">{acctLabel(r.accountId)}</span><span class="chip" class:auto={r.mode === 'auto'}>{r.mode === 'auto' ? 'Auto' : 'Ask first'}</span>{#if !r.enabled}<span class="chip">Paused</span>{/if}
        <span class="sp"></span>
        <button type="button" onclick={() => openBuilder(r.id)} title="Edit conditions, action, account, mode; dry run inside">Edit · Dry run</button>
        <form method="POST" action="?/mode" use:enhance><input type="hidden" name="id" value={r.id}><button>{r.mode === 'auto' ? '→ Ask first' : '→ Auto'}</button></form>
        <form method="POST" action="?/toggle" use:enhance><input type="hidden" name="id" value={r.id}><button>{r.enabled ? 'Pause' : 'Resume'}</button></form>
        <form method="POST" action="?/remove" use:enhance onsubmit={(e) => { if (!confirm('Remove this rule? Mail it already changed stays changed.')) e.preventDefault(); }}><input type="hidden" name="id" value={r.id}><button class="danger">Remove</button></form>
      </div>
      <div class="rbody">
        {#if r.fresh}<form method="POST" action="?/apply" use:enhance class="pend"><input type="hidden" name="id" value={r.id}><input type="hidden" name="which" value="fresh"><span><b>{r.fresh}</b> new waiting</span><button>Apply</button><button formaction="?/skip" class="link">Skip</button></form>{/if}
        {#if r.existing}<form method="POST" action="?/apply" use:enhance class="pend" onsubmit={(e) => { if (r.action === 'delete' && !confirm(`Move ${r.existing} existing emails to Trash?`)) e.preventDefault(); }}><input type="hidden" name="id" value={r.id}><input type="hidden" name="which" value="existing"><span><b>{r.existing}</b> existing match</span><button>Apply now</button><button formaction="?/skip" class="link">Skip</button></form>{/if}
        {#if r.fresh || r.existing}<a class="link" href={`/emails?view=all&q=${encodeURIComponent(r.text)}${r.accountId ? `&account=${encodeURIComponent(r.accountId)}` : ''}`}>Review in Emails</a>{/if}
        {#if r.sample.length}<details class="sample"><summary>Examples</summary><ul>{#each r.sample as x}<li>{x.subject || '(no subject)'} <small>{x.sender} · {when(x.receivedAt)}</small></li>{/each}</ul></details>{/if}
      </div>
    </article>
  {/each}
</section>

<section>
  <h2>Gmail filters <small>native</small></h2>
  {#if !data.gmail.length}<p class="muted">No Gmail accounts.</p>{/if}
  {#each data.gmail as g (g.account.id)}
    <div class="native">
      <h3>{g.account.email} <small>{g.filters.length}</small></h3>
      {#if g.error}<p class="err">{g.error}</p>{:else}
        <ul>{#each g.filters as f (f.id)}<li><span>{describeFilter(f, g.labels)}</span><form method="POST" action="?/gmailRemove" use:enhance onsubmit={(e) => { if (!confirm('Delete this Gmail filter?')) e.preventDefault(); }}><input type="hidden" name="accountId" value={g.account.id}><input type="hidden" name="id" value={f.id}><button class="link danger">Delete</button></form></li>{:else}<li class="muted">No filters.</li>{/each}</ul>
        <details class="add"><summary>+ Gmail filter</summary>
          <form method="POST" action="?/gmailCreate" use:enhance class="addrow"><input type="hidden" name="accountId" value={g.account.id}>
            <select name="field" aria-label="Match"><option value="from">From</option><option value="subject">Subject</option></select>
            <input name="text" placeholder="contains…" aria-label="Match text" required>
            <select name="labelId" aria-label="Label"><option value="">No label</option>{#each g.labels as l (l.id)}<option value={l.id}>Label: {l.name}</option>{/each}</select>
            <label class="chk"><input type="checkbox" name="markRead"> Mark read</label><label class="chk"><input type="checkbox" name="archive"> Skip inbox</label>
            <button>Create</button>
          </form>
        </details>
      {/if}
    </div>
  {/each}
  {#each data.accounts.filter((a) => a.provider === 'zoho') as z (z.id)}
    <div class="native"><h3>{z.email} <small>Zoho</small></h3><p class="muted">Zoho's filters aren't readable through its API. Manage them in <a href={zohoUrl(z.dataCenter)} target="_blank" rel="noopener">Zoho Mail → Settings → Filters</a>, or use an AadOS rule.</p></div>
  {/each}
</section>

<section>
  <h2>Built-in <small>read-only</small></h2>
  <div class="builtin">
    {#each data.builtIn as b (b.group)}<div><h3>{b.group}</h3><dl>{#each b.rules as [name, what] (name)}<dt>{name}</dt><dd>{what}</dd>{/each}</dl></div>{/each}
    <div><h3>Views <a href="/settings/views" class="link">edit</a></h3><dl>{#each data.views as v (v.id)}<dt>{v.name}{v.enabled === false ? ' (paused)' : ''}</dt><dd>{v.folders} · {v.parser}</dd>{:else}<dd class="muted">No custom views.</dd>{/each}</dl></div>
  </div>
</section>

<section>
  <h2>Activity <small>{data.log.length}</small></h2>
  {#if !data.log.length}<p class="muted">No rule actions yet.</p>{:else}
  <table><tbody>{#each data.log as l, i (i)}<tr><td>{when(l.at)}</td><td>{l.how}</td><td>{l.rule}</td><td>{l.count}</td><td class="err">{l.error || ''}</td></tr>{/each}</tbody></table>{/if}
</section>
</main>
<style>
  main{color:#29344c;font-size:12px}h1{margin:0 0 8px;font-size:20px}h2{font-size:14px;margin:16px 0 6px;display:flex;gap:6px;align-items:baseline}h2 small,h3 small{color:#8a95a8;font-weight:500}h3{font-size:12px;margin:0 0 4px}
  .alert{padding:8px 10px;background:#fff0f1;color:#a5414d;border-radius:8px;margin-bottom:8px}.ok{padding:8px 10px;background:#eef8f1;color:#256b3f;border-radius:8px;margin-bottom:8px}
  .how{color:#5b6a86}.how summary{cursor:pointer;font-weight:700}.how p{margin:4px 0 0;max-width:820px}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button:hover{border-color:#8da2f0;color:#3157de}
  .link{border:0;background:none;padding:0;color:#3157de;font-weight:700;text-decoration:none;cursor:pointer}.danger{color:#a5414d}.muted{color:#8a95a8;margin:2px 0}.err{color:#a5414d}
  select,input{border:1px solid #dbe1eb;border-radius:7px;padding:4px 6px;font:inherit;font-size:12px}
  .table{display:grid;gap:4px}.srow{display:grid;grid-template-columns:minmax(200px,1fr) auto auto auto auto auto;gap:6px;align-items:center;border:1px solid #e7ebf2;border-radius:8px;padding:6px 8px;background:#fff}
  .who{display:flex;flex-direction:column;min-width:0}.who b,.who small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.who small{color:#8a95a8}
  .add{margin:4px 0 6px}.add summary{cursor:pointer;font-weight:700;color:#43516c}.addrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px}.chk{display:inline-flex;gap:4px;align-items:center}
  .rule{border:1px solid #e7ebf2;border-radius:8px;padding:6px 8px;background:#fff;margin-bottom:4px}.rule.off{opacity:.6}
  .rhead{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.rhead form{margin:0}.sp{flex:1}.chip{background:#f1f3f8;border-radius:6px;padding:1px 7px;font-size:11px;color:#53607a}.chip.auto{background:#e9f7ef;color:#1e7a47}
  .rbody{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:4px}.pend{display:flex;gap:6px;align-items:center;margin:0}.sample summary{cursor:pointer;color:#5b6a86}.sample ul{margin:4px 0 0;padding-left:16px}.sample small{color:#8a95a8}
  .native{border:1px solid #e7ebf2;border-radius:8px;padding:6px 8px;background:#fff;margin-bottom:4px}.native ul{list-style:none;margin:0;padding:0;display:grid;gap:2px}.native li{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.native li span{flex:1;min-width:0;overflow-wrap:anywhere}.native li form button{white-space:nowrap}.newrule{margin:2px 0 6px}.native li form{margin:0}
  .builtin{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:8px}.builtin>div{border:1px solid #e7ebf2;border-radius:8px;padding:6px 8px;background:#fff}
  dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0}dt{font-weight:700;color:#43516c}dd{margin:0;color:#5b6a86}
  table{border-collapse:collapse;width:100%}td{border-top:1px solid #eef0f5;padding:3px 6px;vertical-align:top}td:first-child{white-space:nowrap;color:#8a95a8}
  @media(max-width:800px){.srow{grid-template-columns:1fr 1fr}.who{grid-column:1/-1}}
</style>
