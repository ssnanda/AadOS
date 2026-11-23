<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import EmailAI from './EmailAI.svelte';
  import MailTools from './MailTools.svelte';
  import RelatedPanel from './RelatedPanel.svelte';
  import AsanaFromEmail from './asana/AsanaFromEmail.svelte';
  // Read-only viewer: the body is fetched on demand and rendered in a sandboxed iframe.
  // Primary Delete/Unread actions advance through preview; their hover/focus alternatives act and close.
  let { item, onclose, onprevious, onnext, ondelete, ondeleteclose, canPrevious = false, canNext = false, ai = false, aiBlocked = '', embedded = false, unread = false, onmarkread, onmarkunread, onkeepunread, onchanged, accountId = '', onopen }: { item: { pipelineId: string; messageId: string; subject: string; sender: string; receivedAt: string; key?: string }; onclose: () => void; onprevious?: () => void; onnext?: () => void; ondelete?: () => void; ondeleteclose?: () => void; canPrevious?: boolean; canNext?: boolean; ai?: boolean; aiBlocked?: string; embedded?: boolean; unread?: boolean; onmarkread?: () => void; onmarkunread?: () => void; onkeepunread?: () => void; onchanged?: () => void; accountId?: string; onopen?: (item: any) => void } = $props();
  let moreOpen = $state(false);
  let asanaOpen = $state(false), asanaNote = $state(''), asanaPrefill = $state<{ title: string; due: string }>({ title: '', due: '' });
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
  // Attachments: listed under the body (like Zoho/Gmail); PDFs and images preview in an overlay, everything downloads.
  type Att = { id: string; name: string; size: number; mime: string };
  let atts = $state<Att[]>([]);
  let preview = $state<Att | null>(null);
  let saved = $state<Record<string, string>>({});
  async function saveDoc(a: Att) {
    saved = { ...saved, [a.id]: 'Saving…' };
    const r = await fetch('/emails/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: item.key, op: 'saveAttachment', attachmentId: a.id, filename: a.name }) }).then((x) => x.json().then((b) => (x.ok ? b : { error: b.error || `HTTP ${x.status}` }))).catch(() => ({ error: 'Failed.' }));
    saved = { ...saved, [a.id]: r.error ? r.error : r.duplicate ? 'Already in Documents' : 'Saved to Documents' };
  }
  $effect(() => {
    const k = item.key; atts = []; preview = null; saved = {};
    if (!k) return;
    fetch(`/emails/attachment?key=${encodeURIComponent(k)}`).then((r) => (r.ok ? r.json() : { attachments: [] })).then((r) => { if (k === item.key) atts = r.attachments || []; }).catch(() => {});
  });
  const attUrl = (a: Att, dl = false) => `/emails/attachment?key=${encodeURIComponent(item.key || '')}&id=${encodeURIComponent(a.id)}&name=${encodeURIComponent(a.name)}${dl ? '&dl=1' : ''}`;
  const ext = (a: Att) => (a.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toLowerCase();
  const kindOf = (a: Att) => (/pdf/.test(a.mime) || ext(a) === 'pdf' ? 'pdf' : /^image\/(png|jpe?g)/.test(a.mime) || /^(png|jpe?g)$/.test(ext(a)) ? 'image' : '');
  const size = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
  async function close() { onclose(); await invalidateAll(); }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'ArrowUp' && canPrevious) { event.preventDefault(); onprevious?.(); }
    if (event.key === 'ArrowDown' && canNext) { event.preventDefault(); onnext?.(); }
    if (event.key === 'Escape') { event.preventDefault(); if (preview) preview = null; else close(); }
  }
  // Find: wrap matches (outside of tags) in <mark>. The frame stays script-free.
  const mark = (html: string, t: string) => { if (t.trim().length < 2) return html; const re = new RegExp(t.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); return html.replace(/(^|>)([^<]+)/g, (_m: string, a: string, txt: string) => a + txt.replace(re, (x) => `<mark style="background:#ffe066">${x}</mark>`)); };
  const doc = (b: { html: string; text: string }, allowImages: boolean) =>
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${allowImages ? 'https:' : ''}; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;color:#29344c;word-break:break-word}img{max-width:100%;height:auto}</style>${mark(b.html || `<pre style="white-space:pre-wrap;font:inherit">${esc(b.text)}</pre>`, findTerm)}`;
</script>
{#snippet title()}<button type="button" class="close" onclick={close} title="Close (Esc)">{embedded ? '✕' : '← Back'}</button><div class="ttl"><h3>{item.subject || '(no subject)'}</h3><p>{item.sender} · {new Date(item.receivedAt).toLocaleString()}</p></div>{/snippet}
{#snippet lead()}{#if ondelete}<div class="action-pair delete-pair"><button type="button" class="delete" onclick={ondelete} title="Delete and preview the next email">🗑 Delete</button>{#if ondeleteclose}<button type="button" class="close-action delete" onclick={ondeleteclose} title="Delete and close preview">Delete &amp; close</button>{/if}</div>{/if}{#if unread && onmarkread}<button type="button" onclick={onmarkread} title="Mark read in the mailbox">✉ Mark read</button>{:else if onkeepunread}<div class="action-pair"><button type="button" onclick={onkeepunread} title="Mark unread and preview the next email">✉ Unread</button>{#if onmarkunread}<button type="button" class="close-action" onclick={onmarkunread} title="Mark unread and close preview">Unread &amp; close</button>{/if}</div>{/if}{#if item.key}<button type="button" class="asana" onclick={() => { asanaPrefill = { title: '', due: '' }; asanaOpen = true; }} title="Create an Asana follow-up task from this email (AI drafts it), then mark the email read">→ Asana</button>{/if}{/snippet}
{#snippet trail()}<nav aria-label="Email navigation"><button type="button" onclick={onprevious} disabled={!canPrevious} title="Previous email (↑)">↑</button><button type="button" onclick={onnext} disabled={!canNext} title="Next email (↓)">↓</button></nav>{/snippet}
<svelte:window onkeydown={keyboard} />
<aside class="viewer" class:embedded aria-label="Email">
  {#if item.key}<MailTools item={{ ...item, key: item.key }} {accountId} aiAvailable={ai && !aiBlocked} {aiBlocked} onfind={(t) => (findTerm = t)} header={title} {lead} {trail} {moreOpen} onmore={() => (moreOpen = !moreOpen)} />
  {:else}<header>{@render title()}<div class="bar">{@render lead()}{@render trail()}</div></header>{/if}
  {#if asanaNote}<div class="asanaNote">{asanaNote} <button type="button" class="link" onclick={() => (asanaNote = '')}>✕</button></div>{/if}
  {#if asanaOpen && item.key}<AsanaFromEmail emailKey={item.key} subject={item.subject} title={asanaPrefill.title} due={asanaPrefill.due} onclose={() => (asanaOpen = false)} oncreated={(note) => { asanaNote = note; onchanged?.(); }} />{/if}
  {#if ai && item.key}<EmailAI messageKey={item.key} subject={item.subject} onasana={(title, due) => { asanaPrefill = { title, due }; asanaOpen = true; }} />{/if}
  <div class="content">
    <div class="body">
      {#if loading}<div class="msg">Loading…</div>
      {:else if loadError}<div class="msg err">{loadError}</div>
      {:else if body}<iframe title="Email body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc={doc(body, images)}></iframe>{/if}
      {#if atts.length}
        <section class="atts" aria-label="Attachments">
          <h4>{atts.length} Attachment{atts.length === 1 ? '' : 's'}</h4>
          <ul>{#each atts as a (a.id)}<li class="att">
            <button type="button" class="open" onclick={() => (kindOf(a) ? (preview = a) : window.open(attUrl(a, true), '_self'))} title={kindOf(a) ? 'Preview' : 'Download'}>
              <span class="ico {kindOf(a) || 'file'}">{(ext(a) || 'file').toUpperCase()}</span>
              <span class="meta"><span class="nm">{a.name}</span><span class="sz">{size(a.size)}</span></span>
            </button>
            <span class="acts">{#if kindOf(a)}<button type="button" onclick={() => (preview = a)}>Preview</button>{/if}<a href={attUrl(a, true)} download={a.name}>Download</a>{#if saved[a.id]}<span class="saved">{saved[a.id]}</span>{:else}<button type="button" onclick={() => saveDoc(a)} title="Import into AadOS Documents">Save to Documents</button>{/if}</span>
          </li>{/each}</ul>
        </section>
      {/if}
    </div>
    {#if moreOpen && item.key}<RelatedPanel item={{ ...item, key: item.key }} activeKey={item.key} {onopen} {onchanged} onclose={() => (moreOpen = false)} />{/if}
  </div>
  {#if preview}
    <div class="pv" role="dialog" aria-modal="true" aria-label={`Preview ${preview.name}`}>
      <div class="pvbar"><strong>{preview.name}</strong><a href={attUrl(preview)} target="_blank" rel="noopener">Open in new tab</a><a href={attUrl(preview, true)} download={preview.name}>Download</a><button type="button" onclick={() => (preview = null)} title="Close (Esc)">✕</button></div>
      {#if kindOf(preview) === 'image'}<div class="pvimg"><img src={attUrl(preview)} alt={preview.name} /></div>
      {:else}<iframe title={preview.name} src={attUrl(preview)}></iframe>{/if}
    </div>
  {/if}
</aside>
<style>
  .viewer{position:fixed;inset:0;background:#fff;z-index:41;display:flex;flex-direction:column}
  /* Preview pane next to the list (desktop); full screen on small screens. */
  .viewer.embedded{position:sticky;top:12px;inset:auto;z-index:1;height:calc(100vh - 110px);border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}
  @media(max-width:900px){.viewer.embedded{position:fixed;inset:0;top:0;height:auto;border:0;border-radius:0;z-index:41}}
  header{display:flex;gap:10px;align-items:flex-start;padding:14px 18px;border-bottom:1px solid #e4e9f2}.bar{display:flex;gap:5px;flex-wrap:wrap;margin-left:auto}
  .ttl{flex:1;min-width:180px}h3{margin:0;font-size:16px}.ttl p{margin:3px 0 0;font-size:12px;color:#8792a6}
  nav{display:flex;gap:4px}button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button:hover{border-color:#8da2f0;color:#3157de}button:disabled{opacity:.4;cursor:default}.delete{color:#b53c50}.close{color:#3157de}.asana{background:#fdeeee;border-color:#f5c9cb;color:#d2474c}.link{border:0;background:none;padding:0;color:#3157de}.asanaNote{background:#e9f7ef;color:#1e7a47;font-size:12px;font-weight:600;padding:6px 18px;border-bottom:1px solid #d3eedd}
  .action-pair{display:flex}.action-pair>button:first-child{border-radius:7px}.close-action{max-width:0;opacity:0;overflow:hidden;white-space:nowrap;padding-left:0;padding-right:0;border-width:1px 0;pointer-events:none;transition:max-width .15s,opacity .15s,padding .15s}.action-pair:hover>button:first-child,.action-pair:focus-within>button:first-child{border-radius:7px 0 0 7px}.action-pair:hover .close-action,.action-pair:focus-within .close-action{max-width:120px;opacity:1;padding-left:10px;padding-right:10px;border-width:1px;border-left:0;border-radius:0 7px 7px 0;pointer-events:auto}
  .content{flex:1;display:flex;min-height:0}.body{flex:1;display:flex;flex-direction:column;min-width:0}
  @media(max-width:900px){.content{flex-direction:column}.content :global(.related){width:auto;max-height:45%;border-left:0;border-top:1px solid #e4e9f2}}
  iframe{flex:1;border:0;width:100%;background:#fff}
  .atts{border-top:1px solid #e4e9f2;padding:8px 18px 10px;max-height:40%;overflow:auto}.atts h4{margin:0 0 6px;font-size:12px;color:#29344c}
  .atts ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}.att{display:flex;align-items:center;gap:6px;background:#f3f5f9;border-radius:8px;padding:4px 8px 4px 4px;max-width:100%}
  .att .open{display:flex;align-items:center;gap:8px;border:0;background:none;padding:0;min-width:0;text-align:left}.ico{flex:none;width:38px;height:38px;border-radius:6px;display:grid;place-items:center;font-size:9px;font-weight:800;color:#fff;background:#8792a6}.ico.pdf{background:#de7b5e}.ico.image{background:#5b8def}
  .meta{display:flex;flex-direction:column;min-width:0}.nm{font-size:12px;font-weight:600;color:#29344c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}.sz{font-size:11px;font-weight:400;color:#8792a6}
  .acts{display:flex;gap:4px}.acts a{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:700;color:#43516c;text-decoration:none}.acts a:hover{border-color:#8da2f0;color:#3157de}.acts{align-items:center}.saved{font-size:11px;color:#1e7a47;font-weight:600}
  .pv{position:absolute;inset:0;z-index:5;background:#fff;display:flex;flex-direction:column}.pvbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e4e9f2;font-size:12px}.pvbar strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pvbar a{color:#3157de;font-weight:700;text-decoration:none}
  .pvimg{flex:1;overflow:auto;display:grid;place-items:center;background:#f3f5f9}.pvimg img{max-width:100%;height:auto}.msg{padding:30px;color:#8792a6}.msg.err{color:#a5414d}
</style>
