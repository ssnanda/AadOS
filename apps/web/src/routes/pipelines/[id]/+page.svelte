<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte'; import { startAutoSync } from '$lib/sync'; import { invalidateAll } from '$app/navigation'; import { onMount } from 'svelte'; import ItemList from '$lib/components/ItemList.svelte'; import { kindMeta } from '$lib/kinds'; import DigestPanel from '$lib/components/DigestPanel.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  // Auto sync of this view's folders (newest mail): on open, every 2 minutes while visible.
  onMount(() => { const auto = startAutoSync(() => ({ pipeline: data.pipeline.id }), () => invalidateAll()); void auto.run(); return () => auto.stop(); });

  const meta = kindMeta;
  // Tiles are exclusive: a saved-value tile (Coupons, Gift Cards) clears the kind, and a kind clears it.
  const href = (kind: string, store: string, withQuery = true, all = false, pages = 1, saved = '') => {
    const q = new URLSearchParams();
    if (all) q.set('show', 'all');
    if (pages > 1) q.set('pages', String(pages));
    if (saved) q.set('saved', saved); else if (kind) q.set('kind', kind);
    if (store) q.set('store', store);
    if (withQuery && data.q) q.set('q', data.q);
    return `?${q}`;
  };
  const shop = $derived(data.pipeline.parser === 'shop');
</script>
<svelte:head><title>{data.pipeline.name} · AadOS</title></svelte:head>
<AppShell title={data.pipeline.name}>
<main class="shell">
  {#if !data.review}<header>
    <div><small>{data.pipeline.folderName}</small><h1>{data.pipeline.name}</h1><p>{data.pipeline.parser === 'digest' ? 'Weekly review' : `${data.pipeline.parser} parser`} · Last sync {data.pipeline.lastSync ? new Date(data.pipeline.lastSync).toLocaleString() : 'never'}</p></div>
<form method="POST" action="?/reparse"><button title="Re-run the parser on stored emails">↻ Re-parse</button></form>
  </header>{/if}
  {#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}
  {#if form && 'reparsed' in form}<div class="ok">Re-parsed {data.total} emails · {form.reparsed} changed category.</div>{/if}

  {#if data.review}<DigestPanel review={data.review} />{/if}
  {#if form && 'removed' in form}<div class="ok">Deleted {form.removed} emails from AadOS.</div>{/if}
  {#snippet sourceEmails()}
  <form class="find" method="GET"><span>⌕</span><input type="search" name="q" value={data.q} placeholder="Search this view…" aria-label="Search this view">{#if data.kind}<input type="hidden" name="kind" value={data.kind}>{/if}{#if data.saved}<input type="hidden" name="saved" value={data.saved}>{/if}{#if data.store}<input type="hidden" name="store" value={data.store}>{/if}{#if data.q}<a href={href(data.kind, data.store, false, false, 1, data.saved)}>Clear</a>{/if}</form>
  <div class="tiles">
    {#if data.savedTiles}
      <a class="tile amber" class:on={data.saved === 'coupon'} href={data.saved === 'coupon' ? href('', data.store) : href('', data.store, true, false, 1, 'coupon')} title={data.savedTiles.nextExpiry ? `Next expires ${data.savedTiles.nextExpiry}` : 'No saved coupons'}><span class="ico">🎟</span><b>{data.savedTiles.coupon}</b><small>Coupons</small></a>
      <a class="tile amber" class:on={data.saved === 'gift-card'} href={data.saved === 'gift-card' ? href('', data.store) : href('', data.store, true, false, 1, 'gift-card')} title="Gift cards do not expire"><span class="ico">🎁</span><b>{data.savedTiles.giftCard}</b><small>Gift Cards</small></a>
    {/if}
    {#if !shop}<a class="tile all" class:on={data.showAll && !data.kind && !data.store} href={href('', '', true, true)} title="List every email in this view (50 at a time)"><span class="ico">▦</span><b>{data.searched}</b><small>Show all</small></a>{/if}
    {#each data.kinds as [kind, n] (kind)}{@const m = meta(kind)}<a class="tile {m.tone}" class:on={data.kind === kind && !data.saved} href={shop && data.kind === kind ? href('', data.store) : href(kind, data.store)}><span class="ico">{m.icon}</span><b>{n}</b><small>{m.label}</small></a>{/each}
  </div>
  {#if data.stores.length}
    <div class="stores"><span class="lbl">Stores</span>{#each data.stores as [name, n] (name)}<a class="chip" class:on={data.store === name} href={href(data.kind, data.store === name ? '' : name, true, false, 1, data.saved)}>{name}<i>{n}</i></a>{/each}</div>
  {/if}

  {#if data.listing}
  <section>{#if data.items.length === 0}<div class="empty">{data.total ? 'No emails match this filter.' : 'No messages synced from this folder yet.'}</div>{/if}
    <ItemList items={data.items} matched={data.matched} filters={{ kind: data.saved ? '' : data.kind, store: data.store, q: data.q, saved: data.saved }} aiAvailable={data.aiAvailable} aiBlocked={data.aiBlocked} />
    {#if data.matched > data.items.length}<a class="more" href={href(data.kind, data.store, true, data.showAll, data.pages + 1, data.saved)} data-sveltekit-noscroll>Show {Math.min(data.pageSize, data.matched - data.items.length)} more · {data.items.length} of {data.matched}</a>{/if}</section>
  {:else if !data.total}<div class="empty">No messages synced from this folder yet.</div>{/if}
  {/snippet}
  {#if data.review}<details class="evidence"><summary>Source emails <i>{data.total}</i></summary><div class="evidence-body">{@render sourceEmails()}</div></details>{:else}{@render sourceEmails()}{/if}
</main>
</AppShell>
<style>
  .shell{max-width:none}
  .more{display:block;margin-top:10px;text-align:center;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:9px;font-size:12px;font-weight:700;color:#3157de;text-decoration:none}.more:hover{border-color:#8da2f0}
  header{display:flex;gap:25px;align-items:flex-start;margin-bottom:16px}header>div{flex:1}h1{margin:3px 0}header p,header small{color:#8994a8;margin:0}
  header button{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:8px 13px;color:#43516c;font-weight:700;cursor:pointer}header form{margin:0}
  .alert,.ok{padding:10px 14px;border-radius:9px;margin-bottom:12px;font-size:13px}.alert{background:#fff0f1;color:#a5414d}.ok{background:#e3f6f3;color:#0f7f74}
  .evidence{margin-top:12px}.evidence>summary{cursor:pointer;display:inline-flex;align-items:center;gap:7px;color:#53607a;font-size:13px;font-weight:750}.evidence>summary i{font-style:normal;background:#e8edf6;border-radius:99px;padding:1px 8px;font-size:11px}.evidence-body{padding-top:12px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:12px}
  .tile{--c:#3157de;--bg:#edf1ff;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:10px;align-items:center;background:#fff;border:1px solid #e4e9f2;border-top:3px solid var(--c);border-radius:12px;padding:12px;text-decoration:none;color:#29344c}
  .tile .ico{grid-row:span 2;width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:var(--bg);font-size:18px}
  .tile b{font-size:22px;color:var(--c);line-height:1}.tile small{color:#7c879b;font-size:11px;font-weight:700}
  .tile:hover{background:var(--bg)}.tile.on{background:var(--bg);box-shadow:0 0 0 2px var(--c)}
  .pink{--c:#d6477f;--bg:#ffedf4}.blue{--c:#2f6fe4;--bg:#e8f1ff}.amber{--c:#c98a1d;--bg:#fff4df}.violet{--c:#7c4dde;--bg:#f1ebff}.teal{--c:#139488;--bg:#e3f6f3}.gray{--c:#6f7c94;--bg:#f0f2f7}.all{--c:#3e4860;--bg:#eef0f6}
  .stores{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:16px}.lbl{font-size:10px;font-weight:800;letter-spacing:1.2px;color:#a3adbf;text-transform:uppercase;margin-right:4px}
  .chip{display:inline-flex;gap:7px;align-items:center;background:#fff;border:1px solid #e4e9f2;border-radius:99px;padding:5px 11px;font-size:12px;font-weight:700;color:#43516c;text-decoration:none}.chip i{font-style:normal;background:#f0f2f7;border-radius:99px;padding:1px 7px;font-size:10px;color:#8a95a8}
  .chip:hover{border-color:#b9c6f5}.chip.on{background:#3157de;border-color:#3157de;color:#fff}.chip.on i{background:#ffffff33;color:#fff}
  .find{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:0 12px;margin-bottom:12px}.find:focus-within{border-color:#8da2f0}.find span{color:#8a95a8;font-size:18px}.find input{border:0;outline:0;flex:1;padding:10px 0;font-size:13px;font-family:inherit;color:#29344c;background:transparent}.find a{color:#3157de;font-size:12px;text-decoration:none;font-weight:700}
  .note{font-size:12px;color:#8a95a8;margin:0 0 10px}.empty{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:35px;text-align:center;color:#8c96a8}
  @media(max-width:700px){header{display:block}header form{margin-top:10px}}
</style>
