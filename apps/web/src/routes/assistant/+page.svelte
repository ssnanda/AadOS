<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import AppShell from '$lib/components/AppShell.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  type Msg = { id: number; role: 'user' | 'assistant'; content: string; sources: { id: string; kind: string; title: string; href: string; date: string }[]; provider: string; model: string; latencyMs: number | null; error: string };
  let question = $state('');
  let busy = $state(false);
  let failure = $state('');
  let pending = $state<Msg[]>([]);
  let controller: AbortController | null = null;
  let renaming = $state(false);
  let copied = $state(0);
  const messages = $derived([...((data.current?.messages ?? []) as Msg[]), ...pending]);
  const EXAMPLES = ['Which emails need my attention?', 'What do I need to reply to?', 'What bills are due soon?', 'What are my appointments tomorrow?', "What's happening this weekend?", 'Which subscriptions are renewing?', 'Summarize my week.'];

  async function call(payload: Record<string, unknown>) {
    controller = new AbortController();
    const res = await fetch('/assistant/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }
  async function send(text = question, op: 'ask' | 'retry' = 'ask') {
    const q = text.trim();
    if ((!q && op === 'ask') || busy) return;
    busy = true; failure = '';
    if (op === 'ask') pending = [{ id: -1, role: 'user', content: q, sources: [], provider: '', model: '', latencyMs: null, error: '' }];
    question = '';
    try {
      const r = await call({ op, question: q, conversationId: data.current?.conversation.id || null });
      pending = [];
      if (!data.current || data.current.conversation.id !== r.conversationId) await goto(`/assistant?c=${r.conversationId}`, { invalidateAll: true });
      else await invalidateAll();
    } catch (e) {
      failure = e instanceof Error && e.name === 'AbortError' ? 'Cancelled.' : e instanceof Error ? e.message : 'Request failed.';
      if (op === 'ask') question = q;
      pending = [];
    } finally { busy = false; controller = null; }
  }
  const cancel = () => controller?.abort();
  async function rename(e: SubmitEvent) {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget as HTMLFormElement).get('title') || '');
    await call({ op: 'rename', id: data.current!.conversation.id, title }); renaming = false; await invalidateAll();
  }
  async function remove() {
    if (!data.current || !confirm('Delete this conversation? This cannot be undone.')) return;
    await call({ op: 'delete', id: data.current.conversation.id }); await goto('/assistant', { invalidateAll: true });
  }
  async function copy(m: Msg) { await navigator.clipboard.writeText(m.content); copied = m.id; setTimeout(() => copied = 0, 1500); }
  // Plain text with [S1] citations turned into links to the original records. Everything else is escaped.
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const render = (m: Msg) => esc(m.content).replace(/\[(S\d+)\]/g, (all, id) => { const s = m.sources.find((x) => x.id === id); return s ? `<a class="cite" href="${esc(s.href)}" title="${esc(s.title)}">${id}</a>` : ''; }).replace(/\n/g, '<br>');
  const icon = (k: string) => ({ email: '✉', event: '▣', document: '▤' }[k] || '•');
</script>
<svelte:head><title>AI Assistant · AadOS</title></svelte:head>
<AppShell title="AI Assistant">
<div class="wrap">
  <aside class="list">
    <a class="btn new" href="/assistant">＋ New conversation</a>
    <form method="GET" class="find"><span>⌕</span><input type="search" name="q" value={data.q} placeholder="Search conversations" aria-label="Search conversations"></form>
    {#if data.conversations.length === 0}<p class="muted">{data.q ? 'No matches.' : 'No conversations yet.'}</p>{/if}
    <ul>{#each data.conversations as c (c.id)}<li><a class:on={data.current?.conversation.id === c.id} href={`/assistant?c=${c.id}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`}><strong>{c.title}</strong><small>{new Date(c.updatedAt).toLocaleString()}</small></a></li>{/each}</ul>
  </aside>
  <main>
    {#if !data.available}<div class="empty">The assistant stores conversations in PostgreSQL, which this instance does not use (AADOS_STORAGE=postgres).</div>
    {:else}
    <header>
      {#if data.current}
        {#if renaming}<form class="rename" onsubmit={rename}><input name="title" value={data.current.conversation.title} maxlength="120" aria-label="Conversation title"><button class="btn">Save</button><button type="button" class="btn" onclick={() => renaming = false}>Cancel</button></form>
        {:else}<h1>{data.current.conversation.title}</h1><button class="btn sm" onclick={() => renaming = true}>Rename</button><button class="btn sm danger" onclick={remove}>Delete</button>{/if}
      {:else}<h1>AI Assistant</h1>{/if}
    </header>
    {#if !data.aiEnabled || !data.aiConfigured}<div class="note">{!data.aiConfigured ? 'AJMCP is not configured yet' : 'AI is turned off'} — answers list the matching AadOS records without AI. <a href="/settings/ai">Settings → AI</a></div>{/if}
    <section class="chat" aria-live="polite">
      {#if messages.length === 0}
        <div class="intro"><p>Ask about your email, calendar and documents. Answers use only your AadOS data and link to the sources.</p>
          <div class="ex">{#each EXAMPLES as e (e)}<button type="button" onclick={() => send(e)}>{e}</button>{/each}</div></div>
      {/if}
      {#each messages as m (m.id)}
        <article class={m.role}>
          {#if m.role === 'user'}<p>{m.content}</p>
          {:else}
            <div class="body">{@html render(m)}</div>
            {#if m.sources.length}<ul class="src">{#each m.sources as s (s.id)}<li><a href={s.href}><b>{s.id}</b> {icon(s.kind)} {s.title}{s.date ? ` · ${s.date}` : ''}</a></li>{/each}</ul>{/if}
            <footer>{#if m.error}<span class="err">{m.error}</span>{/if}{#if m.model || m.provider}<span>{[m.provider, m.model].filter(Boolean).join(' · ')}{m.latencyMs ? ` · ${(m.latencyMs / 1000).toFixed(1)}s` : ''}</span>{:else if !m.error}<span>No AI · AadOS records only</span>{/if}<button type="button" onclick={() => copy(m)}>{copied === m.id ? 'Copied' : 'Copy'}</button></footer>
          {/if}
        </article>
      {/each}
      {#if busy}<article class="assistant"><p class="muted">Looking through your data…</p></article>{/if}
    </section>
    {#if failure}<div class="alert">{failure}{#if data.current}<button class="btn sm" onclick={() => send('', 'retry')}>Retry</button>{/if}</div>{/if}
    <form class="ask" onsubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea bind:value={question} rows="2" maxlength="2000" placeholder="Ask about your email, calendar or documents…" aria-label="Question" onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
      {#if busy}<button type="button" class="btn" onclick={cancel}>Cancel</button>{:else}<button class="btn primary" disabled={!question.trim()}>Ask</button>{/if}
    </form>
    <p class="privacy">Only the matching records (short excerpts) are sent to your AJMCP gateway, which may use an external AI provider. Instructions inside emails or documents are ignored.</p>
    {/if}
  </main>
</div>
</AppShell>
<style>
  .wrap{display:grid;grid-template-columns:260px 1fr;gap:16px;max-width:1150px;align-items:start}
  .list{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:10px;display:grid;gap:8px;position:sticky;top:10px;max-height:calc(100vh - 40px);overflow:auto}
  .list ul{list-style:none;margin:0;padding:0;display:grid;gap:2px}.list a{display:grid;padding:7px 9px;border-radius:8px;text-decoration:none;color:#29344c}.list a:hover{background:#f4f6fa}.list a.on{background:#eef1ff}
  .list strong{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.list small{font-size:10px;color:#8a95a8}
  .find{display:flex;gap:6px;align-items:center;border:1px solid #e4e9f2;border-radius:9px;padding:0 9px}.find span{color:#8a95a8}.find input{border:0;outline:0;flex:1;padding:7px 0;font-size:12px;min-width:0}
  .btn{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:8px 13px;color:#43516c;font-weight:700;cursor:pointer;font-size:13px;text-decoration:none;text-align:center}.btn:hover{border-color:#8da2f0}.btn.sm{padding:4px 9px;font-size:11px}.btn.danger{color:#a5414d}.btn.primary{background:#3157de;border-color:#3157de;color:#fff}.btn:disabled{opacity:.5;cursor:default}
  main{min-width:0}header{display:flex;gap:8px;align-items:center;margin-bottom:10px}h1{margin:0;font-size:20px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}.rename{display:flex;gap:6px;flex:1}.rename input{flex:1;border:1px solid #dbe1eb;border-radius:8px;padding:7px}
  .note{padding:9px 14px;border-radius:9px;margin-bottom:10px;font-size:12px;background:#fff4df;color:#8a6420}.note a{color:#8a6420;font-weight:700}.alert{padding:9px 14px;border-radius:9px;margin:10px 0;font-size:13px;background:#fff0f1;color:#a5414d;display:flex;gap:10px;align-items:center}
  .chat{display:grid;gap:10px;min-height:200px}.intro{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:16px;color:#53607a;font-size:13px}.intro p{margin:0 0 10px}
  .ex{display:flex;gap:6px;flex-wrap:wrap}.ex button{border:1px solid #e4e9f2;background:#f7f8fb;border-radius:99px;padding:5px 11px;font-size:12px;color:#43516c;cursor:pointer}.ex button:hover{border-color:#8da2f0;color:#3157de}
  article{border-radius:12px;padding:11px 14px;font-size:14px;line-height:1.5;max-width:min(760px,100%)}article.user{background:#3157de;color:#fff;justify-self:end}article.user p{margin:0;white-space:pre-wrap}
  article.assistant{background:#fff;border:1px solid #e4e9f2;color:#29344c}.body :global(.cite){display:inline-block;background:#eef1ff;color:#3157de;border-radius:5px;padding:0 5px;font-size:11px;font-weight:800;text-decoration:none;margin:0 1px}
  .src{list-style:none;margin:10px 0 0;padding:8px 0 0;border-top:1px solid #eef0f5;display:grid;gap:3px}.src a{font-size:12px;color:#53607a;text-decoration:none}.src a:hover{color:#3157de}.src b{color:#3157de;font-size:10px}
  footer{display:flex;gap:10px;align-items:center;margin-top:8px;font-size:11px;color:#8a95a8}footer button{margin-left:auto;border:1px solid #e4e9f2;background:#fff;border-radius:6px;padding:2px 9px;font-size:11px;cursor:pointer;color:#53607a}.err{color:#a5414d}
  .muted{color:#8a95a8;font-size:12px;margin:0}.ask{display:flex;gap:8px;margin-top:12px;align-items:flex-end}.ask textarea{flex:1;border:1px solid #e4e9f2;border-radius:12px;padding:10px 12px;font:inherit;font-size:14px;resize:vertical;background:#fff}
  .privacy{font-size:11px;color:#8a95a8;margin:6px 2px}.empty{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:35px;text-align:center;color:#8c96a8}
  @media(max-width:760px){.wrap{grid-template-columns:1fr}.list{position:static;max-height:220px}}
</style>
