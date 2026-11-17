<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import AppShell from '$lib/components/AppShell.svelte';
  import EmailViewer from '$lib/components/EmailViewer.svelte';
  import { startFullSync } from '$lib/sync';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let viewing = $state<PageData['rows'][number] | null>(null);
  let showFilters = $state(false);
  let selected = $state<string[]>([]);
  let acting = $state(false);

  const TABS = [['unread', 'Unread'], ['important', 'Important'], ['needs-reply', 'Needs Reply'], ['recent', 'Recent'], ['inbox', 'Combined inbox'], ['all', 'All mail'], ['read', 'Read']] as const;
  const tabCount = (v: string) => ({ inbox: data.counts.inbox, all: data.counts.all, unread: data.counts.unread, important: data.counts.important, 'needs-reply': data.counts.needsReply, recent: data.counts.recent, read: data.counts.read } as Record<string, number>)[v];
  // Keeps every active filter when switching view/page, so "back" always lands on the same list.
  const href = (over: Record<string, string | number>) => {
    const q = new URLSearchParams();
    const merged: Record<string, string | number | undefined> = { ...data.query, page: 1, ...over };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === 'view' && v === 'unread') && !(k === 'page' && v === 1) && k !== 'pageSize') q.set(k, String(v));
    const s = q.toString();
    return s ? `?${s}` : '?';
  };
  const viewHref = (view: string) => href(view === 'all' ? { view } : { view, sender: '', from: '', to: '', read: '', category: '', thread: '' });
  const unreadHref = (over: Record<string, string>) => href({ view: 'unread', sender: '', from: '', to: '', read: '', category: '', thread: '', ...over });
  const hasFilters = $derived(Boolean(data.query.account || data.query.provider || data.query.sender || data.query.from || data.query.to || data.query.read || data.query.category || data.query.pipeline || data.query.thread || data.query.q));
  const ago = (iso: string) => { const d = new Date(iso); return Date.now() - d.getTime() < 86_400_000 ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
  const name = (s: string) => s.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim() || s;
  const bad = $derived(data.accounts.filter((a) => a.lastError));
  const allShown = $derived(data.rows.length > 0 && selected.length === data.rows.length);
  const viewingIndex = $derived(viewing ? data.rows.findIndex((r) => r.key === viewing?.key) : -1);
  const toggle = (key: string, checked: boolean) => selected = checked ? [...new Set([...selected, key])] : selected.filter((x) => x !== key);
  const toggleAll = (checked: boolean) => selected = checked ? data.rows.map((r) => r.key) : [];
  $effect(() => { const visibleKeys = data.rows.map((row) => row.key); selected = visibleKeys.filter(() => false); });
  async function act(op: string, keys = selected) {
    if (!keys.length || acting) return false;
    if (op === 'delete' && !confirm(`Delete ${keys.length} email${keys.length === 1 ? '' : 's'} from AadOS?\n\nGmail and Zoho are not changed. Deleted emails will not sync back into AadOS.`)) return false;
    acting = true;
    const body = new FormData(); for (const key of keys) body.append('keys', key); body.set('op', op);
    const res = await fetch('?/mark', { method: 'POST', body });
    acting = false;
    if (!res.ok) return false;
    selected = selected.filter((key) => !keys.includes(key));
    await invalidateAll();
    return true;
  }
  function move(offset: number) { const row = data.rows[viewingIndex + offset]; if (row) viewing = row; }
  async function deleteViewing() {
    if (!viewing) return;
    const current = viewing;
    const replacement = data.rows[viewingIndex + 1] ?? data.rows[viewingIndex - 1] ?? null;
    if (await act('delete', [current.key])) viewing = replacement;
  }
</script>
<svelte:head><title>Emails · AadOS</title></svelte:head>
<AppShell title="Emails">
<main>
  <header>
    <div><h1>Emails</h1><p>{data.accounts.length} account{data.accounts.length === 1 ? '' : 's'} · {data.counts.unread} unread · {data.counts.needsReply} need a reply</p></div>
    {#if data.inboxIds.length}<button type="button" class="btn" onclick={() => startFullSync(data.inboxIds)} title="Fetch every email in all inboxes, in the background">⇩ Sync all inboxes</button>{/if}
  </header>
  {#if data.accounts.length === 0}<div class="empty">No accounts connected. <a href="/settings/emails">Connect Gmail or Zoho in Settings → Emails</a>.</div>{:else}
  {#each bad as a (a.id)}<div class="alert">{a.provider === 'gmail' ? 'Gmail' : 'Zoho'} · {a.email}: {a.lastError} · <a href={`/settings/emails#acct-${a.id}`}>Fix in Settings</a></div>{/each}
  {#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}

  <form class="find" method="GET"><span>⌕</span><input type="search" name="q" value={data.query.q} placeholder="Search all accounts…" aria-label="Search all accounts">
    {#each Object.entries({ view: data.query.view === 'unread' ? '' : data.query.view, account: data.query.account, category: data.query.category, read: data.query.read, sender: data.query.sender, from: data.query.from, to: data.query.to, pipeline: data.query.pipeline, thread: data.query.thread }) as [k, v] (k)}{#if v}<input type="hidden" name={k} value={v}>{/if}{/each}
    {#if data.query.view === 'all'}<button type="button" class="link" onclick={() => showFilters = !showFilters}>Filters{hasFilters ? ' •' : ''}</button>{/if}</form>
  {#if data.query.view === 'all' && showFilters}
  <form class="filters" method="GET">
    {#if data.query.view !== 'unread'}<input type="hidden" name="view" value={data.query.view}>{/if}{#if data.query.q}<input type="hidden" name="q" value={data.query.q}>{/if}
    <label>Account<select name="account"><option value="">All</option>{#each data.accounts as a (a.id)}<option value={a.id} selected={data.query.account === a.id}>{a.provider === 'gmail' ? 'Gmail' : 'Zoho'} · {a.email}</option>{/each}</select></label>
    <label>Category<select name="category"><option value="">All</option>{#each data.categories as c (c)}<option selected={data.query.category === c}>{c}</option>{/each}</select></label>
    <label>Status<select name="read"><option value="">Any</option><option value="unread" selected={data.query.read === 'unread'}>Unread</option><option value="read" selected={data.query.read === 'read'}>Read</option></select></label>
    <label>View<select name="pipeline"><option value="">Any</option>{#each data.views as v (v.id)}<option value={v.id} selected={data.query.pipeline === v.id}>{v.name}</option>{/each}</select></label>
    <label>Sender<input name="sender" value={data.query.sender} placeholder="name or address"></label>
    <label>From<input type="date" name="from" value={data.query.from}></label><label>To<input type="date" name="to" value={data.query.to}></label>
    <div class="go"><button class="btn">Apply</button>{#if hasFilters}<a class="link" href={href({ account: '', provider: '', sender: '', from: '', to: '', read: '', category: '', pipeline: '', thread: '', q: '' })}>Clear</a>{/if}</div>
  </form>{/if}

  <section class="scope">
    <div class="scope-head"><h2>Accounts</h2>{#if data.query.account}<a class="clear" href={href({ account: '' })}>Show all accounts</a>{/if}</div>
    <nav class="accounts" aria-label="Email accounts">{#each data.accounts as a (a.id)}<a class:on={data.query.account === a.id} href={unreadHref({ account: a.id, pipeline: '' })}><span class="provider {a.provider}">{a.provider === 'gmail' ? 'G' : 'Z'}</span><span><strong>{a.email}</strong><small>{a.unread} unread · {a.total} total</small></span></a>{/each}</nav>
    <div class="scope-head views-head"><h2>Saved views</h2><a class="clear" href="/settings/emails#views">Manage views</a></div>
    {#if data.views.length}<nav class="saved" aria-label="Saved email views">{#each data.views as v (v.id)}<a class:on={data.query.pipeline === v.id} href={unreadHref({ pipeline: v.id, account: '' })}><span>{v.parser === 'shop' ? '🛍' : v.parser === 'health' ? '♡' : '✉'}</span><strong>{v.name}</strong><i>{v.unread}</i></a>{/each}</nav>{:else}<p class="no-views">No saved views. <a href="/settings/emails#views">Add one</a></p>{/if}
  </section>

  <nav class="tabs" aria-label="Message status">{#each TABS as [v, label] (v)}<a class:on={data.query.view === v} class:secondary={v === 'inbox' || v === 'all' || v === 'read'} href={viewHref(v)}>{label}<i>{tabCount(v)}</i></a>{/each}</nav>
  {#if data.query.view === 'all'}<details class="categories" open={Boolean(data.query.category)}><summary>Categories{data.query.category ? ` · ${data.query.category}` : ''}</summary><div class="chips">{#each data.categories.filter((c) => data.counts.categories[c]) as c (c)}<a class="chip" class:on={data.query.category === c} href={href({ category: data.query.category === c ? '' : c })}>{c}<i>{data.counts.categories[c]}</i></a>{/each}</div></details>{/if}

  <section>
  {#if data.rows.length}<div class="bulk"><label><input type="checkbox" checked={allShown} onchange={(e) => toggleAll(e.currentTarget.checked)}> Select all shown</label>{#if selected.length}<strong>{selected.length} selected</strong><div class="bulk-actions"><button disabled={acting} onclick={() => act('mark-read')}>Mark read</button><button disabled={acting} onclick={() => act('mark-unread')}>Mark unread</button><button disabled={acting} onclick={() => act('importance-high')}>★ Important</button><button disabled={acting} onclick={() => act('follow-up')}>＋ Follow-up</button><button disabled={acting} onclick={() => act('reviewed')}>✓ Reviewed</button><button class="danger" disabled={acting} onclick={() => act('delete')}>Delete</button></div>{/if}</div>{/if}
  {#if data.rows.length === 0}<div class="empty">{data.counts.all === 0 ? 'No messages synced yet. Use “Sync all inboxes”.' : 'No messages match.'}</div>{/if}
  <ul class="list">{#each data.rows as r (r.key)}
    <li class:unread={r.unread} class:selected={selected.includes(r.key)}>
      <div class="email-line"><input class="pick" type="checkbox" checked={selected.includes(r.key)} aria-label={`Select ${r.subject || 'email'}`} onchange={(e) => toggle(r.key, e.currentTarget.checked)}>
      <button type="button" class="row" onclick={() => viewing = r}>
        <span class="from">{#if r.importance === 'high'}<b class="star" title="Important">★</b>{/if}{name(r.sender)}</span>
        <span class="subj"><strong>{r.subject || '(no subject)'}</strong><em>{r.summary}</em></span>
        <time>{ago(r.receivedAt)}</time>
      </button></div>
      <div class="meta">
        {#if data.insights[r.key]}{@const ai = data.insights[r.key]}<span class="aitag" title={`AI suggestion (${ai.confidence >= 0.8 ? 'high' : ai.confidence >= 0.5 ? 'medium' : 'low'} confidence): ${ai.summary}`}>✦ {ai.category}{ai.paymentDue ? ` · due ${ai.paymentDue}` : ''}</span>{/if}<span class="acct {r.provider}" title={r.accountEmail}>{r.provider === 'gmail' ? 'Gmail' : 'Zoho'} · {r.accountEmail}</span>
        {#each r.categories.filter((c) => c !== 'Other' || r.categories.length === 1) as c (c)}<a class="tag" href={href({ view: 'all', category: c })}>{c}</a>{/each}
        {#if r.threadCount > 1}<a class="tag thread" href={href({ thread: r.threadId, view: 'all' })} title="Show conversation">💬 {r.threadCount}</a>{/if}
        {#each r.pipelines as p (p)}<span class="tag view">{p}</span>{/each}
        {#if r.action && !r.reviewed}<span class="tag act" title={r.actionReason}>{r.action === 'reply' ? 'Needs reply' : r.action === 'financial' ? 'Payment' : r.action === 'appointment' ? 'Appointment' : 'To-do'}{r.due ? ` · ${r.due}` : ''}</span>{/if}
        {#if r.followUp}<span class="tag follow">Follow-up</span>{/if}
        <form method="POST" action="?/mark" use:enhance class="ops"><input type="hidden" name="key" value={r.key}>
          {#if r.action === 'reply' && !r.reviewed}<button name="op" value="reviewed" title="Mark reviewed">✓ Reviewed</button><button name="op" value="dismissed" title="Not actionable">✕ Not needed</button>{:else if !r.action}<button name="op" value="actionable" title="Mark as needing action">⚑ Needs action</button>{:else}<button name="op" value="clear-action">↺ Reset</button>{/if}
          {#if r.followUp}<button name="op" value="clear-follow-up">Remove follow-up</button>{:else}<button name="op" value="follow-up">＋ Follow-up</button>{/if}
          <button name="op" value={r.importance === 'high' ? 'importance-normal' : 'importance-high'}>{r.importance === 'high' ? '☆ Not important' : '★ Important'}</button>
        </form>
      </div>
    </li>{/each}</ul></section>
  {#if data.pages > 1}<div class="pager">{#if data.page > 1}<a href={href({ page: data.page - 1 })}>← Newer</a>{/if}<span>Page {data.page} of {data.pages} · {data.total} messages</span>{#if data.page < data.pages}<a href={href({ page: data.page + 1 })}>Older →</a>{/if}</div>{/if}
  {/if}
</main>
{#if viewing}<EmailViewer item={viewing} ai={data.aiAvailable} onclose={() => viewing = null} onprevious={() => move(-1)} onnext={() => move(1)} ondelete={deleteViewing} canPrevious={viewingIndex > 0} canNext={viewingIndex >= 0 && viewingIndex < data.rows.length - 1} />{/if}
</AppShell>
<style>
  main{max-width:1100px}header{display:flex;gap:16px;align-items:flex-start;margin-bottom:14px}header>div{flex:1}h1{margin:0 0 3px;font-size:22px}header p{margin:0;color:#8a95a8;font-size:12px}
  .btn{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:8px 13px;color:#43516c;font-weight:700;cursor:pointer;font-size:13px}.btn:hover{border-color:#8da2f0}
  .alert{padding:9px 14px;border-radius:9px;margin-bottom:10px;font-size:13px;background:#fff0f1;color:#a5414d}.alert a{color:#a5414d;font-weight:700}
  .find{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:0 12px;margin-bottom:10px}.find:focus-within{border-color:#8da2f0}.find span{color:#8a95a8;font-size:18px}.find input[type=search]{border:0;outline:0;flex:1;padding:10px 0;font-size:14px;background:transparent}
  .link{border:0;background:none;color:#3157de;font-weight:700;cursor:pointer;padding:0;font-size:12px;text-decoration:none}
  .filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:12px;margin-bottom:10px}
  .filters label{display:grid;gap:4px;font-size:11px;font-weight:700;color:#53607a}.filters select,.filters input{border:1px solid #dbe1eb;border-radius:8px;padding:7px;font-size:12px;min-width:0}.go{display:flex;gap:12px;align-items:end}
  .scope{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:13px;margin-bottom:12px}.scope-head{display:flex;align-items:center;gap:12px;margin-bottom:8px}.scope-head h2{margin:0;font-size:12px;color:#53607a;text-transform:uppercase;letter-spacing:.7px}.scope-head .clear{margin-left:auto;color:#3157de;font-size:11px;font-weight:700;text-decoration:none}.views-head{margin-top:13px;border-top:1px solid #eef0f5;padding-top:12px}
  .accounts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:7px}.accounts a{display:flex;align-items:center;gap:9px;border:1px solid #e4e9f2;border-radius:9px;padding:8px 10px;color:#43516c;text-decoration:none;min-width:0}.accounts a:hover,.accounts a.on{border-color:#8da2f0;background:#f7f9ff}.accounts a>span:last-child{min-width:0}.accounts strong,.accounts small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.accounts strong{font-size:12px}.accounts small{font-size:10px;color:#8a95a8;margin-top:2px}.provider{width:27px;height:27px;display:grid!important;place-items:center;border-radius:8px;flex:none;background:#eef1ff;color:#3157de;font-weight:800}.provider.gmail{background:#fff0ee;color:#d94d43}
  .saved{display:flex;gap:7px;flex-wrap:wrap}.saved a{display:inline-flex;align-items:center;gap:7px;border:1px solid #e4e9f2;border-radius:9px;padding:7px 10px;color:#43516c;text-decoration:none;font-size:12px}.saved a:hover,.saved a.on{border-color:#7c4dde;background:#f5f0ff;color:#6a3fd1}.saved i{font-style:normal;background:#f1ebff;color:#7c4dde;border-radius:99px;padding:1px 6px;font-size:10px}.no-views{margin:0;color:#8a95a8;font-size:12px}.no-views a{color:#3157de;font-weight:700}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.tabs a{display:inline-flex;gap:7px;align-items:center;padding:7px 12px;border-radius:9px;background:#fff;border:1px solid #e4e9f2;font-size:13px;font-weight:700;color:#53607a;text-decoration:none}.tabs a.on{background:#3157de;border-color:#3157de;color:#fff}
  .tabs a.secondary:not(.on){color:#8a95a8;background:transparent}
  .tabs i,.chip i{font-style:normal;font-size:11px;background:#f0f2f7;color:#5b6a86;border-radius:99px;padding:1px 7px}.tabs a.on i,.chip.on i{background:#ffffff33;color:#fff}
  .categories{margin-bottom:14px}.categories summary{cursor:pointer;color:#53607a;font-size:12px;font-weight:700}.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.chip{display:inline-flex;gap:6px;align-items:center;background:#fff;border:1px solid #e4e9f2;border-radius:99px;padding:4px 10px;font-size:12px;font-weight:700;color:#43516c;text-decoration:none}.chip.on{background:#3157de;border-color:#3157de;color:#fff}
  .bulk{display:flex;align-items:center;gap:12px;min-height:34px;margin-bottom:7px;padding:7px 10px;border:1px solid #e4e9f2;border-radius:10px;background:#fff;color:#53607a;font-size:12px}.bulk label{display:flex;align-items:center;gap:7px;font-weight:700}.bulk strong{color:#3157de}.bulk-actions{display:flex;gap:5px;flex-wrap:wrap;margin-left:auto}.bulk button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:5px 9px;color:#43516c;font-size:11px;font-weight:700;cursor:pointer}.bulk button:hover{border-color:#8da2f0;color:#3157de}.bulk button:disabled{opacity:.5}.bulk button.danger{color:#b53c50}
  .list{list-style:none;margin:0;padding:0;background:#fff;border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}
  li{padding:10px 14px;border-top:1px solid #eef0f5}li:first-child{border-top:0}li.unread{background:#fbfcff}li.selected{background:#f3f6ff}.email-line{display:grid;grid-template-columns:20px minmax(0,1fr);gap:9px;align-items:center}.pick{width:15px;height:15px;margin:0;accent-color:#3157de}
  .row{display:grid;grid-template-columns:200px minmax(0,1fr) 70px;gap:14px;align-items:baseline;width:100%;border:0;background:none;text-align:left;padding:0;cursor:pointer;font:inherit;color:#29344c}
  .from{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}li.unread .from,li.unread .subj strong{font-weight:800}.star{color:#e0a21b;margin-right:4px}
  .subj{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.subj strong{font-weight:600}.subj em{font-style:normal;color:#8a95a8;margin-left:8px;font-size:12px}time{font-size:11px;color:#8a95a8;text-align:right}
  .meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0 0 29px}
  .tag,.acct{font-size:10px;font-weight:800;border-radius:6px;padding:2px 7px;background:#f0f2f7;color:#5b6a86;text-decoration:none}.acct{background:#eef1ff;color:#3157de;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.acct.gmail{background:#fff0ee;color:#d94d43}
  .aitag{font-size:10px;font-weight:800;border-radius:6px;padding:2px 7px;background:#f1ebff;color:#7c4dde;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tag.act{background:#fff4df;color:#a1752a}.tag.follow{background:#e3f6f3;color:#0f7f74}.tag.view{background:#f1ebff;color:#7c4dde}
  .ops{display:flex;gap:4px;margin:0 0 0 auto}.ops button{border:1px solid #e4e9f2;background:#fff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;color:#53607a;cursor:pointer}.ops button:hover{border-color:#8da2f0;color:#3157de}
  .pager{display:flex;gap:16px;align-items:center;justify-content:center;margin:16px 0;font-size:12px;color:#8a95a8}.pager a{color:#3157de;font-weight:700;text-decoration:none}
  .empty{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:35px;text-align:center;color:#8c96a8}.empty a{color:#3157de}
  @media(max-width:700px){.bulk{align-items:flex-start;flex-wrap:wrap}.bulk-actions{margin-left:0;width:100%}.row{grid-template-columns:1fr 60px}.subj{grid-column:1/-1;grid-row:2}.ops{margin:6px 0 0;flex-wrap:wrap}}
</style>
