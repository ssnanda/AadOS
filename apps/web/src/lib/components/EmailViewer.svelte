<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import EmailAI from './EmailAI.svelte';
  // Read-only viewer: the body is fetched on demand and rendered in a sandboxed iframe.
  let { item, onclose, onprevious, onnext, ondelete, canPrevious = false, canNext = false, ai = false, embedded = false }: { item: { pipelineId: string; messageId: string; subject: string; sender: string; receivedAt: string; key?: string }; onclose: () => void; onprevious?: () => void; onnext?: () => void; ondelete?: () => void; canPrevious?: boolean; canNext?: boolean; ai?: boolean; embedded?: boolean } = $props();
  let body = $state<{ html: string; text: string } | null>(null);
  let loadError = $state('');
  let loading = $state(true);
  let images = $state(false);
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  $effect(() => {
    const target = item; body = null; loadError = ''; images = false; loading = true;
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
  const doc = (b: { html: string; text: string }, allowImages: boolean) =>
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${allowImages ? 'https:' : ''}; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;color:#29344c;word-break:break-word}img{max-width:100%;height:auto}</style>${b.html || `<pre style="white-space:pre-wrap;font:inherit">${esc(b.text)}</pre>`}`;
</script>
<svelte:window onkeydown={keyboard} />
<aside class="viewer" class:embedded aria-label="Email">
  <header><button type="button" class="close" onclick={close} title="Close (Esc)">{embedded ? '✕' : '← Back'}</button><div><h3>{item.subject || '(no subject)'}</h3><p>{item.sender} · {new Date(item.receivedAt).toLocaleString()}</p></div>
    <nav aria-label="Email navigation"><button type="button" onclick={onprevious} disabled={!canPrevious} title="Previous email">↑</button><button type="button" onclick={onnext} disabled={!canNext} title="Next email">↓</button></nav>
    {#if body?.html && !images}<button type="button" onclick={() => images = true}>Load images</button>{/if}{#if ondelete}<button type="button" class="delete" onclick={ondelete}>Delete</button>{/if}</header>
  {#if ai && item.key}<EmailAI messageKey={item.key} subject={item.subject} />{/if}
  {#if loading}<div class="msg">Loading…</div>
  {:else if loadError}<div class="msg err">{loadError}</div>
  {:else if body}<iframe title="Email body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc={doc(body, images)}></iframe>{/if}
</aside>
<style>
  .viewer{position:fixed;inset:0;background:#fff;z-index:41;display:flex;flex-direction:column}
  /* Preview pane next to the list (desktop); full screen on small screens. */
  .viewer.embedded{position:sticky;top:12px;inset:auto;z-index:1;height:calc(100vh - 110px);border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}
  @media(max-width:900px){.viewer.embedded{position:fixed;inset:0;top:0;height:auto;border:0;border-radius:0;z-index:41}}
  header{display:flex;gap:10px;align-items:flex-start;padding:14px 18px;border-bottom:1px solid #e4e9f2}header>div{flex:1;min-width:0}h3{margin:0;font-size:16px}header p{margin:3px 0 0;font-size:12px;color:#8792a6}
  header nav{display:flex;gap:4px}button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button:hover{border-color:#8da2f0;color:#3157de}button:disabled{opacity:.4;cursor:default}.delete{color:#b53c50}.close{color:#3157de}
  iframe{flex:1;border:0;width:100%;background:#fff}.msg{padding:30px;color:#8792a6}.msg.err{color:#a5414d}
</style>
