<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : 'never');
</script>
<svelte:head><title>AI · Settings · AadOS</title></svelte:head>
<main>
  <header><h1>AI</h1><span class="pill" class:ok={data.configured && data.ai.enabled}>{!data.configured ? 'Not configured' : data.ai.enabled ? 'On' : 'Off'}</span></header>
  {#if form && 'error' in form && form.error}<p class="bad">{form.error}</p>{/if}
  {#if form && 'message' in form && form.message}<p class="good">{form.message}</p>{/if}

  <section><h2>AJMCP gateway</h2>
    <form method="POST" action="?/gateway" class="cfg">
      <label>Gateway URL<input name="url" type="url" value={data.gateway.url} placeholder="https://ajmcp.example.com" disabled={data.gateway.urlFromEnv}>{#if data.gateway.urlFromEnv}<small>Set by environment (AADOS_AJMCP_URL)</small>{:else}<small>Use the server origin only, without <code>/admin</code>.</small>{/if}</label>
      <label>AadOS site token<input name="token" type="password" autocomplete="off" placeholder={data.gateway.hasToken ? 'Saved — leave blank to keep' : 'Paste the token of the AadOS site in AJMCP'} disabled={data.gateway.tokenFromEnv}>{#if data.gateway.tokenFromEnv}<small>Set by environment (AADOS_AJMCP_TOKEN)</small>{:else if data.gateway.hasToken}<small><label class="inline"><input type="checkbox" name="clearToken"> Remove saved token</label></small>{/if}</label>
      <div class="row"><button>Save</button><small>Use a dedicated AJMCP site for AadOS, never a website's token. The token is stored encrypted and never shown again.</small></div>
    </form>
    <dl>
      <dt>Provider / model</dt><dd>{[data.status.provider, data.status.model].filter(Boolean).join(' · ') || '—'}{data.status.gatewayVersion ? ` · AJMCP ${data.status.gatewayVersion}` : ''}</dd>
      <dt>Last success</dt><dd>{when(data.status.lastOk)}</dd>
      <dt>Last error</dt><dd class:err={data.status.lastError}>{data.status.lastError ? `${data.status.lastError} (${when(data.status.lastErrorAt)})` : '—'}</dd>
    </dl>
    <form method="POST" action="?/test"><button disabled={!data.configured}>Test connection</button></form>
  </section>

  <section><h2>Processing</h2>
    <form method="POST" action="?/save" class="opts">
      <label><input type="checkbox" name="enabled" checked={data.ai.enabled}> <b>Enable AI</b> <small>Assistant answers, summaries, drafts and briefings</small></label>
      <label><input type="checkbox" name="background" checked={data.ai.background}> Background email triage <small>Classifies new email (last 21 days) every few minutes; each message once</small></label>
      <label><input type="checkbox" name="emailBodies" checked={data.ai.emailBodies}> Send full email text for summaries and drafts <small>Off: subject, sender and preview only</small></label>
      <h3>Data the AI may see</h3>
      <div class="grid">
        <label><input type="checkbox" name="shareEmail" checked={data.ai.share.email}> Email</label>
        <label><input type="checkbox" name="shareCalendar" checked={data.ai.share.calendar}> Calendar</label>
        <label><input type="checkbox" name="shareTasks" checked={data.ai.share.tasks}> Tasks &amp; reminders</label>
        <label><input type="checkbox" name="shareDocuments" checked={data.ai.share.documents}> Documents</label>
        <label><input type="checkbox" name="shareFinance" checked={data.ai.share.finance}> Finance (net worth, holdings, real estate)</label>
      </div>
      <button>Save</button>
    </form>
  </section>

  <section><h2>Email triage</h2>
    <dl><dt>Classified</dt><dd>{data.insights ? `${data.insights.done} done · ${data.insights.failed} failed` : '—'}{data.insights?.last ? ` · last ${when(data.insights.last)}` : ''}</dd>
      <dt>Last pass</dt><dd>{data.triage.last ? `${when(data.triage.last)} · ${data.triage.note}` : '—'}</dd></dl>
    <form method="POST" action="?/triage"><button disabled={!data.ai.enabled || !data.ai.background}>Run triage now</button></form>
  </section>

  <details><summary>Privacy</summary>
    <ul>
      <li>Nothing is sent to AJMCP until AI is enabled here. Sync, search and the dashboard work without AI.</li>
      <li>Only short, relevant excerpts are sent (never whole mailboxes or document libraries), and only from the data types allowed above.</li>
      <li>AJMCP may route requests to an external model provider configured on the gateway; AadOS cannot choose the provider or model.</li>
      <li>AJMCP keeps recent request transcripts in memory (bounded, cleared on restart) and shows them to its admin. Provider-side retention follows the provider's policy.</li>
      <li>The AJMCP token stays on the server. AI output is labelled as a suggestion and never sends email or changes provider data.</li>
    </ul>
  </details>
</main>
<style>
  main{padding:35px;color:#29344c;max-width:760px}header{display:flex;gap:10px;align-items:center;margin-bottom:14px}h1{margin:0}h2{margin:0 0 10px;font-size:15px}h3{margin:12px 0 6px;font-size:12px;color:#53607a}
  .pill{font-size:11px;font-weight:800;border-radius:99px;padding:3px 9px;background:#f0f2f7;color:#5b6a86}.pill.ok{background:#e3f6f3;color:#0f7f74}
  section{background:#fff;border:1px solid #e3e8f1;border-radius:14px;padding:16px 20px;margin-bottom:12px}
  dl{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;margin:0 0 12px;font-size:13px}dt{color:#8a95a8;font-weight:700;font-size:12px}dd{margin:0}.err{color:#a5414d}
  .opts{display:grid;gap:8px}.opts label{font-size:13px;display:flex;gap:7px;align-items:baseline;flex-wrap:wrap}.opts small{color:#8a95a8;font-size:11px;flex-basis:100%;padding-left:22px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .cfg{display:grid;gap:10px;margin-bottom:14px}.cfg label{display:grid;gap:4px;font-size:12px;font-weight:700;color:#53607a}.cfg input[type=url],.cfg input[type=password]{border:1px solid #dbe1eb;border-radius:8px;padding:8px;font:inherit;font-size:13px;font-weight:400}.cfg input:disabled{background:#f4f6fa}.cfg small{font-weight:400;color:#8a95a8;font-size:11px}.inline{display:inline-flex!important;gap:5px;align-items:center;font-weight:400}.row{display:flex;gap:12px;align-items:center}
  form{margin:0}button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:8px 13px;cursor:pointer;color:#3157de;font-weight:700;justify-self:start}button:disabled{opacity:.5;cursor:default}
  .bad,.good{padding:9px 12px;border-radius:9px;font-size:13px}.bad{background:#fff0f1;color:#a5414d}.good{background:#e3f6f3;color:#0f7f74}
  details{font-size:13px;color:#53607a}summary{cursor:pointer;font-weight:700}details li{margin:4px 0}
</style>
