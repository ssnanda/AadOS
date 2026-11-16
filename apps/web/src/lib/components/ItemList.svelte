<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { kindMeta } from '$lib/kinds';
  type Item = { id: string; pipelineId: string; messageId: string; unread?: boolean; seen?: boolean; subject: string; sender: string; receivedAt: string; summary: string; kind: string; facts: Record<string, string | number | boolean> };
  // `filters` is what "select all matching" re-applies on the server; `names` labels the view in search results.
  let { items, matched, filters = {}, names }: { items: Item[]; matched: number; filters?: { kind?: string; store?: string; q?: string; unread?: boolean }; names?: Record<string, string> } = $props();
  let selected = $state<string[]>([]);
  let allMatching = $state(false);
  let count = $derived(allMatching ? matched : selected.length);
  let allShown = $derived(items.length > 0 && selected.length === items.length);
  const SHOWN_FACTS = ['discount', 'code', 'expires', 'order', 'tracking', 'amount', 'date', 'provider'];
  const toggle = (id: string, on: boolean) => { allMatching = false; selected = on ? [...selected, id] : selected.filter((x) => x !== id); };
  const toggleShown = (on: boolean) => { allMatching = false; selected = on ? items.map((i) => i.id) : []; };
  // Email viewer: body is fetched on demand (read-only) and rendered in a sandboxed iframe.
  let viewing = $state<Item | null>(null);
  let body = $state<{ html: string; text: string } | null>(null);
  let loadError = $state('');
  let loading = $state(false);
  let images = $state(false);
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  async function view(item: Item) {
    viewing = item; body = null; loadError = ''; images = false; loading = true;
    try {
      const res = await fetch(`/pipelines/${item.pipelineId}/message/${encodeURIComponent(item.messageId)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
      body = await res.json();
      item.seen = true;
    } catch (cause) { loadError = cause instanceof Error ? cause.message : 'Could not load this email.'; }
    loading = false;
  }
  async function close() { viewing = null; await invalidateAll(); }
  // No scripts, no forms; remote images are blocked until asked for (tracking pixels).
  const doc = (b: { html: string; text: string }, allowImages: boolean) =>
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${allowImages ? 'https:' : ''}; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;color:#29344c;word-break:break-word}img{max-width:100%;height:auto}</style>${b.html || `<pre style="white-space:pre-wrap;font:inherit">${esc(b.text)}</pre>`}`;
  function guard({ cancel }: { cancel: () => void }) {
    if (!confirm(`Delete ${count} email${count === 1 ? '' : 's'} from AadOS?\n\nYour mailbox is not changed (access is read-only) and these will not be synced back.`)) cancel();
    return async ({ update }: { update: () => Promise<void> }) => { await update(); selected = []; allMatching = false; };
  }
</script>
{#if items.length > 0}
<form method="POST" action="?/remove" use:enhance={guard}>
  {#if allMatching}<input type="hidden" name="all" value="1"><input type="hidden" name="kind" value={filters.kind ?? ''}><input type="hidden" name="store" value={filters.store ?? ''}><input type="hidden" name="q" value={filters.q ?? ''}>{/if}
  <div class="bulk" class:on={count > 0}>
    <label><input type="checkbox" checked={allShown || allMatching} onchange={(e) => toggleShown(e.currentTarget.checked)}> Select all shown ({items.length})</label>
    {#if allShown && matched > items.length && !allMatching}<button type="button" class="link" onclick={() => allMatching = true}>Select all {matched} matching</button>{/if}
    {#if count > 0}<span class="n">{count} selected</span><button class="del">🗑 Delete {count}</button>{/if}
    {#if matched > items.length}<small>Showing newest {items.length} of {matched}</small>{/if}
  </div>
  <div class="list">{#each items as item (item.id)}{@const m = kindMeta(item.kind)}
    <article class:sel={allMatching || selected.includes(item.id)}>
      <input type="checkbox" name="ids" value={item.id} checked={allMatching || selected.includes(item.id)} onchange={(e) => toggle(item.id, e.currentTarget.checked)} aria-label="Select email">
      <div class="kind {m.tone}"><span>{m.icon}</span>{m.label}</div>
      <div><h2 class:unread={item.unread !== false && !item.seen}>{item.subject || '(no subject)'}</h2><p>{#if names?.[item.pipelineId]}<a class="view" href={`/pipelines/${item.pipelineId}`}>{names[item.pipelineId]}</a> · {/if}{#if item.facts.store}<strong>{item.facts.store}</strong> · {/if}{item.sender} · {new Date(item.receivedAt).toLocaleString()}</p><div class="summary">{item.summary}</div>
        <div class="facts">{#each SHOWN_FACTS as key}{#if item.facts[key]}<span class:code={key === 'code'}><em>{key}</em>{String(item.facts[key])}</span>{/if}{/each}<button type="button" class="open" onclick={() => view(item)}>👁 View email</button></div></div>
    </article>{/each}</div>
</form>
{/if}
{#if viewing}
  <div class="backdrop" role="presentation" onclick={close}></div>
  <aside class="viewer" aria-label="Email">
    <header><div><h3>{viewing.subject || '(no subject)'}</h3><p>{viewing.sender} · {new Date(viewing.receivedAt).toLocaleString()}</p></div>
      {#if body?.html && !images}<button type="button" class="open" onclick={() => images = true}>Load images</button>{/if}<button type="button" class="open" onclick={close}>✕ Close</button></header>
    {#if loading}<div class="msg">Loading…</div>
    {:else if loadError}<div class="msg err">{loadError}</div>
    {:else if body}<iframe title="Email body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc={doc(body, images)}></iframe>{/if}
  </aside>
{/if}
<style>
  h2.unread{font-weight:800}.open{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:3px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}.open:hover{border-color:#8da2f0;color:#3157de}.facts .open{margin-left:auto}
  .backdrop{position:fixed;inset:0;background:#151c2d55;z-index:40}
  .viewer{position:fixed;top:0;right:0;bottom:0;width:min(900px,96vw);background:#fff;z-index:41;display:flex;flex-direction:column;box-shadow:-10px 0 30px #151c2d30}
  .viewer header{display:flex;gap:10px;align-items:flex-start;padding:14px 18px;border-bottom:1px solid #e4e9f2}.viewer header>div{flex:1;min-width:0}.viewer h3{margin:0;font-size:16px}.viewer header p{margin:3px 0 0;font-size:12px;color:#8792a6}
  .viewer iframe{flex:1;border:0;width:100%;background:#fff}.msg{padding:30px;color:#8792a6}.msg.err{color:#a5414d}
  .bulk{display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:8px 14px;margin-bottom:10px;font-size:12px;color:#53607a;position:sticky;top:0;z-index:5}
  .bulk.on{background:#fff4f6;border-color:#f3c9d1}.bulk label{display:flex;gap:7px;align-items:center;font-weight:700;cursor:pointer}.bulk small{margin-left:auto;color:#8a95a8}
  .link{border:0;background:none;color:#3157de;font-weight:700;cursor:pointer;padding:0;font-size:12px}.n{font-weight:700;color:#c24457}
  .del{border:0;background:#d6475c;color:#fff;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer;font-size:12px}.del:hover{background:#b93a4d}
  .list{display:grid;gap:10px}
  article{display:grid;grid-template-columns:22px 130px 1fr;gap:14px;align-items:start;background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:14px 16px}article.sel{border-color:#d6475c;background:#fffafb}
  article>input{margin-top:4px;width:16px;height:16px;cursor:pointer}
  .kind{--c:#6f7c94;--bg:#f0f2f7;align-self:start;display:inline-flex;gap:6px;align-items:center;background:var(--bg);color:var(--c);border-radius:8px;padding:5px 9px;font-size:11px;font-weight:800}
  .pink{--c:#d6477f;--bg:#ffedf4}.blue{--c:#2f6fe4;--bg:#e8f1ff}.amber{--c:#c98a1d;--bg:#fff4df}.violet{--c:#7c4dde;--bg:#f1ebff}.teal{--c:#139488;--bg:#e3f6f3}.gray{--c:#6f7c94;--bg:#f0f2f7}
  h2{font-size:15px;margin:0}article p,.summary{font-size:11px;color:#8792a6;margin:3px 0 0}article p strong{color:#43516c}.view{color:#3157de;text-decoration:none;font-weight:700}.summary{margin-top:6px}
  .facts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.facts span{font-size:11px;font-weight:700;background:#f4f6fa;border-radius:6px;padding:3px 8px;color:#43516c}.facts em{font-style:normal;color:#929caf;font-weight:600;margin-right:5px}
  .facts .code{background:#ffedf4;color:#c0356b;font-family:ui-monospace,monospace}
  @media(max-width:700px){article{grid-template-columns:22px 1fr}.kind{grid-column:2}article>div:last-child{grid-column:2}}
</style>
