<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import EmailAI from './EmailAI.svelte';
  import MailTools from './MailTools.svelte';
  import RelatedPanel from './RelatedPanel.svelte';
  import AsanaFromEmail from './asana/AsanaFromEmail.svelte';
  // Read-only viewer: the body is fetched on demand and rendered in a sandboxed iframe.
  // One header row: title, then Delete, Mark read/unread, Keep unread ↓, Reply, Rules, Find, More from sender, ↑ ↓.
  let { item, onclose, onprevious, onnext, ondelete, canPrevious = false, canNext = false, ai = false, aiBlocked = '', embedded = false, unread = false, onmarkread, onmarkunread, onkeepunread, onchanged, accountId = '', onopen }: { item: { pipelineId: string; messageId: string; subject: string; sender: string; receivedAt: string; key?: string }; onclose: () => void; onprevious?: () => void; onnext?: () => void; ondelete?: () => void; canPrevious?: boolean; canNext?: boolean; ai?: boolean; aiBlocked?: string; embedded?: boolean; unread?: boolean; onmarkread?: () => void; onmarkunread?: () => void; onkeepunread?: () => void; onchanged?: () => void; accountId?: string; onopen?: (item: any) => void } = $props();
  let moreOpen = $state(false);
  let asanaOpen = $state(false), asanaNote = $state('');
  $effect(() => { void item.key; asanaNote = ''; });
  let findTerm = $state('');
  let body = $state<{ html: string; text: string } | null>(null);
  let loadError = $state('');
  let loading = $state(true);
  let images = $state(true); // remote images load automatically (owner preference)
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  $effect(() => {
    const target = item; body = null; loadError = ''; images = true; loading = true;
    fetch(`/pipelines/${target.pipelineId}/message/${encodeURIComponent(target.messageId)}`)
      .then(async (res) => { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`); body = await res.json(); })
      .catch((cause) => { loadError = cause instanceof Error ? cause.message : 'Could not load this email.'; })
      .finally(() => { loading = false; });
  });
  async function close() { onclose(); await invalidateAll(); }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'ArrowUp' && canPrevious) { event.preventDefault(); onprevious?.(); }
    if (event.key === 'ArrowDown' && canNext) { event.preventDefault(); onnext?.(); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }
  // Find: wrap matches (outside of tags) in <mark>. The frame stays script-free.
  const mark = (html: string, t: string) => { if (t.trim().length < 2) return html; const re = new RegExp(t.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); return html.replace(/(^|>)([^<]+)/g, (_m: string, a: string, txt: string) => a + txt.replace(re, (x) => `<mark style="background:#ffe066">${x}</mark>`)); };
  const doc = (b: { html: string; text: string }, allowImages: boolean) =>
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${allowImages ? 'https:' : ''}; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;color:#29344c;word-break:break-word}img{max-width:100%;height:auto}</style>${mark(b.html || `<pre style="white-space:pre-wrap;font:inherit">${esc(b.text)}</pre>`, findTerm)}`;
</script>
{#snippet title()}<button type="button" class="close" onclick={close} title="Close (Esc)">{embedded ? '✕' : '← Back'}</button><div class="ttl"><h3>{item.subject || '(no subject)'}</h3><p>{item.sender} · {new Date(item.receivedAt).toLocaleString()}</p></div>{/snippet}
{#snippet lead()}{#if ondelete}<button type="button" class="delete" onclick={ondelete} title="Move to Gmail/Zoho Trash">🗑 Delete</button>{/if}{#if unread && onmarkread}<button type="button" onclick={onmarkread} title="Mark read in the mailbox">✉ Mark read</button>{:else if onmarkunread}<button type="button" onclick={onmarkunread} title="Mark unread in the mailbox">✉ Mark unread</button>{/if}{#if onkeepunread}<button type="button" onclick={onkeepunread} title="Leave this email unread and open the next one">Keep unread ↓</button>{/if}{#if item.key}<button type="button" class="asana" onclick={() => (asanaOpen = true)} title="Create an Asana follow-up task from this email (AI drafts it), then mark the email read">→ Asana</button>{/if}{/snippet}
{#snippet trail()}<nav aria-label="Email navigation"><button type="button" onclick={onprevious} disabled={!canPrevious} title="Previous email (↑)">↑</button><button type="button" onclick={onnext} disabled={!canNext} title="Next email (↓)">↓</button></nav>{/snippet}
<svelte:window onkeydown={keyboard} />
<aside class="viewer" class:embedded aria-label="Email">
  {#if item.key}<MailTools item={{ ...item, key: item.key }} {accountId} aiAvailable={ai && !aiBlocked} {aiBlocked} onfind={(t) => (findTerm = t)} header={title} {lead} {trail} {moreOpen} onmore={() => (moreOpen = !moreOpen)} />
  {:else}<header>{@render title()}<div class="bar">{@render lead()}{@render trail()}</div></header>{/if}
  {#if asanaNote}<div class="asanaNote">{asanaNote} <button type="button" class="link" onclick={() => (asanaNote = '')}>✕</button></div>{/if}
  {#if asanaOpen && item.key}<AsanaFromEmail emailKey={item.key} subject={item.subject} onclose={() => (asanaOpen = false)} oncreated={(note) => { asanaNote = note; onchanged?.(); }} />{/if}
  {#if ai && item.key}<EmailAI messageKey={item.key} subject={item.subject} />{/if}
  <div class="content">
    <div class="body">
      {#if loading}<div class="msg">Loading…</div>
      {:else if loadError}<div class="msg err">{loadError}</div>
      {:else if body}<iframe title="Email body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc={doc(body, images)}></iframe>{/if}
    </div>
    {#if moreOpen && item.key}<RelatedPanel item={{ ...item, key: item.key }} activeKey={item.key} {onopen} {onchanged} onclose={() => (moreOpen = false)} />{/if}
  </div>
</aside>
<style>
  .viewer{position:fixed;inset:0;background:#fff;z-index:41;display:flex;flex-direction:column}
  /* Preview pane next to the list (desktop); full screen on small screens. */
  .viewer.embedded{position:sticky;top:12px;inset:auto;z-index:1;height:calc(100vh - 110px);border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}
  @media(max-width:900px){.viewer.embedded{position:fixed;inset:0;top:0;height:auto;border:0;border-radius:0;z-index:41}}
  header{display:flex;gap:10px;align-items:flex-start;padding:14px 18px;border-bottom:1px solid #e4e9f2}.bar{display:flex;gap:5px;flex-wrap:wrap;margin-left:auto}
  .ttl{flex:1;min-width:180px}h3{margin:0;font-size:16px}.ttl p{margin:3px 0 0;font-size:12px;color:#8792a6}
  nav{display:flex;gap:4px}button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button:hover{border-color:#8da2f0;color:#3157de}button:disabled{opacity:.4;cursor:default}.delete{color:#b53c50}.close{color:#3157de}.asana{background:#fdeeee;border-color:#f5c9cb;color:#d2474c}.link{border:0;background:none;padding:0;color:#3157de}.asanaNote{background:#e9f7ef;color:#1e7a47;font-size:12px;font-weight:600;padding:6px 18px;border-bottom:1px solid #d3eedd}
  .content{flex:1;display:flex;min-height:0}.body{flex:1;display:flex;flex-direction:column;min-width:0}
  @media(max-width:900px){.content{flex-direction:column}.content :global(.related){width:auto;max-height:45%;border-left:0;border-top:1px solid #e4e9f2}}
  iframe{flex:1;border:0;width:100%;background:#fff}.msg{padding:30px;color:#8792a6}.msg.err{color:#a5414d}
</style>
