<script lang="ts">
  import { enhance } from '$app/forms';
  import AppShell from '$lib/components/AppShell.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let asking = $state(false);
  const size = (b: number) => (b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const answer = $derived(form && 'answer' in form ? form.answer : null);
  const rendered = $derived(answer ? esc(answer.text).replace(/\[(S\d+)\]/g, (m, id) => { const s = answer.sources.find((x: { id: string }) => x.id === id); return s ? `<a class="cite" href="${esc(s.href)}">${id}</a>` : ''; }).replace(/\n/g, '<br>') : '');
  const QUICK = ['Summarize this document.', 'What dates and deadlines does it mention?', 'What amounts or fees does it mention?', 'Find the termination or cancellation clause.'];
</script>
<svelte:head><title>{data.doc.filename} · Documents · AadOS</title></svelte:head>
<AppShell title="Documents">
<main>
  <p class="back"><a href="/documents">← Documents</a></p>
  <header><h1>{data.doc.filename}</h1><a class="btn" href={`/documents/${data.doc.id}/download`}>Download</a>{#if /^(image|application\/pdf)/.test(data.doc.mime)}<a class="btn" href={`/documents/${data.doc.id}/download?inline=1`} target="_blank" rel="noopener">Open</a>{/if}</header>
  <section class="meta"><dl>
    <dt>Type</dt><dd>{data.doc.mime}</dd><dt>Size</dt><dd>{size(data.doc.size)}</dd><dt>Uploaded</dt><dd>{new Date(data.doc.createdAt).toLocaleString()}</dd>
    <dt>Folder</dt><dd>{data.doc.folder || '—'}</dd><dt>Category</dt><dd>{data.doc.category || '—'}</dd>
    <dt>Source</dt><dd>{data.doc.sourceType === 'email' ? 'Email attachment' : 'Upload'}</dd>
    <dt>Text</dt><dd>{data.doc.extractionStatus === 'done' ? `Searchable (${data.textLength.toLocaleString()} characters)` : data.doc.extractionStatus === 'pending' ? 'Indexing…' : data.doc.extractionError || data.doc.extractionStatus}
      {#if data.doc.extractionStatus === 'failed' || data.doc.extractionStatus === 'pending'}<form method="POST" action="?/retry" use:enhance class="inline"><button class="btn sm">Retry</button></form>{/if}</dd>
    <dt>SHA-256</dt><dd class="mono">{data.doc.checksum.slice(0, 16)}…</dd>
  </dl></section>

  <section><h2>Ask about this document</h2>
    {#if !data.aiEnabled}<p class="muted">AI is off. <a href="/settings/ai">Settings → AI</a></p>
    {:else if data.doc.extractionStatus !== 'done'}<p class="muted">Available once the document's text has been extracted.</p>
    {:else}
    <div class="quick">{#each QUICK as q (q)}<form method="POST" action="?/ask" use:enhance={() => { asking = true; return async ({ update }) => { await update({ reset: false }); asking = false; }; }}><input type="hidden" name="question" value={q}><button class="chip" disabled={asking}>{q}</button></form>{/each}</div>
    <form method="POST" action="?/ask" class="ask" use:enhance={() => { asking = true; return async ({ update }) => { await update({ reset: false }); asking = false; }; }}>
      <input name="question" placeholder="Ask a question about this document…" maxlength="1000" value={form && 'question' in form ? form.question : ''} aria-label="Question">
      {#if data.others.length}<select name="compare" aria-label="Compare with"><option value="">Only this document</option>{#each data.others as o (o.id)}<option value={o.id}>Compare with {o.filename}</option>{/each}</select>{/if}
      <button class="btn primary" disabled={asking}>{asking ? 'Thinking…' : 'Ask'}</button>
    </form>
    {#if form && 'error' in form && form.error}<p class="err">{form.error}</p>{/if}
    {#if answer}<div class="answer"><div>{@html rendered}</div><ul>{#each answer.sources as s (s.id)}<li><a href={s.href}><b>{s.id}</b> {s.title}</a></li>{/each}</ul><small>AI suggestion · {[answer.provider, answer.model].filter(Boolean).join(' · ')} · check important terms in the original</small></div>{/if}
    {/if}
  </section>

  {#if data.preview}<section><h2>Extracted text</h2><pre>{data.preview}{data.textLength > data.preview.length ? '\n…' : ''}</pre></section>{/if}
</main>
</AppShell>
<style>
  main{max-width:900px}.back a{color:#3157de;text-decoration:none;font-size:12px;font-weight:700}header{display:flex;gap:8px;align-items:center;margin-bottom:12px}h1{margin:0;font-size:20px;flex:1;min-width:0;word-break:break-word}h2{margin:0 0 10px;font-size:14px}
  .btn{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:7px 12px;color:#43516c;font-weight:700;cursor:pointer;font-size:13px;text-decoration:none}.btn.primary{background:#3157de;border-color:#3157de;color:#fff}.btn.sm{padding:3px 8px;font-size:11px}.btn:disabled{opacity:.6}
  section{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:14px 16px;margin-bottom:12px}dl{display:grid;grid-template-columns:110px 1fr;gap:6px 12px;margin:0;font-size:13px}dt{color:#8a95a8;font-weight:700;font-size:12px}dd{margin:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mono{font-family:ui-monospace,monospace;font-size:12px}.inline{margin:0}
  .quick{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.quick form{margin:0}.chip{border:1px solid #e4e9f2;background:#f7f8fb;border-radius:99px;padding:5px 11px;font-size:12px;color:#43516c;cursor:pointer}.chip:hover{border-color:#8da2f0}
  .ask{display:flex;gap:6px;flex-wrap:wrap}.ask input,.ask select{border:1px solid #e4e9f2;border-radius:9px;padding:8px;font-size:13px;min-width:0}.ask input{flex:1;min-width:200px}
  .answer{margin-top:12px;border-top:1px solid #eef0f5;padding-top:10px;font-size:14px;line-height:1.5}.answer :global(.cite){background:#eef1ff;color:#3157de;border-radius:5px;padding:0 5px;font-size:11px;font-weight:800;text-decoration:none}.answer ul{list-style:none;padding:0;margin:8px 0;font-size:12px}.answer a{color:#53607a;text-decoration:none}.answer b{color:#3157de;font-size:10px}.answer small{color:#8a95a8;font-size:11px}
  pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;color:#43516c;max-height:420px;overflow:auto;margin:0}.muted{color:#8a95a8;font-size:13px;margin:0}.muted a{color:#3157de}.err{color:#a5414d;font-size:13px}
</style>
