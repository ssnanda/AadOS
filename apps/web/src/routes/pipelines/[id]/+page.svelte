<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();

  const KINDS: Record<string, { label: string; icon: string; tone: string }> = {
    coupon: { label: 'Coupons & deals', icon: '🏷', tone: 'pink' },
    order: { label: 'Orders', icon: '🧾', tone: 'blue' },
    shipping: { label: 'Shipping', icon: '📦', tone: 'amber' },
    return: { label: 'Returns', icon: '↩', tone: 'violet' },
    appointment: { label: 'Appointments', icon: '📅', tone: 'teal' },
    claim: { label: 'Claims', icon: '📄', tone: 'blue' },
    prescription: { label: 'Prescriptions', icon: '💊', tone: 'pink' },
    bill: { label: 'Bills', icon: '💲', tone: 'amber' },
    other: { label: 'Other', icon: '✉', tone: 'gray' },
    message: { label: 'Messages', icon: '✉', tone: 'gray' }
  };
  const meta = (kind: string) => KINDS[kind] ?? { label: kind, icon: '✉', tone: 'gray' };
  const href = (kind: string, store: string) => {
    const q = new URLSearchParams();
    if (kind) q.set('kind', kind);
    if (store) q.set('store', store);
    return `?${q}`.replace(/^\?$/, '?');
  };
  const SHOWN_FACTS = ['discount', 'code', 'expires', 'order', 'tracking', 'amount', 'date', 'provider'];
</script>
<svelte:head><title>{data.pipeline.name} · AadOS</title></svelte:head>
<AppShell title={data.pipeline.name}>
<main class="shell">
  <header>
    <div><small>{data.pipeline.folderName}</small><h1>{data.pipeline.name}</h1><p>{data.pipeline.parser} parser · Last sync {data.pipeline.lastSync ? new Date(data.pipeline.lastSync).toLocaleString() : 'never'}</p></div>
    <form method="POST" action="?/reparse"><button title="Re-run the parser on stored emails">↻ Re-parse</button></form>
  </header>
  {#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}
  {#if form && 'reparsed' in form}<div class="ok">Re-parsed {data.total} emails · {form.reparsed} changed category.</div>{/if}

  <div class="tiles">
    <a class="tile all" class:on={!data.kind && !data.store} href="?"><span class="ico">▦</span><b>{data.total}</b><small>All</small></a>
    {#each data.kinds as [kind, n] (kind)}{@const m = meta(kind)}<a class="tile {m.tone}" class:on={data.kind === kind} href={href(kind, data.store)}><span class="ico">{m.icon}</span><b>{n}</b><small>{m.label}</small></a>{/each}
  </div>
  {#if data.stores.length}
    <div class="stores"><span class="lbl">Stores</span>{#each data.stores as [name, n] (name)}<a class="chip" class:on={data.store === name} href={href(data.kind, data.store === name ? '' : name)}>{name}<i>{n}</i></a>{/each}</div>
  {/if}

  <section>{#if data.items.length === 0}<div class="empty">{data.total ? 'No emails match this filter.' : 'No messages synced from this folder yet.'}</div>{:else}
    {#if data.matched > data.items.length}<p class="note">Showing the newest {data.items.length} of {data.matched}.</p>{/if}
    <div class="list">{#each data.items as item (item.id)}{@const m = meta(item.kind)}<article><div class="kind {m.tone}"><span>{m.icon}</span>{m.label}</div><div><h2>{item.subject || '(no subject)'}</h2><p>{#if item.facts.store}<strong>{item.facts.store}</strong> · {/if}{item.sender} · {new Date(item.receivedAt).toLocaleString()}</p><div class="summary">{item.summary}</div>
      <div class="facts">{#each SHOWN_FACTS as key}{#if item.facts[key]}<span class:code={key === 'code'}><em>{key}</em>{String(item.facts[key])}</span>{/if}{/each}</div></div></article>{/each}</div>{/if}</section>
</main>
</AppShell>
<style>
  .shell{max-width:1000px;margin:auto}
  header{display:flex;gap:25px;align-items:flex-start;margin-bottom:16px}header>div{flex:1}h1{margin:3px 0}header p,header small{color:#8994a8;margin:0}
  header button{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:8px 13px;color:#43516c;font-weight:700;cursor:pointer}header form{margin:0}
  .alert,.ok{padding:10px 14px;border-radius:9px;margin-bottom:12px;font-size:13px}.alert{background:#fff0f1;color:#a5414d}.ok{background:#e3f6f3;color:#0f7f74}
  .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:12px}
  .tile{--c:#3157de;--bg:#edf1ff;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:10px;align-items:center;background:#fff;border:1px solid #e4e9f2;border-top:3px solid var(--c);border-radius:12px;padding:12px;text-decoration:none;color:#29344c}
  .tile .ico{grid-row:span 2;width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:var(--bg);font-size:18px}
  .tile b{font-size:22px;color:var(--c);line-height:1}.tile small{color:#7c879b;font-size:11px;font-weight:700}
  .tile:hover{background:var(--bg)}.tile.on{background:var(--bg);box-shadow:0 0 0 2px var(--c)}
  .pink{--c:#d6477f;--bg:#ffedf4}.blue{--c:#2f6fe4;--bg:#e8f1ff}.amber{--c:#c98a1d;--bg:#fff4df}.violet{--c:#7c4dde;--bg:#f1ebff}.teal{--c:#139488;--bg:#e3f6f3}.gray{--c:#6f7c94;--bg:#f0f2f7}.all{--c:#3e4860;--bg:#eef0f6}
  .stores{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:16px}.lbl{font-size:10px;font-weight:800;letter-spacing:1.2px;color:#a3adbf;text-transform:uppercase;margin-right:4px}
  .chip{display:inline-flex;gap:7px;align-items:center;background:#fff;border:1px solid #e4e9f2;border-radius:99px;padding:5px 11px;font-size:12px;font-weight:700;color:#43516c;text-decoration:none}.chip i{font-style:normal;background:#f0f2f7;border-radius:99px;padding:1px 7px;font-size:10px;color:#8a95a8}
  .chip:hover{border-color:#b9c6f5}.chip.on{background:#3157de;border-color:#3157de;color:#fff}.chip.on i{background:#ffffff33;color:#fff}
  .list{display:grid;gap:10px}article{display:grid;grid-template-columns:130px 1fr;gap:15px;background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:14px 16px}
  .kind{--c:#6f7c94;--bg:#f0f2f7;align-self:start;display:inline-flex;gap:6px;align-items:center;background:var(--bg);color:var(--c);border-radius:8px;padding:5px 9px;font-size:11px;font-weight:800}
  h2{font-size:15px;margin:0}article p,.summary{font-size:11px;color:#8792a6;margin:3px 0 0}article p strong{color:#43516c}.summary{margin-top:6px}
  .facts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.facts span{font-size:11px;font-weight:700;background:#f4f6fa;border-radius:6px;padding:3px 8px;color:#43516c}.facts em{font-style:normal;color:#929caf;font-weight:600;margin-right:5px}
  .facts .code{background:#ffedf4;color:#c0356b;font-family:ui-monospace,monospace}
  .note{font-size:12px;color:#8a95a8;margin:0 0 10px}.empty{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:35px;text-align:center;color:#8c96a8}
  @media(max-width:700px){article{grid-template-columns:1fr}header{display:block}header form{margin-top:10px}}
</style>
