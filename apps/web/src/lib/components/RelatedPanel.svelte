<script lang="ts">
  // "More from sender" column beside the open email: same sender or domain, with read/delete per row and in bulk.
  import { untrack } from 'svelte';
  import { mailAction } from '$lib/mail-action';
  type Row = { key: string; pipelineId: string; messageId: string; subject: string; sender: string; receivedAt: string; unread?: boolean };
  let { item, activeKey = '', onopen, onchanged, onclose }: { item: Row; activeKey?: string; onopen?: (row: Row) => void; onchanged?: () => void; onclose: () => void } = $props();

  let scope = $state<'sender' | 'domain'>('sender');
  let sameSubject = $state(false);
  let unreadOnly = $state(false);
  let data = $state<{ sender: string; domain: string; total: number; rows: Row[] } | null>(null);
  let selected = $state<string[]>([]);
  let error = $state('');
  let loading = $state(false);

  async function load(anchor = item) {
    loading = true; error = '';
    try {
      const res = await fetch('/emails/tools', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'related', key: anchor.key, scope, sameSubject }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      data = body; selected = [];
    } catch (e) { error = e instanceof Error ? e.message : 'Could not load.'; } finally { loading = false; }
  }
  // Reload only when the sender changes, so opening one of these emails keeps the list in place.
  $effect(() => { void item.sender; untrack(() => load()); });

  const shown = $derived((data?.rows ?? []).filter((r) => !unreadOnly || r.unread));
  const unreadCount = $derived((data?.rows ?? []).filter((r) => r.unread).length);
  const allSelected = $derived(shown.length > 0 && shown.every((r) => selected.includes(r.key)));
  const toggle = (key: string, on: boolean) => selected = on ? [...new Set([...selected, key])] : selected.filter((k) => k !== key);
  const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  // Optimistic: the list changes at once; a refusal from Gmail/Zoho reloads it and shows why.
  async function act(op: 'delete' | 'mark-read' | 'mark-unread', keys: string[]) {
    if (!keys.length || !data) return;
    if (op === 'delete' && keys.length > 1 && !confirm(`Move ${keys.length} emails to Trash in Gmail/Zoho?`)) return;
    const set = new Set(keys);
    if (op === 'delete') { data.rows = data.rows.filter((r) => !set.has(r.key)); data.total -= keys.length; }
    else for (const r of data.rows) if (set.has(r.key)) r.unread = op === 'mark-unread';
    selected = selected.filter((k) => !set.has(k));
    const r = await mailAction(op, keys);
    error = r.message;
    if (!r.ok) await load();
    onchanged?.();
  }
</script>

<aside class="related" aria-label="More from sender">
  <header><strong title={data?.sender || item.sender}>More from {scope === 'domain' && data?.domain ? `@${data.domain}` : data?.sender || item.sender}</strong><button class="x" onclick={onclose} title="Close" aria-label="Close">✕</button></header>
  <div class="seg" role="group" aria-label="Match"><button class:on={scope === 'sender'} onclick={() => { scope = 'sender'; load(); }}>This sender</button><button class:on={scope === 'domain'} onclick={() => { scope = 'domain'; load(); }}>This domain</button></div>
  <label class="chk"><input type="checkbox" bind:checked={sameSubject} onchange={() => load()}> Same subject only</label>
  <label class="chk"><input type="checkbox" bind:checked={unreadOnly}> Unread only</label>
  <small class="muted">{loading ? 'Loading…' : `${unreadCount} unread · ${data?.total ?? 0} total`}</small>
  {#if error}<p class="err">{error}</p>{/if}
  {#if shown.length}
    <div class="bulk"><label class="chk"><input type="checkbox" checked={allSelected} onchange={(e) => selected = e.currentTarget.checked ? shown.map((r) => r.key) : []}> Select</label>
      {#if selected.length}<span class="sp"></span><button onclick={() => act('mark-read', selected)}>✉ Read</button><button class="del" onclick={() => act('delete', selected)}>🗑 Delete ({selected.length})</button>{/if}</div>
  {/if}
  <ul>{#each shown as r (r.key)}
    <li class:unread={r.unread} class:active={r.key === activeKey}>
      <input type="checkbox" checked={selected.includes(r.key)} onchange={(e) => toggle(r.key, e.currentTarget.checked)} aria-label={`Select ${r.subject || 'email'}`}>
      <button class="rel" onclick={() => onopen?.(r)}><span>{r.subject || '(no subject)'}</span><time>{when(r.receivedAt)}</time></button>
      <div class="ics"><button class="ic" title={r.unread ? 'Mark read' : 'Mark unread'} aria-label={r.unread ? 'Mark read' : 'Mark unread'} onclick={() => act(r.unread ? 'mark-read' : 'mark-unread', [r.key])}>{r.unread ? '✉' : '📭'}</button><button class="ic" title="Move to Trash" aria-label="Delete" onclick={() => act('delete', [r.key])}>🗑</button></div>
    </li>{:else}{#if data && !loading}<li class="muted">No other messages.</li>{/if}{/each}</ul>
  {#if data && data.total > data.rows.length}<small class="muted">Showing {data.rows.length} of {data.total}</small>{/if}
</aside>

<style>
  .related{width:300px;flex:none;border-left:1px solid #e4e9f2;padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:7px;font-size:12px;background:#fff}
  header{display:flex;gap:8px;align-items:flex-start}header strong{flex:1;min-width:0;font-size:13px;overflow-wrap:anywhere}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button:hover{border-color:#8da2f0;color:#3157de}
  .x{border:0;padding:2px 4px}
  .seg{display:flex}.seg button{flex:1;border-radius:0}.seg button:first-child{border-radius:7px 0 0 7px}.seg button:last-child{border-radius:0 7px 7px 0;border-left:0}.seg .on{background:#3157de;border-color:#3157de;color:#fff}
  .chk{display:flex;gap:6px;align-items:center;color:#53607a}
  .muted{color:#8a95a8}.err{color:#a5414d;margin:0}
  .bulk{display:flex;gap:5px;align-items:center}.sp{flex:1}.del{color:#b53c50}
  ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
  li{display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:6px;align-items:center;background:#f7f8fb;border-radius:8px;padding:6px}li.active{outline:2px solid #8da2f0}
  .rel{border:0;background:none;padding:0;text-align:left;display:grid;gap:2px;font-weight:500;min-width:0}.rel span{overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;color:#29344c}.rel time{color:#8a95a8;font-size:11px}
  li.unread .rel span{font-weight:800}
  .ics{display:flex;flex-direction:column;gap:2px}.ic{border:0;background:none;padding:2px 4px;font-size:18px;line-height:1;opacity:.8}.ic:hover{opacity:1;background:#eef1ff}
</style>
