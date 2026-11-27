<script lang="ts">
  // Reader tools for one email. Nothing is sent unless the owner presses Send in the compose form.
  // The viewer puts its title (`header`) and its own buttons (`lead` first, `trail` last) in the same row.
  import type { Snippet } from 'svelte';
  type Item = { key: string; pipelineId: string; messageId: string; subject: string; sender: string; receivedAt: string; unread?: boolean };
  // `footer`: an element below the email body where the same button row is mounted again (shared state).
  let { item, accountId = '', aiAvailable = false, aiBlocked = '', onfind, header, lead, trail, footer = null, moreOpen = false, onmore }: { item: Item; accountId?: string; aiAvailable?: boolean; aiBlocked?: string; onfind?: (term: string) => void; header?: Snippet; lead?: Snippet; trail?: Snippet; footer?: HTMLElement | null; moreOpen?: boolean; onmore?: () => void } = $props();
  // Moves the node into `target`, keeping it reactive and owned by this component.
  function portal(node: HTMLElement, target: HTMLElement) {
    target.appendChild(node);
    return { update(t: HTMLElement) { t.appendChild(node); }, destroy() { node.remove(); } };
  }

  type Details = { from: string; to: string; cc: string; account: string; provider: string; unsubscribe: { url: string; mailto: string }; canSend: boolean; canFilter: boolean };
  let info = $state<Details | null>(null);
  let error = $state('');
  let note = $state('');
  let menu = $state<'' | 'top' | 'bottom'>(''); // which Reply dropdown is open
  let busy = $state('');
  let compose = $state<{ mode: 'reply' | 'replyAll' | 'forward'; from: string; to: string; cc: string; bcc: string; subject: string; text: string; quoted: string; showQuoted: boolean; showBcc: boolean; attachments: boolean; provider: string; residential: boolean; templateTitle: string } | null>(null);
  let findOpen = $state(false);
  let term = $state('');
  let rulesOpen = $state(false);
  let rulesData = $state<{ filters: { id: string; criteria: Record<string, string>; action: { addLabelIds?: string[]; removeLabelIds?: string[] } }[]; labels: { id: string; name: string }[] } | null>(null);
  let rule = $state({ field: 'from' as 'from' | 'subject', text: '', labelId: '', markRead: false, archive: false });

  async function call(op: string, payload: Record<string, unknown> = {}, path = '/emails/tools') {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, key: item.key, ...payload }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }
  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    busy = label; error = '';
    try { return await fn(); } catch (e) { error = e instanceof Error ? e.message : 'Failed.'; return null; } finally { busy = ''; }
  }
  $effect(() => {
    const k = item.key;
    info = null; compose = null; rulesOpen = false; note = ''; error = ''; term = ''; findOpen = false; onfind?.('');
    call('details').then((d) => { if (k === item.key) info = d; }).catch(() => undefined);
  });
  const copy = async (text: string, label: string) => { await navigator.clipboard.writeText(text); note = `${label} copied.`; setTimeout(() => (note = ''), 1500); };

  async function startCompose(mode: 'reply' | 'replyAll' | 'forward', withAi = false) {
    menu = '';
    const p = await run('compose', () => call('prepare', { mode }));
    if (!p) return;
    compose = { mode, from: p.from, to: p.to, cc: p.cc, bcc: '', subject: p.subject, text: '', quoted: p.quoted, showQuoted: false, showBcc: false, attachments: mode === 'forward', provider: p.provider, residential: false, templateTitle: '' };
    if (withAi) await aiDraft();
  }
  async function startResidential() {
    menu = '';
    const p = await run('compose', () => call('prepareResidential'));
    if (!p) return;
    compose = { mode: 'reply', from: p.from, to: p.to, cc: p.cc, bcc: '', subject: p.subject, text: p.template, quoted: p.quoted, showQuoted: false, showBcc: false, attachments: false, provider: p.provider, residential: true, templateTitle: p.templateTitle };
  }
  async function aiDraft() {
    if (!compose) return;
    // Text already typed = the owner's draft/notes: polish it instead of replacing it.
    const mine = compose.text.trim();
    const r = await run('ai', () => call('draft', mine ? { tone: 'polish', current: mine } : { tone: 'reply' }, '/emails/ai'));
    if (r && compose) compose.text = r.draft.content;
  }
  async function sendNow() {
    if (!compose) return;
    const c = compose;
    const r = await run('send', () => call('send', { mode: c.mode, to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject, text: `${c.text}${c.quoted}`, attachments: c.attachments, residential: c.residential }));
    if (r) { compose = null; note = r.note ? `Sent. ${r.note}` : 'Sent.'; }
  }
  async function openRules() {
    rulesOpen = !rulesOpen; menu = '';
    if (!rulesOpen) return;
    rule = { field: 'from', text: (info?.from.match(/[\w.+'-]+@[\w.-]+/) || [''])[0], labelId: '', markRead: false, archive: false };
    rulesData = await run('rules', () => call('rules', { accountId }));
  }
  async function addRule() {
    if (await run('rule', () => call('createRule', { accountId, ...rule }))) { note = 'Gmail filter created (applies to new mail).'; rulesData = await run('rules', () => call('rules', { accountId })); }
  }
  async function deleteRule(id: string) {
    if (!confirm('Delete this Gmail filter?')) return;
    if (await run('rule', () => call('deleteRule', { accountId, id }))) rulesData = await run('rules', () => call('rules', { accountId }));
  }
  // Settings → Rules, prefilled with this sender's address and account.
  const rulesHref = () => `/settings/rules?from=${encodeURIComponent((info?.from.match(/[\w.+'-]+@[\w.-]+/) || [''])[0])}&subject=${encodeURIComponent(item.subject.replace(/^(re|fwd?):\s*/i, '').split(':')[0].slice(0, 60))}&account=${encodeURIComponent(accountId || item.key.slice(0, item.key.indexOf(':')))}`;
  const labelName = (id: string) => rulesData?.labels.find((l) => l.id === id)?.name || id;
  const describe = (f: { criteria?: Record<string, string>; action?: { addLabelIds?: string[]; removeLabelIds?: string[] } }) =>
    `${Object.entries(f.criteria || {}).map(([k, v]) => `${k}: ${v}`).join(', ')} → ${[...(f.action?.addLabelIds || []).map((l) => `label ${labelName(l)}`), ...(f.action?.removeLabelIds?.includes('UNREAD') ? ['mark read'] : []), ...(f.action?.removeLabelIds?.includes('INBOX') ? ['skip inbox'] : [])].join(', ') || 'no action'}`;
</script>

{#snippet buttons(where: 'top' | 'bottom')}
    {@render lead?.()}
    <div class="menuwrap">
      <button onclick={() => (menu = menu === where ? '' : where)} aria-haspopup="menu" aria-expanded={menu === where}>↩ Reply ▾</button>
      {#if menu === where}<div class="menu" role="menu">
        <button role="menuitem" onclick={() => startCompose('reply')}>Reply</button>
        <button role="menuitem" onclick={() => startCompose('replyAll')}>Reply All</button>
        <button role="menuitem" onclick={() => startCompose('forward')}>Forward</button>
        {#if info?.provider === 'zoho' && info.account.toLowerCase().endsWith('@intlord.com')}<hr><button role="menuitem" onclick={startResidential}>Reply with Residential Template</button>{/if}
        <hr><button role="menuitem" disabled={!aiAvailable} title={aiBlocked} onclick={() => startCompose('reply', true)}>✦ Reply using AI</button><button role="menuitem" disabled={!aiAvailable} title={aiBlocked} onclick={() => startCompose('replyAll', true)}>✦ Reply All using AI</button>
        {#if !aiAvailable && aiBlocked}<a class="aihint" href="/settings/ai">{aiBlocked}</a>{/if}
      </div>{/if}
    </div>
    {#if info?.provider === 'gmail'}<button onclick={openRules} class:on={rulesOpen}>☰ Rules</button>{:else if info}<a class="btnlink" href={rulesHref()} title="Create an AadOS rule for this sender (Settings → Rules)">☰ Rules</a>{/if}
    <button onclick={() => { findOpen = !findOpen; if (!findOpen) { term = ''; onfind?.(''); } }} class:on={findOpen}>⌕ Find</button>
    {#if onmore}<button onclick={onmore} class:on={moreOpen}>More from sender</button>{/if}
    {#if busy}<span class="busy">{busy === 'send' ? 'Sending…' : 'Working…'}</span>{/if}
    {#if note}<span class="ok">{note}</span>{/if}
    {@render trail?.()}
{/snippet}

<section class="tools">
  <div class="top">{@render header?.()}
  <div class="bar">{@render buttons('top')}</div>
  </div>
  {#if footer}<div class="bar foot" use:portal={footer}>{@render buttons('bottom')}</div>{/if}
  {#if info}
    <div class="who">
      <span><b>From:</b> {info.from}<button class="cp" title="Copy" onclick={() => copy(info!.from, 'From')}>⧉</button></span>
      {#if info.to}<span><b>To:</b> {info.to}<button class="cp" title="Copy" onclick={() => copy(info!.to, 'To')}>⧉</button></span>{/if}
      {#if info.cc}<span><b>Cc:</b> {info.cc}</span>{/if}
      {#if info.unsubscribe.url}<a class="unsub" href={info.unsubscribe.url} target="_blank" rel="noopener noreferrer">✉ Unsubscribe from this sender</a>{:else if info.unsubscribe.mailto}<a class="unsub" href={info.unsubscribe.mailto}>✉ Unsubscribe (email)</a>{/if}
    </div>
  {/if}
  {#if error}<p class="err">{error}{#if /Allow changes/.test(error)} <a href="/settings/emails">Open Settings</a>{/if}</p>{/if}

  {#if findOpen}<div class="find"><input bind:value={term} placeholder="Find in this email" aria-label="Find in this email" oninput={() => onfind?.(term)}></div>{/if}

  {#if compose}
    <form class="compose" onsubmit={(e) => { e.preventDefault(); sendNow(); }}>
      <div class="row"><label>From</label><strong>{compose.from}</strong>{#if compose.residential}<small>{compose.templateTitle}</small>{/if}</div>
      <div class="row"><label for="c-to">To</label><input id="c-to" bind:value={compose.to} placeholder="name@example.com, …">{#if !compose.showBcc}<button type="button" class="link" onclick={() => compose && (compose.showBcc = true)}>Bcc</button>{/if}</div>
      <div class="row"><label for="c-cc">Cc</label><input id="c-cc" bind:value={compose.cc}></div>
      {#if compose.showBcc}<div class="row"><label for="c-bcc">Bcc</label><input id="c-bcc" bind:value={compose.bcc}></div>{/if}
      <div class="row"><label for="c-subj">Subject</label><input id="c-subj" bind:value={compose.subject}></div>
      <textarea bind:value={compose.text} rows="7" placeholder="Write your message…" aria-label="Message"></textarea>
      <button type="button" class="link" onclick={() => compose && (compose.showQuoted = !compose.showQuoted)}>{compose.showQuoted ? 'Hide' : 'Show'} {compose.mode === 'forward' ? 'forwarded message' : 'quoted text'}</button>
      {#if compose.showQuoted}<pre class="quoted">{compose.quoted.trim()}</pre>{/if}
      <div class="actions">
        <button class="send" disabled={busy === 'send'}>Send</button>
        {#if aiAvailable}<button type="button" onclick={aiDraft} disabled={!!busy}>✦ {compose.text.trim() ? 'Polish with AI' : 'Draft with AI'}</button>{/if}
        {#if compose.mode === 'forward'}<label class="chk"><input type="checkbox" bind:checked={compose.attachments}> Include attachments{compose.provider === 'zoho' ? ' (Gmail only)' : ''}</label>{/if}
        <span class="sp"></span><button type="button" onclick={() => (compose = null)}>Discard</button>
      </div>
    </form>
  {/if}

  {#if rulesOpen}
    <div class="panel">
      <h4>Rules <small>Gmail filters for {info?.account} — applied by Gmail to new mail</small><a class="all" href={rulesHref()}>All rules →</a></h4>
      <form class="rule" onsubmit={(e) => { e.preventDefault(); addRule(); }}>
        <select bind:value={rule.field} aria-label="Match"><option value="from">From</option><option value="subject">Subject</option></select>
        <input bind:value={rule.text} placeholder="contains…" aria-label="Match text">
        <select bind:value={rule.labelId} aria-label="Label"><option value="">No label</option>{#each rulesData?.labels || [] as l (l.id)}<option value={l.id}>Label: {l.name}</option>{/each}</select>
        <label class="chk"><input type="checkbox" bind:checked={rule.markRead}> Mark read</label>
        <label class="chk"><input type="checkbox" bind:checked={rule.archive}> Skip inbox</label>
        <button disabled={!!busy}>Create</button>
      </form>
      {#if rulesData}<ul>{#each rulesData.filters as f (f.id)}<li><span>{describe(f)}</span><button class="link x" onclick={() => deleteRule(f.id)}>Delete</button></li>{:else}<li class="muted">No Gmail filters yet.</li>{/each}</ul>{/if}
    </div>
  {/if}

</section>

<style>
  .tools{border-bottom:1px solid #e4e9f2;padding:8px 18px;font-size:12px;background:#fff}
  .who{display:flex;gap:14px;flex-wrap:wrap;align-items:center;color:#53607a}.who b{color:#8a95a8;font-weight:700}.cp{border:0;background:none;color:#8a95a8;cursor:pointer;padding:0 0 0 4px;font-size:12px}.cp:hover{color:#3157de}
  .unsub{color:#3157de;font-weight:700;text-decoration:none}
  .top{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 10px;align-items:start;margin-bottom:6px}.bar{grid-column:1/-1;display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding-top:6px;border-top:1px solid #eef0f5}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;color:#43516c;cursor:pointer}button:hover{border-color:#8da2f0;color:#3157de}button:disabled{opacity:.5;cursor:default}button.on{background:#eef1ff;border-color:#8da2f0;color:#3157de}
  .menuwrap{position:relative}.menu{position:absolute;top:28px;left:0;z-index:5;background:#fff;border:1px solid #e4e9f2;border-radius:10px;box-shadow:0 8px 24px #151c2d22;padding:5px;display:grid;min-width:170px}.menu button{border:0;text-align:left;padding:7px 10px;font-size:12px;border-radius:6px}.menu button:hover{background:#f4f6fb}.menu hr{border:0;border-top:1px solid #eef0f5;margin:4px 0}.foot{grid-column:auto;flex:1;border-top:0;padding-top:0}.foot .menu{top:auto;bottom:28px}.menu button:disabled{color:#a3adbf;cursor:not-allowed;background:none}.aihint{font-size:11px;color:#3157de;padding:2px 10px 6px;text-decoration:none;max-width:220px}
  .busy{color:#8a95a8}.ok{color:#0f7f74}.err{color:#a5414d;margin:6px 0 0}.err a{color:#a5414d;font-weight:700}.muted{color:#8a95a8}
  .link{border:0;background:none;padding:0;color:#3157de}.btnlink{border:1px solid #d9dfeb;background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;color:#43516c;text-decoration:none}.btnlink:hover{border-color:#8da2f0;color:#3157de}.all{margin-left:auto;color:#3157de;font-weight:700;text-decoration:none}.x{color:#a5414d}
  .find{margin-top:6px}.find input{width:100%;box-sizing:border-box;border:1px solid #e4e9f2;border-radius:8px;padding:6px 9px;font-size:12px}
  .compose{margin-top:8px;border:1px solid #e4e9f2;border-radius:10px;padding:10px;display:grid;gap:6px;background:#fbfcff}
  .compose .row{display:grid;grid-template-columns:54px 1fr auto;gap:6px;align-items:center}.compose label{color:#8a95a8;font-weight:700}
  .compose input,.compose textarea{border:1px solid #e4e9f2;border-radius:7px;padding:6px 8px;font:inherit;font-size:13px;min-width:0}.compose textarea{resize:vertical}
  .quoted{white-space:pre-wrap;font:12px/1.45 system-ui,sans-serif;color:#6b7690;background:#fff;border:1px solid #eef0f5;border-radius:7px;padding:8px;max-height:220px;overflow:auto;margin:0}
  .actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.send{background:#3157de;border-color:#3157de;color:#fff}.send:hover{color:#fff}.sp{flex:1}.chk{display:inline-flex;gap:4px;align-items:center;color:#53607a;font-weight:600}
  .panel{margin-top:8px;border:1px solid #e4e9f2;border-radius:10px;padding:9px 11px;max-height:260px;overflow:auto}.panel h4{margin:0 0 6px;font-size:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.panel h4 small{font-weight:400;color:#8a95a8}
  .rule{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:6px}.rule input,.rule select{border:1px solid #e4e9f2;border-radius:6px;padding:4px 6px;font-size:12px}
  .panel ul{list-style:none;margin:0;padding:0;display:grid;gap:3px}.panel li{display:flex;gap:8px;justify-content:space-between;align-items:center}
</style>
