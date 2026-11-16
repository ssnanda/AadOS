<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import ItemList from '$lib/components/ItemList.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>
<svelte:head><title>{data.q ? `${data.q} · ` : ''}Search · AadOS</title></svelte:head>
<AppShell title="Search">
  <main>
    <header><h1>{data.q ? `“${data.q}”` : 'Search'}</h1><p>{data.q ? `${data.matched} of ${data.total} emails across all views` : `Type in the box above to search all ${data.total} emails: subject, sender, store, code, anything.`}</p></header>
    {#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}
    {#if form && 'removed' in form}<div class="ok">Deleted {form.removed} emails from AadOS.</div>{/if}
    {#if data.q && data.items.length === 0}<div class="empty">No emails match.</div>{/if}
    <ItemList items={data.items} matched={data.matched} filters={{ q: data.q }} names={data.names} />
  </main>
</AppShell>
<style>
  main{max-width:1000px;margin:auto}h1{margin:0 0 4px;font-size:22px}header{margin-bottom:16px}header p{margin:0;color:#8994a8;font-size:13px}
  .alert,.ok{padding:10px 14px;border-radius:9px;margin-bottom:12px;font-size:13px}.alert{background:#fff0f1;color:#a5414d}.ok{background:#e3f6f3;color:#0f7f74}
  .empty{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:35px;text-align:center;color:#8c96a8}
</style>
