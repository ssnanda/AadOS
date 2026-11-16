<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const icon = (parser: string) => parser === 'shop' ? '🛍' : parser === 'health' ? '♡' : '✉';
  const tone = (parser: string) => parser === 'shop' ? 'pink' : parser === 'health' ? 'teal' : 'blue';
  const when = (value: string) => value ? new Date(value).toLocaleString() : 'never';
</script>
<svelte:head><title>Dashboard · AadOS</title></svelte:head>
<AppShell title="Dashboard">
  <div class="summary"><span><b>{data.tiles.length}</b> views</span><span><b>{data.unread}</b> unread</span><span><b>{data.accounts}</b> accounts</span><a href="/emails?view=needs-reply"><b>{data.inbox.needsReply}</b> need reply</a><a href="/emails?view=important"><b>{data.inbox.important}</b> important</a><a href="/emails?category=Bills"><b>{data.inbox.bills}</b> bills</a><a href="/emails?category=Renewals"><b>{data.inbox.renewals}</b> renewals</a><a href="/emails?category=Receipts"><b>{data.inbox.receipts}</b> receipts</a><a class="addview" href="/settings/emails#views">＋ Add view</a></div>
  {#each data.brief.errors as e (e.id)}<div class="alert">{e.label}: {e.message} · <a href="/settings/emails">Fix in Settings</a></div>{/each}
  {#if data.accounts > 0}<div class="brief">
    {#snippet card(title: string, href: string, n: number, items: { key: string; subject: string; sender: string; due: string }[])}<div class="bc"><a class="bh" href={href}>{title}<b>{n}</b></a>{#if items.length}<ul>{#each items as m (m.key)}<li><span>{m.subject || '(no subject)'}</span>{#if m.due}<time>{m.due}</time>{/if}</li>{/each}</ul>{:else}<p class="muted">Nothing here.</p>{/if}</div>{/snippet}
    {@render card('Needs reply', '/emails?view=needs-reply', data.brief.counts.needsReply, data.brief.needsReply)}
    {@render card('Important unread', '/emails?view=important', data.brief.counts.important, data.brief.important)}
    {@render card('Bills & renewals', '/emails?category=Bills', data.brief.counts.billsRenewals, data.brief.billsRenewals)}
    {@render card('Upcoming deadlines', '/emails?view=all', data.brief.counts.upcoming, data.brief.upcoming)}
    <div class="bc"><a class="bh" href="/tasks?f=today">Tasks<b>{data.brief.tasksToday.length + data.brief.tasksOverdue.length}</b></a>
      {#if data.brief.tasksOverdue.length + data.brief.tasksToday.length}<ul>{#each data.brief.tasksOverdue as t (t.id)}<li class="late"><span>{t.title}</span><time>{t.due}</time></li>{/each}{#each data.brief.tasksToday as t (t.id)}<li><span>{t.title}</span><time>Today</time></li>{/each}</ul>{:else}<p class="muted">Nothing due today.</p>{/if}</div>
  </div>{/if}
  <div class="tiles">
    {#each data.tiles as t (t.id)}
      <a class="tile {tone(t.parser)}" href={`/pipelines/${t.id}`}>
        <div class="top"><span class="icon">{icon(t.parser)}</span><div><h2>{t.name}</h2><small>{t.account || t.source}</small></div><span class="count" title={`${t.count} unread email${t.count === 1 ? '' : 's'}`}>{t.count}</span></div>
        {#if t.kinds.length}<div class="kinds">{#each t.kinds as [kind, n]}<span>{kind} {n}</span>{/each}</div>{/if}
        <ul>{#each t.latest as m (m.id)}<li>{m.subject || '(no subject)'}</li>{/each}{#if !t.latest.length}<li class="muted">Nothing synced yet</li>{/if}</ul>
        <div class="foot"><span>Synced {when(t.lastSync)}</span>{#if !t.enabled}<em>paused</em>{/if}{#if t.lastError}<em class="err">{t.lastError}</em>{/if}</div>
      </a>
    {/each}
  </div>
</AppShell>
<style>
  .alert{padding:9px 14px;border-radius:9px;margin-bottom:12px;font-size:13px;background:#fff0f1;color:#a5414d}.alert a{color:#a5414d;font-weight:700}
  .brief{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-bottom:20px}.bc{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:12px 14px}
  .bh{display:flex;justify-content:space-between;align-items:center;color:#29344c;text-decoration:none;font-weight:800;font-size:13px;margin-bottom:6px}.bh b{color:#3157de;font-size:18px}
  .bc ul{margin:0;padding:0;list-style:none;display:grid;gap:4px;font-size:12px;color:#53607a}.bc li{display:flex;gap:8px;justify-content:space-between}.bc li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bc time{font-size:10px;font-weight:700;color:#8a95a8;flex:none}.bc li.late time{color:#a5414d}.bc .muted{margin:0;font-size:12px}
  .tile{--c:#2f6fe4;--bg:#e8f1ff}.tile.tile{border-top:4px solid var(--c)}.pink{--c:#d6477f;--bg:#ffedf4}.teal{--c:#139488;--bg:#e3f6f3}
  .icon{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:var(--bg)}
  .count{color:var(--c)!important}.kinds span{background:var(--bg)!important;color:var(--c)!important}
  .summary span:nth-child(1) b{color:#7c4dde}.summary span:nth-child(2) b{color:#139488}.summary span:nth-child(3) b{color:#d6477f}
  .summary a:not(.addview){color:inherit;text-decoration:none}.summary a:not(.addview):hover{color:#3157de}.summary{flex-wrap:wrap;display:flex;gap:22px;color:#8a95a8;font-size:13px;margin-bottom:20px}.summary b{color:#29344c;font-size:20px;margin-right:4px}
  .addview{margin-left:auto;align-self:center;background:#eef1ff;color:#3157de;border-radius:8px;padding:5px 11px;font-size:12px;font-weight:700;text-decoration:none}.addview:hover{background:#3157de;color:#fff}
  .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}
  .tile{display:flex;flex-direction:column;gap:12px;background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:18px;color:#29344c;text-decoration:none;box-shadow:0 3px 20px #33447d06}
  .tile:hover{border-color:#b9c6f5}
  .top{display:flex;align-items:center;gap:12px}.top div{flex:1;min-width:0}.icon{font-size:24px}
  h2{margin:0;font-size:16px}small{color:#8a95a8;font-size:11px}
  .count{font-size:30px;font-weight:800;color:#3157de}
  .kinds{display:flex;gap:6px;flex-wrap:wrap}.kinds span{background:#eef1ff;color:#3157de;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;text-transform:capitalize}
  ul{margin:0;padding:0;list-style:none;display:grid;gap:5px;font-size:12px;color:#53607a}li{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.muted{color:#a2abbb}
  .foot{margin-top:auto;display:flex;gap:8px;align-items:center;font-size:11px;color:#9aa4b6}.foot em{font-style:normal;background:#fff4df;color:#a1752a;border-radius:6px;padding:2px 7px}.foot .err{background:#fff0f1;color:#a5414d}
</style>
