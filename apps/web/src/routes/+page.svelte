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
  <div class="summary"><span><b>{data.tiles.length}</b> views</span><span><b>{data.total}</b> emails synced</span><span><b>{data.accounts}</b> accounts</span></div>
  <div class="tiles">
    {#each data.tiles as t (t.id)}
      <a class="tile {tone(t.parser)}" href={`/pipelines/${t.id}`}>
        <div class="top"><span class="icon">{icon(t.parser)}</span><div><h2>{t.name}</h2><small>{t.account || t.source}</small></div><span class="count">{t.count}</span></div>
        {#if t.kinds.length}<div class="kinds">{#each t.kinds as [kind, n]}<span>{kind} {n}</span>{/each}</div>{/if}
        <ul>{#each t.latest as m (m.id)}<li>{m.subject || '(no subject)'}</li>{/each}{#if !t.latest.length}<li class="muted">Nothing synced yet</li>{/if}</ul>
        <div class="foot"><span>Synced {when(t.lastSync)}</span>{#if !t.enabled}<em>paused</em>{/if}{#if t.lastError}<em class="err">{t.lastError}</em>{/if}</div>
      </a>
    {/each}
    <a class="tile add" href="/settings/emails#views"><span>＋</span>{data.tiles.length ? 'Add view' : 'Create your first view'}</a>
  </div>
</AppShell>
<style>
  .tile{--c:#2f6fe4;--bg:#e8f1ff}.tile.tile{border-top:4px solid var(--c)}.pink{--c:#d6477f;--bg:#ffedf4}.teal{--c:#139488;--bg:#e3f6f3}
  .icon{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:var(--bg)}
  .count{color:var(--c)!important}.kinds span{background:var(--bg)!important;color:var(--c)!important}
  .summary span:nth-child(1) b{color:#7c4dde}.summary span:nth-child(2) b{color:#139488}.summary span:nth-child(3) b{color:#d6477f}
  .summary{display:flex;gap:22px;color:#8a95a8;font-size:13px;margin-bottom:20px}.summary b{color:#29344c;font-size:20px;margin-right:4px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}
  .tile{display:flex;flex-direction:column;gap:12px;background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:18px;color:#29344c;text-decoration:none;box-shadow:0 3px 20px #33447d06}
  .tile:hover{border-color:#b9c6f5}
  .top{display:flex;align-items:center;gap:12px}.top div{flex:1;min-width:0}.icon{font-size:24px}
  h2{margin:0;font-size:16px}small{color:#8a95a8;font-size:11px}
  .count{font-size:30px;font-weight:800;color:#3157de}
  .kinds{display:flex;gap:6px;flex-wrap:wrap}.kinds span{background:#eef1ff;color:#3157de;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;text-transform:capitalize}
  ul{margin:0;padding:0;list-style:none;display:grid;gap:5px;font-size:12px;color:#53607a}li{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.muted{color:#a2abbb}
  .foot{margin-top:auto;display:flex;gap:8px;align-items:center;font-size:11px;color:#9aa4b6}.foot em{font-style:normal;background:#fff4df;color:#a1752a;border-radius:6px;padding:2px 7px}.foot .err{background:#fff0f1;color:#a5414d}
  .add{align-items:center;justify-content:center;border-style:dashed;color:#3157de;font-weight:700;min-height:150px;box-shadow:none}.add span{font-size:28px}
</style>
