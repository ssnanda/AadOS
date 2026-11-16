<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const icon = (parser: string) => parser === 'shop' ? '🛍' : parser === 'health' ? '♡' : '✉';
</script>
<svelte:head><title>Emails · AadOS</title></svelte:head>
<AppShell title="Emails">
  {#if data.views.length === 0}<div class="empty">No views yet. <a href="/settings/emails#views">Create a view in Settings → Emails</a>.</div>{/if}
  {#each data.views as v (v.id)}
    <section><header><span class="icon">{icon(v.parser)}</span><div><h2><a href={`/pipelines/${v.id}`}>{v.name}</a></h2><small>{v.account} · {v.count} emails</small></div><a class="all" href={`/pipelines/${v.id}`}>View all →</a></header>
      {#if v.items.length === 0}<p class="muted">Nothing synced yet.</p>{:else}<ul>{#each v.items as m (m.id)}<li><span class="kind">{m.kind}</span><span class="subject">{m.subject || '(no subject)'}</span><small>{m.sender}</small><small class="date">{new Date(m.receivedAt).toLocaleDateString()}</small></li>{/each}</ul>{/if}
    </section>
  {/each}
</AppShell>
<style>
  section{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:18px;margin-bottom:16px}
  header{display:flex;gap:12px;align-items:center;margin-bottom:10px}header div{flex:1}.icon{font-size:22px}
  h2{margin:0;font-size:16px}h2 a{color:#29344c;text-decoration:none}small,.muted{color:#8a95a8;font-size:11px}.all{color:#3157de;text-decoration:none;font-size:12px}
  ul{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:80px minmax(0,2fr) minmax(0,1fr) 80px;gap:10px;align-items:center;padding:8px 0;border-top:1px solid #eef0f5;font-size:12px}
  .kind{font-size:10px;font-weight:800;text-transform:uppercase;color:#536bc0}.subject,small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.date{text-align:right}
  .empty{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:35px;text-align:center;color:#8c96a8}.empty a{color:#3157de}
  @media(max-width:700px){li{grid-template-columns:1fr}.date{text-align:left}}
</style>
