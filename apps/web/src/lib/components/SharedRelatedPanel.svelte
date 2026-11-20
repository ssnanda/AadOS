<script lang="ts">
  type Msg = { id: string; subject: string; from: string; to: string; summary: string; at: number; unread: boolean; attachments: boolean };
  let { item, initial = [], accountId, address, onopen, onchanged, onclose }: { item: Msg; initial?: Msg[]; accountId: string; address: string; onopen: (m: Msg) => void; onchanged: (op: 'read' | 'trash', ids: string[], read?: boolean) => void; onclose: () => void } = $props();

  let scope = $state<'sender' | 'domain'>('sender'), sameSubject = $state(false), unreadOnly = $state(false);
  // Show matches from the open mailbox page immediately while older pages fill in behind them.
  let sourceRows = $state<Msg[]>(initial), selected = $state<string[]>([]), loading = $state(false), error = $state(''), scanned = $state(initial.length);
  const senderKey = (from: string) => from.match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/i)?.[0].toLowerCase() || from.trim().toLowerCase();
  const domain = (from: string) => senderKey(from).split('@')[1] || '';
  const subjectKey = (subject: string) => subject.toLowerCase().replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();
  const api = async (op: string, payload: Record<string, unknown> = {}) => {
    const res = await fetch('/emails/shared/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, accountId, address, ...payload }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  };

  async function load() {
    loading = true; error = ''; selected = [];
    try {
      const found: Msg[] = [], seen = new Set<string>(); let start: number | null = 0, pages = 0, checked = 0;
      while (start !== null && pages < 5) {
        const result = await api('list', { unreadOnly: false, start, limit: 200 });
        const batch = result.messages as Msg[]; checked += batch.length;
        for (const m of batch) if (!seen.has(m.id)) { found.push(m); seen.add(m.id); }
        start = result.next; pages += 1;
      }
      sourceRows = found; scanned = checked;
    } catch (e) { error = e instanceof Error ? e.message : 'Could not load.'; }
    finally { loading = false; }
  }
  // Fetch once when the sender changes. Scope, subject and unread controls filter this cache instantly.
  $effect(() => { void item.from; load(); });

  const rows = $derived(sourceRows.filter((m) => {
    const senderMatch = scope === 'sender' ? senderKey(m.from) === senderKey(item.from) : Boolean(domain(item.from)) && domain(m.from) === domain(item.from);
    return senderMatch && (!sameSubject || subjectKey(m.subject) === subjectKey(item.subject));
  }));
  const shown = $derived(rows.filter((r) => !unreadOnly || r.unread));
  const unreadCount = $derived(rows.filter((r) => r.unread).length);
  const allSelected = $derived(shown.length > 0 && shown.every((r) => selected.includes(r.id)));
  const toggle = (id: string, on: boolean) => selected = on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id);
  const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  async function act(op: 'read' | 'trash', ids: string[], read = true) {
    if (!ids.length) return;
    if (op === 'trash' && ids.length > 1 && !confirm(`Move ${ids.length} emails to Trash?`)) return;
    try {
      await Promise.all(ids.map((id) => api(op, op === 'read' ? { id, read } : { id })));
      if (op === 'trash') sourceRows = sourceRows.filter((r) => !ids.includes(r.id));
      else sourceRows = sourceRows.map((r) => ids.includes(r.id) ? { ...r, unread: !read } : r);
      selected = selected.filter((id) => !ids.includes(id)); onchanged(op, ids, read);
    } catch (e) { error = e instanceof Error ? e.message : 'Action failed.'; }
  }
</script>

<aside class="related" aria-label="More from sender">
  <header><strong>More from {scope === 'domain' ? `@${domain(item.from)}` : senderKey(item.from)}</strong><button class="x" onclick={onclose} title="Close" aria-label="Close">✕</button></header>
  <div class="seg"><button class:on={scope === 'sender'} onclick={() => (scope = 'sender')}>This sender</button><button class:on={scope === 'domain'} onclick={() => (scope = 'domain')}>This domain</button></div>
  <label class="chk"><input type="checkbox" bind:checked={sameSubject}> Same subject only</label>
  <label class="chk"><input type="checkbox" bind:checked={unreadOnly}> Unread only</label>
  <small class="muted">{loading ? 'Loading…' : `${unreadCount} unread · ${rows.length} found in ${scanned} emails`}</small>
  {#if error}<p class="err">{error}</p>{/if}
  {#if shown.length}<div class="bulk"><label class="chk"><input type="checkbox" checked={allSelected} onchange={(e) => selected = e.currentTarget.checked ? shown.map((r) => r.id) : []}> Select</label>{#if selected.length}<span></span><button onclick={() => act('read', selected, true)}>✉ Read</button><button class="del" onclick={() => act('trash', selected)}>🗑 Delete ({selected.length})</button>{/if}</div>{/if}
  <ul>{#each shown as r (r.id)}<li class:unread={r.unread} class:active={r.id === item.id}>
    <input type="checkbox" checked={selected.includes(r.id)} onchange={(e) => toggle(r.id, e.currentTarget.checked)} aria-label={`Select ${r.subject || 'email'}`}>
    <button class="rel" onclick={() => onopen(r)}><span>{r.subject || '(no subject)'}</span><time>{when(r.at)}</time></button>
    <div class="ics"><button class="ic" title={r.unread ? 'Mark read' : 'Mark unread'} onclick={() => act('read', [r.id], r.unread)}>{r.unread ? '✉' : '📭'}</button><button class="ic" title="Move to Trash" onclick={() => act('trash', [r.id])}>🗑</button></div>
  </li>{:else}{#if !loading}<li class="muted empty">No other messages.</li>{/if}{/each}</ul>
</aside>

<style>
  .related{width:300px;flex:none;border-left:1px solid #e4e9f2;padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:7px;font-size:12px;background:#fff;box-sizing:border-box}
  header{display:flex;gap:8px;align-items:flex-start}header strong{flex:1;min-width:0;font-size:13px;overflow-wrap:anywhere}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}.x{border:0;padding:2px 4px}
  .seg{display:flex}.seg button{flex:1;border-radius:0}.seg button:first-child{border-radius:7px 0 0 7px}.seg button:last-child{border-radius:0 7px 7px 0;border-left:0}.seg .on{background:#3157de;border-color:#3157de;color:#fff}
  .chk{display:flex;gap:6px;align-items:center;color:#53607a}.muted{color:#8a95a8}.err{color:#a5414d;margin:0}.bulk{display:flex;gap:5px;align-items:center}.bulk span{flex:1}.del{color:#b53c50}
  ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}li{display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:6px;align-items:center;background:#f7f8fb;border-radius:8px;padding:6px}li.active{outline:2px solid #8da2f0}.empty{display:block}
  .rel{border:0;background:none;padding:0;text-align:left;display:grid;gap:2px;font-weight:500;min-width:0}.rel span{overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;color:#29344c}.rel time{color:#8a95a8;font-size:11px}li.unread .rel span{font-weight:800}
  .ics{display:flex;flex-direction:column;gap:2px}.ic{border:0;background:none;padding:2px 4px;font-size:18px;line-height:1}
</style>
