<script lang="ts">
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import AppShell from '$lib/components/AppShell.svelte';
  import { asanaApi } from '$lib/asana-client';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  type Box = { address: string; name: string; total: number; unread: number };
  type Msg = { id: string; subject: string; from: string; to: string; summary: string; at: number; unread: boolean; attachments: boolean };
  let accounts = $state<{ accountId: string; email: string; boxes: Box[]; error: string }[]>([]), loadingBoxes = $state(true);
  let sel = $state<{ accountId: string; address: string; name: string } | null>(null), unreadOnly = $state(true);
  let msgs = $state<Msg[]>([]), next = $state<number | null>(null), loading = $state(false), notice = $state('');
  let open = $state<Msg | null>(null), body = $state<{ html: string; text: string; note: string } | null>(null);
  let asanaFor = $state<{ name: string; notes: string; day: string } | null>(null);
  let compose = $state<{ to: string; subject: string; text: string } | null>(null), findOpen = $state(false), findTerm = $state(''), senderOnly = $state(''), senderBusy = $state(false);
  const senderKey = (from: string) => from.match(/[\w.+'-]+@[\w.-]+\.[a-z]{2,}/i)?.[0].toLowerCase() || from.trim().toLowerCase();
  let visibleMsgs = $derived(msgs.filter((m) => !senderOnly || senderKey(m.from) === senderOnly));
  let openIndex = $derived(open ? visibleMsgs.findIndex((m) => m.id === open?.id) : -1);

  const api = async (op: string, payload: Record<string, unknown> = {}) => {
    const res = await fetch('/emails/shared/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...payload }) }).catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : { error: 'Could not reach AadOS.' };
    if (!res?.ok || b.error) throw new Error(b.error || `HTTP ${res?.status}`);
    return b;
  };
  const when = (ms: number) => { if (!ms) return ''; const d = new Date(ms); return Date.now() - ms < 86_400_000 ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const doc = (b: { html: string; text: string }) => { const raw = b.html || `<pre style="white-space:pre-wrap;font:inherit">${esc(b.text)}</pre>`; const marked = findTerm.trim().length > 1 ? raw.replace(/(^|>)([^<]+)/g, (_m, a, t) => a + t.replace(new RegExp(findTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (x: string) => `<mark>${x}</mark>`)) : raw; return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;color:#29344c;word-break:break-word}img{max-width:100%;height:auto}mark{background:#ffe066}</style>${marked}`; };

  async function loadBoxes(fresh = false) {
    try { accounts = (await api('boxes', { fresh })).accounts; } catch (e) { notice = (e as Error).message; } finally { loadingBoxes = false; }
    if (!sel) { const want = accounts.flatMap((a) => a.boxes.map((x) => ({ accountId: a.accountId, ...x }))).find((x) => (!data.box || x.address === data.box) && (!data.account || x.accountId === data.account)); if (want) choose(want.accountId, want); }
  }
  async function choose(accountId: string, box: Box) {
    sel = { accountId, address: box.address, name: box.name }; open = null; body = null; senderOnly = '';
    const u = new URL(page.url); u.searchParams.set('account', accountId); u.searchParams.set('box', box.address); replaceState(u, {});
    await loadList();
  }
  async function loadList(more = false) {
    if (!sel) return;
    loading = true; notice = '';
    try { const r = await api('list', { accountId: sel.accountId, address: sel.address, unreadOnly, start: more ? next : 0 }); msgs = more ? [...msgs, ...r.messages] : r.messages; next = r.next; }
    catch (e) { notice = (e as Error).message; } finally { loading = false; }
  }
  async function show(m: Msg) {
    open = m; body = null;
    if (m.unread) void markPreviewRead(m);
    try { body = await api('body', { accountId: sel!.accountId, id: m.id }); } catch (e) { body = { html: '', text: m.summary, note: (e as Error).message }; }
  }
  const nextMessage = (m: Msg) => { const i = visibleMsgs.findIndex((x) => x.id === m.id); return visibleMsgs[i + 1] ?? visibleMsgs[i - 1] ?? null; };
  async function move(offset: number) { const m = visibleMsgs[openIndex + offset]; if (m) await show(m); }
  async function moreFromSender() {
    if (senderBusy) return;
    if (senderOnly) { senderOnly = ''; await loadList(); return; }
    if (!open) return;
    senderOnly = senderKey(open.from);
    senderBusy = true; unreadOnly = false; notice = '';
    try {
      // Zoho's shared-mailbox API has no sender search. Scan older All-mail pages so this
      // action searches the mailbox instead of filtering only the 50 rows already on screen.
      const matches: Msg[] = []; let start: number | null = 0; let pages = 0;
      while (start !== null && pages < 10) {
        const r = await api('list', { accountId: sel!.accountId, address: sel!.address, unreadOnly: false, start });
        matches.push(...(r.messages as Msg[]).filter((m) => senderKey(m.from) === senderOnly));
        start = r.next; pages += 1;
      }
      if (open && !matches.some((m) => m.id === open?.id)) matches.unshift(open);
      msgs = matches; next = null;
      if (start !== null) notice = `Showing ${matches.length} matching messages from the first ${pages * 50} emails.`;
    } catch (e) {
      senderOnly = ''; notice = (e as Error).message;
    } finally { senderBusy = false; }
  }
  const counts = (delta: number) => { for (const a of accounts) for (const b of a.boxes) if (a.accountId === sel?.accountId && b.address === sel?.address) b.unread = Math.max(0, b.unread + delta); };
  async function markPreviewRead(m: Msg) {
    m.unread = false; counts(-1);
    try { await api('read', { accountId: sel!.accountId, address: sel!.address, id: m.id, read: true }); }
    catch (e) { m.unread = true; counts(1); notice = (e as Error).message; }
  }
  async function setRead(m: Msg, read: boolean) {
    const was = m.unread, changed = was !== !read; m.unread = !read; if (changed) counts(read ? -1 : 1);
    try { await api('read', { accountId: sel!.accountId, address: sel!.address, id: m.id, read }); if (unreadOnly && read) msgs = msgs.filter((x) => x.id !== m.id); }
    catch (e) { m.unread = was; if (changed) counts(read ? 1 : -1); notice = (e as Error).message; }
  }
  async function trash(m: Msg) {
    const before = msgs, replacement = open?.id === m.id ? nextMessage(m) : null; msgs = msgs.filter((x) => x.id !== m.id); if (open?.id === m.id) { if (replacement) void show(replacement); else { open = null; body = null; } } if (m.unread) counts(-1);
    try { await api('trash', { accountId: sel!.accountId, address: sel!.address, id: m.id }); } catch (e) { msgs = before; notice = (e as Error).message; }
  }
  async function trashClose(m: Msg) { const was = open; open = null; body = null; await trash(m); if (msgs.some((x) => x.id === m.id)) open = was; }
  async function unread(m: Msg, closeAfter = false) { const replacement = closeAfter ? null : nextMessage(m); if (closeAfter) { open = null; body = null; } else if (replacement) void show(replacement); else { open = null; body = null; } await setRead(m, false); }
  async function sendReply() {
    if (!compose || !sel) return;
    try { await api('send', { accountId: sel.accountId, address: sel.address, ...compose }); compose = null; notice = 'Reply sent.'; }
    catch (e) { notice = (e as Error).message; }
  }
  async function createAsana() {
    const a = asanaFor; if (!a) return;
    try { await asanaApi('create', { name: a.name, notes: a.notes, day: a.day }); asanaFor = null; notice = 'Asana task created.'; if (open?.unread) await setRead(open, true); } catch (e) { notice = (e as Error).message; }
  }
  // Live like the rest of mail: refresh the open box and the counts every 2 minutes while visible.
  onMount(() => {
    loadBoxes();
    const t = setInterval(() => { if (document.visibilityState === 'visible') { loadBoxes(true); if (!open) loadList(); } }, 120_000);
    return () => clearInterval(t);
  });
</script>

<svelte:head><title>Shared mailboxes · AadOS</title></svelte:head>
<AppShell title="Shared mailboxes">
<main>
  {#if notice}<div class="alert">{notice} <button class="link" onclick={() => (notice = '')}>✕</button></div>{/if}
  <div class="wrap" class:reading={Boolean(open)}>
    <aside class="boxes">
      <h2>Shared mailboxes</h2>
      {#if loadingBoxes}<p class="muted">Finding your shared mailboxes…</p>{/if}
      {#each accounts as a (a.accountId)}<div class="acct"><small>Zoho · {a.email}</small>
        {#if a.error}<small class="err">{a.error}</small>{/if}
        {#each a.boxes as b (b.address)}<button class="box" class:on={sel?.accountId === a.accountId && sel?.address === b.address} onclick={() => choose(a.accountId, b)} title={b.address}><span>{b.name}</span>{#if b.unread}<i>{b.unread}</i>{/if}</button>{:else}{#if !a.error}<small class="muted">None found for this account.</small>{/if}{/each}
      </div>{:else}{#if !loadingBoxes}<p class="muted">No Zoho account with shared mailboxes.</p>{/if}{/each}
    </aside>
    <section class="list">
      {#if sel}<header><strong>{sel.name}</strong><small>{sel.address}{senderOnly ? ` · ${visibleMsgs.length} from sender` : ''}</small><span class="sp"></span>
        <div class="seg"><button class:on={unreadOnly} onclick={() => { unreadOnly = true; loadList(); }}>Unread</button><button class:on={!unreadOnly} onclick={() => { unreadOnly = false; loadList(); }}>All</button></div></header>
        {#if loading && !msgs.length}<p class="muted pad">Loading…</p>{/if}
        <ul>{#each visibleMsgs as m (m.id)}<li class:unread={m.unread} class:on={open?.id === m.id}>
          <button class="ic" title={m.unread ? 'Mark read' : 'Mark unread'} onclick={() => setRead(m, m.unread)}>{m.unread ? '✉' : '📭'}</button><button class="ic" title="Move to Trash" onclick={() => trash(m)}>🗑</button>
          <button class="row" onclick={() => show(m)}><span class="r1"><b>{m.from || '—'}</b><time>{when(m.at)}</time></span><span class="subj">{m.subject}{m.attachments ? ' 📎' : ''}</span><span class="sum">{m.summary}</span></button>
        </li>{:else}{#if !loading}<li class="muted pad">{unreadOnly ? 'No unread mail.' : 'No messages.'}</li>{/if}{/each}</ul>
        {#if next !== null}<button class="more" onclick={() => loadList(true)} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>{/if}
      {:else}<p class="muted pad">Pick a shared mailbox.</p>{/if}
    </section>
    {#if open}<section class="pane">
      <header><button class="back" onclick={() => { open = null; body = null; }}>✕</button><div><h3>{open.subject}</h3><small>{open.from}{open.to ? ` → ${open.to}` : ''} · {new Date(open.at).toLocaleString()}</small></div>
        <div class="acts"><div class="pair"><button class="del" onclick={() => open && trash(open)}>🗑 Delete</button><button class="alt del" onclick={() => open && trashClose(open)}>Delete &amp; close</button></div><div class="pair"><button onclick={() => open && unread(open)}>✉ Unread</button><button class="alt" onclick={() => open && unread(open, true)}>Unread &amp; close</button></div><button onclick={() => open && (compose = { to: open.from.replace(/^.*<([^>]+)>$/, '$1'), subject: /^re:/i.test(open.subject) ? open.subject : `Re: ${open.subject}`, text: '' })}>↩ Reply</button><button onclick={() => (findOpen = !findOpen)}>⌕ Find</button><button class:on={Boolean(senderOnly)} onclick={moreFromSender} disabled={senderBusy}>{senderBusy ? 'Finding…' : senderOnly ? 'Show all mail' : 'More from sender'}</button>{#if data.asana}<button class="asana" onclick={() => open && (asanaFor = { name: open.subject, notes: `From: ${open.from}\nTo: ${open.to}\nDate: ${new Date(open.at).toLocaleString()}\nShared mailbox: ${sel?.name}\n\n${body?.text || open.summary}`, day: new Date().toISOString().slice(0, 10) })}>→ Asana</button>{/if}<nav><button disabled={openIndex <= 0} onclick={() => move(-1)}>↑</button><button disabled={openIndex < 0 || openIndex >= visibleMsgs.length - 1} onclick={() => move(1)}>↓</button></nav></div></header>
      {#if findOpen}<div class="find"><input bind:value={findTerm} placeholder="Find in this email" aria-label="Find in this email"></div>{/if}
      {#if body?.note}<p class="note">{body.note}</p>{/if}
      {#if !body}<p class="muted pad">Loading…</p>{:else}<iframe title="Email body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc={doc(body)}></iframe>{/if}
    </section>{/if}
  </div>
  {#if asanaFor}<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) asanaFor = null; }}><form class="sheet" onsubmit={(e) => { e.preventDefault(); createAsana(); }}><h3>Create Asana task</h3><input bind:value={asanaFor.name} aria-label="Title"><label class="rowl">Due <input type="date" bind:value={asanaFor.day}></label><textarea rows="8" bind:value={asanaFor.notes}></textarea><small class="muted">The message is marked read after the task is created.</small><div class="end"><button type="button" onclick={() => (asanaFor = null)}>Cancel</button><button class="primary">Create task</button></div></form></div>{/if}
  {#if compose}<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) compose = null; }}><form class="sheet" onsubmit={(e) => { e.preventDefault(); sendReply(); }}><h3>Reply from {sel?.address}</h3><label>To<input bind:value={compose.to}></label><label>Subject<input bind:value={compose.subject}></label><textarea rows="10" bind:value={compose.text} placeholder="Write your reply…"></textarea><div class="end"><button type="button" onclick={() => (compose = null)}>Discard</button><button class="send">Send</button></div></form></div>{/if}
</main>
</AppShell>

<style>
  main{color:#29344c;font-size:13px}
  .alert{background:#eef1ff;border:1px solid #cfd8ff;color:#3157de;border-radius:10px;padding:8px 12px;margin-bottom:8px}
  .wrap{display:grid;grid-template-columns:230px minmax(280px,1fr);gap:12px;height:calc(100vh - 120px)}.wrap.reading{grid-template-columns:200px minmax(260px,28%) minmax(0,1fr)}
  .boxes,.list,.pane{background:#fff;border:1px solid #e4e9f2;border-radius:14px;display:flex;flex-direction:column;min-height:0;overflow:auto}
  .boxes{padding:10px;gap:8px}.boxes h2{margin:0;font-size:14px}.acct{display:grid;gap:3px}.acct small{color:#8a95a8}
  .box{display:flex;justify-content:space-between;align-items:center;border:0;background:none;text-align:left;padding:7px 9px;border-radius:8px;font-weight:600;color:#29344c;cursor:pointer}.box:hover{background:#f4f6fb}.box.on{background:#eef1ff;color:#3157de}.box i{font-style:normal;background:#3157de;color:#fff;border-radius:999px;font-size:11px;padding:1px 7px}
  .list header,.pane header{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid #eef0f5}.list header small{color:#8a95a8}.sp{flex:1}
  .seg{display:flex}.seg button{border-radius:0;padding:5px 10px}.seg button:first-child{border-radius:7px 0 0 7px}.seg button:last-child{border-radius:0 7px 7px 0;border-left:0}.seg .on{background:#3157de;border-color:#3157de;color:#fff}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:5px 10px;font-weight:700;color:#43516c;cursor:pointer;font-size:12px}.link{border:0;background:none;color:#3157de;padding:0}
  ul{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:30px 30px minmax(0,1fr);gap:4px;align-items:start;padding:8px 10px;border-top:1px solid #f1f3f7}li.unread{background:#fbfcff}li.on{background:#eef3ff}
  .ic{border:0;background:none;font-size:18px;padding:2px;opacity:.85}.row{border:0;background:none;text-align:left;display:grid;gap:2px;padding:0;min-width:0;font-weight:500}
  .r1{display:flex;justify-content:space-between;gap:6px}.r1 b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.r1 time{color:#8a95a8;font-size:11px;flex:none}
  .subj{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1f2a44}li.unread .subj,li.unread b{font-weight:800}.sum{color:#8a95a8;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .more{margin:10px auto}.pad{padding:14px}.muted{color:#8a95a8}.err{color:#a5414d}
  .pane header{align-items:flex-start}.pane header div{flex:1;min-width:0}.pane h3{margin:0;font-size:15px}.pane small{color:#8a95a8}.acts{display:flex;gap:6px;flex-wrap:wrap}.del{color:#b53c50}.asana{background:#fdeeee;border-color:#f5c9cb;color:#d2474c}
  .pair{display:flex!important;flex:none!important}.pair>button:first-child{border-radius:7px}.alt{max-width:0;opacity:0;overflow:hidden;white-space:nowrap;padding-left:0;padding-right:0;border-width:1px 0;pointer-events:none;transition:.15s}.pair:hover>button:first-child,.pair:focus-within>button:first-child{border-radius:7px 0 0 7px}.pair:hover .alt,.pair:focus-within .alt{max-width:120px;opacity:1;padding:5px 10px;border-width:1px;border-left:0;border-radius:0 7px 7px 0;pointer-events:auto}.acts nav{display:flex;gap:4px}.acts button.on{background:#eef1ff;color:#3157de}.find{padding:7px 12px;border-bottom:1px solid #eef0f5}.find input{width:100%;box-sizing:border-box}
  .note{margin:0;padding:6px 12px;background:#fff8e6;color:#8a6a1c;font-size:12px}iframe{flex:1;border:0;width:100%;min-height:300px}
  .backdrop{position:fixed;inset:0;background:#151c2d55;z-index:60;display:grid;place-items:start center;padding:8vh 16px}.sheet{background:#fff;border-radius:14px;padding:18px;width:min(520px,100%);display:grid;gap:9px}.sheet h3{margin:0}
  input,textarea{border:1px solid #d9dfeb;border-radius:7px;padding:6px 8px;font:inherit}.sheet label{display:grid;gap:4px;font-weight:700}.rowl{display:flex!important;gap:6px;align-items:center;font-weight:600;color:#53607a}.end{display:flex;gap:8px;justify-content:flex-end}.primary{background:#e95f63;border-color:#e95f63;color:#fff}.send{background:#3157de;border-color:#3157de;color:#fff}
  @media(max-width:900px){.wrap,.wrap.reading{grid-template-columns:1fr;height:auto}.wrap.reading .list,.wrap.reading .boxes{display:none}}
</style>
