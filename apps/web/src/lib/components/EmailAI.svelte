<script lang="ts">
  // AI panel inside the read-only email viewer. Every result is labelled as an AI suggestion; nothing is ever sent.
  let { messageKey, subject }: { messageKey: string; subject: string } = $props();
  type Insight = { summary: string; category: string; importance: string; needsReply: boolean; deadline: string | null; paymentDue: string | null; amount: string | null; renewalDate: string | null; appointment: string | null; suggestedTask: string | null; nextAction: string; confidence: number; reason: string };
  type Draft = { id: number; content: string; tone: string; aiGenerated: boolean; edited: boolean; updatedAt: string };
  let insight = $state<{ status: string; insight: Insight | null; error: string; provider: string; model: string; reviewedAt: string } | null>(null);
  let drafts = $state<Draft[]>([]);
  let output = $state<{ title: string; text: string; meta: string } | null>(null);
  let busy = $state('');
  let error = $state('');
  let note = $state('');
  let draftText = $state('');
  let draftId = $state<number | undefined>(undefined);
  let draftAi = $state(false);
  let atts = $state<{ id: string; name: string; size: number }[] | null>(null);
  let controller: AbortController | null = null;
  const CATS = ['Important', 'Personal', 'Family', 'Bills', 'Payments', 'Receipts', 'Shopping', 'Orders and Deliveries', 'Subscriptions', 'Renewals', 'Appointments', 'Travel', 'Newsletters', 'Promotions', 'Notifications', 'Needs Reply', 'Informational', 'Other'];

  async function api(payload: Record<string, unknown>, label = '') {
    busy = label || String(payload.op); error = ''; note = '';
    controller = new AbortController();
    try {
      const res = await fetch('/emails/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: messageKey, ...payload }), signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    } catch (e) { error = e instanceof Error && e.name === 'AbortError' ? 'Cancelled.' : e instanceof Error ? e.message : 'Failed.'; return null; }
    finally { busy = ''; controller = null; }
  }
  $effect(() => { const k = messageKey; output = null; atts = null; draftText = ''; draftId = undefined; void (async () => { const s = await api({ op: 'state' }, 'loading'); if (s && k === messageKey) { insight = s.insight; drafts = s.drafts; } })(); });
  const meta = (r: { provider?: string; model?: string; usedBody?: boolean }) => ['AI suggestion', [r.provider, r.model].filter(Boolean).join(' · '), r.usedBody === false ? 'from subject/preview only' : ''].filter(Boolean).join(' · ');
  async function askAi(op: 'summarize' | 'explain' | 'followup', title: string) { const r = await api({ op }); if (r) output = { title, text: r.text, meta: meta(r) }; }
  async function classifyNow() { const r = await api({ op: 'classify' }); if (r) insight = { status: 'done', insight: r.insight, error: '', provider: '', model: '', reviewedAt: insight?.reviewedAt || '' }; }
  async function genDraft(tone: string) {
    const r = await api({ op: 'draft', tone, current: draftText, draftId }, `draft-${tone}`);
    if (r) { draftText = r.draft.content; draftId = r.draft.id; draftAi = true; const s = await api({ op: 'state' }, 'loading'); if (s) drafts = s.drafts; }
  }
  async function saveDraftNow() { const r = await api({ op: 'saveDraft', content: draftText, draftId, aiGenerated: draftAi }); if (r) { draftId = r.draft.id; note = 'Draft saved in AadOS (not sent).'; const s = await api({ op: 'state' }, 'loading'); if (s) drafts = s.drafts; } }
  async function copyDraft() { await navigator.clipboard.writeText(draftText); note = 'Copied. Paste it into Gmail or Zoho to send it yourself.'; }
  async function removeDraft(id: number) { if (!confirm('Delete this saved draft?')) return; if (await api({ op: 'deleteDraft', draftId: id })) { drafts = drafts.filter((d) => d.id !== id); if (draftId === id) { draftId = undefined; draftText = ''; } } }
  async function applyCategory(category: string) { if (await api({ op: 'category', category })) note = `Category set to ${category} (local only).`; }
  async function reviewed() { if (await api({ op: 'reviewed' })) note = 'Marked reviewed.'; }
  async function makeTask(title: string, due: string | null) { if (await api({ op: 'task', title, due: due || '' })) note = 'Task created.'; }
  async function loadAtts() { const r = await api({ op: 'attachments' }); if (r) atts = r.attachments; }
  async function saveAtt(a: { id: string; name: string }) { const r = await api({ op: 'saveAttachment', attachmentId: a.id, filename: a.name }, `att-${a.id}`); if (r) note = r.duplicate ? `${a.name} was already in Documents.` : `${a.name} saved to Documents.`; }
  const kb = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
  const conf = (c: number) => (c >= 0.8 ? 'high' : c >= 0.5 ? 'medium' : 'low');
</script>
<section class="ai" aria-label="AI tools">
  <details class="commands">
    <summary>✦ AI tools</summary>
    <div class="bar">
    <button onclick={() => askAi('summarize', 'Summary')} disabled={!!busy}>Summarize</button>
    <button onclick={() => askAi('explain', 'Why it matters')} disabled={!!busy}>Explain importance</button>
    <button onclick={() => askAi('followup', 'Suggested follow-up')} disabled={!!busy}>Suggest follow-up</button>
    <button onclick={classifyNow} disabled={!!busy}>{insight?.insight ? 'Re-analyse' : 'Analyse'}</button>
    <button onclick={() => genDraft('reply')} disabled={!!busy}>Generate reply</button>
    <button onclick={reviewed} disabled={!!busy}>Mark reviewed</button>
    <button onclick={loadAtts} disabled={!!busy}>Attachments</button>
    {#if busy && busy !== 'loading'}<span class="busy">Working…</span><button class="link" onclick={() => controller?.abort()}>Cancel</button>{/if}
    </div>
  </details>
  {#if error}<p class="err">{error}</p>{/if}
  {#if note}<p class="ok">{note}</p>{/if}

  {#if insight?.insight}{@const i = insight.insight}
    <div class="insight">
      <p><b>{i.summary}</b></p>
      <div class="tags"><span class="tag">{i.category}</span><span class="tag" class:hi={i.importance === 'high'}>{i.importance} importance</span>{#if i.needsReply}<span class="tag hi">reply suggested</span>{/if}<span class="tag conf {conf(i.confidence)}">{conf(i.confidence)} confidence</span>
        {#if i.paymentDue}<span class="tag">payment due {i.paymentDue}{i.amount ? ` · ${i.amount}` : ''}</span>{:else if i.amount}<span class="tag">{i.amount}</span>{/if}{#if i.deadline}<span class="tag">deadline {i.deadline}</span>{/if}{#if i.renewalDate}<span class="tag">renews {i.renewalDate}</span>{/if}{#if i.appointment}<span class="tag">appointment {i.appointment}</span>{/if}</div>
      {#if i.reason}<p class="why">Why: {i.reason}</p>{/if}
      {#if i.nextAction}<p class="why">Next: {i.nextAction}</p>{/if}
      <div class="acts">
        {#if i.suggestedTask}<button onclick={() => makeTask(i.suggestedTask!, i.deadline || i.paymentDue)} disabled={!!busy}>＋ Task: {i.suggestedTask}</button>{/if}
        <label>Reclassify <select onchange={(e) => applyCategory((e.currentTarget as HTMLSelectElement).value)} disabled={!!busy}><option value="">Choose…</option>{#each CATS as c (c)}<option value={c} selected={false}>{c}{c === i.category ? ' (AI)' : ''}</option>{/each}</select></label>
      </div>
      <small>AI inference from the email, not verified{insight.reviewedAt ? ' · reviewed' : ''}</small>
    </div>
  {:else if insight?.status === 'failed'}<p class="muted">Last analysis failed: {insight.error}</p>{/if}

  {#if output}<div class="out"><h4>{output.title}</h4><p>{output.text}</p><small>{output.meta}</small></div>{/if}

  {#if draftText || drafts.length}
    <div class="draft">
      <h4>Reply draft <small>AI-generated suggestion · never sent automatically</small></h4>
      <textarea bind:value={draftText} rows="8" aria-label="Reply draft" oninput={() => {}}></textarea>
      <div class="acts">
        <button onclick={() => genDraft('shorten')} disabled={!!busy || !draftText}>Shorten</button><button onclick={() => genDraft('formal')} disabled={!!busy || !draftText}>More formal</button><button onclick={() => genDraft('friendly')} disabled={!!busy || !draftText}>More friendly</button><button onclick={() => genDraft('regenerate')} disabled={!!busy}>Regenerate</button>
        <span class="sp"></span><button onclick={saveDraftNow} disabled={!!busy || !draftText.trim()}>Save draft</button><button onclick={copyDraft} disabled={!draftText}>Copy</button>
      </div>
      {#if drafts.length}<ul class="saved">{#each drafts as d (d.id)}<li><button class="link" onclick={() => { draftText = d.content; draftId = d.id; draftAi = d.aiGenerated; }}>{d.aiGenerated ? (d.edited ? 'AI draft, edited' : 'AI draft') : 'Your draft'} · {new Date(d.updatedAt).toLocaleString()}</button><button class="link x" onclick={() => removeDraft(d.id)} aria-label="Delete draft">✕</button></li>{/each}</ul>{/if}
    </div>
  {/if}

  {#if atts}<div class="out"><h4>Attachments</h4>{#if !atts.length}<p class="muted">No attachments.</p>{/if}<ul class="saved">{#each atts as a (a.id)}<li><span>{a.name} · {kb(a.size)}</span><button onclick={() => saveAtt(a)} disabled={!!busy}>Save to Documents</button></li>{/each}</ul></div>{/if}
</section>
<style>
  .ai{border-bottom:1px solid #e4e9f2;padding:10px 18px;background:#fbfcff;font-size:13px;max-height:48vh;overflow:auto}
  .commands summary{width:max-content;color:#7c4dde;font-size:12px;font-weight:800;cursor:pointer;list-style:none}.commands summary::-webkit-details-marker{display:none}.commands summary::after{content:' ▾';color:#8a95a8}.commands[open] summary::after{content:' ▴'}.bar{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:7px}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button:hover{border-color:#8da2f0;color:#3157de}button:disabled{opacity:.5;cursor:default}
  .link{border:0;background:none;padding:0;color:#3157de}.busy{font-size:11px;color:#8a95a8}.err{color:#a5414d;margin:6px 0 0}.ok{color:#0f7f74;margin:6px 0 0}.muted{color:#8a95a8;margin:6px 0 0}
  .insight,.out,.draft{margin-top:9px;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:9px 11px}.insight p,.out p{margin:0 0 5px;white-space:pre-wrap}.why{color:#53607a;font-size:12px}
  .tags{display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 6px}.tag{font-size:10px;font-weight:800;border-radius:6px;padding:2px 7px;background:#f0f2f7;color:#5b6a86}.tag.hi{background:#fff4df;color:#a1752a}.conf.low{background:#fff0f1;color:#a5414d}.conf.high{background:#e3f6f3;color:#0f7f74}
  .acts{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:6px}.acts select{font-size:11px;border:1px solid #d9dfeb;border-radius:6px;padding:2px}.acts label{font-size:11px;color:#53607a;display:flex;gap:4px;align-items:center}.sp{flex:1}
  small{color:#8a95a8;font-size:10px}h4{margin:0 0 6px;font-size:12px}h4 small{font-weight:400;margin-left:6px}
  textarea{width:100%;box-sizing:border-box;border:1px solid #e4e9f2;border-radius:8px;padding:8px;font:inherit;font-size:13px;resize:vertical}
  .saved{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:3px}.saved li{display:flex;gap:8px;align-items:center;justify-content:space-between;font-size:12px}.x{color:#a5414d}
</style>
