<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  // Read-only viewer: the body is fetched on demand and rendered in a sandboxed iframe.
  let { item, onclose }: { item: { pipelineId: string; messageId: string; subject: string; sender: string; receivedAt: string }; onclose: () => void } = $props();
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
  const doc = (b: { html: string; text: string }, allowImages: boolean) =>
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${allowImages ? 'https:' : ''}; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;color:#29344c;word-break:break-word}img{max-width:100%;height:auto}</style>${b.html || `<pre style="white-space:pre-wrap;font:inherit">${esc(b.text)}</pre>`}`;
</script>
<div class="backdrop" role="presentation" onclick={close}></div>
<aside class="viewer" aria-label="Email">
  <header><div><h3>{item.subject || '(no subject)'}</h3><p>{item.sender} · {new Date(item.receivedAt).toLocaleString()}</p></div>
    {#if body?.html && !images}<button type="button" onclick={() => images = true}>Load images</button>{/if}<button type="button" onclick={close}>✕ Close</button></header>
  {#if loading}<div class="msg">Loading…</div>
  {:else if loadError}<div class="msg err">{loadError}</div>
  {:else if body}<iframe title="Email body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc={doc(body, images)}></iframe>{/if}
</aside>
<style>
  .backdrop{position:fixed;inset:0;background:#151c2d55;z-index:40}
  .viewer{position:fixed;top:0;right:0;bottom:0;width:min(900px,96vw);background:#fff;z-index:41;display:flex;flex-direction:column;box-shadow:-10px 0 30px #151c2d30}
  header{display:flex;gap:10px;align-items:flex-start;padding:14px 18px;border-bottom:1px solid #e4e9f2}header>div{flex:1;min-width:0}h3{margin:0;font-size:16px}header p{margin:3px 0 0;font-size:12px;color:#8792a6}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:3px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button:hover{border-color:#8da2f0;color:#3157de}
  iframe{flex:1;border:0;width:100%;background:#fff}.msg{padding:30px;color:#8792a6}.msg.err{color:#a5414d}
</style>
