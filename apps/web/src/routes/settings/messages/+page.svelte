<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>
<svelte:head><title>Messages · Settings · AadOS</title></svelte:head>
<main>
  <h1>Messages (iMessage)</h1>
  <p class="muted">Through the BlueBubbles server on your Mac. AadOS reads and sends live; it does not keep a copy of your texts.</p>
  {#if form && 'error' in form && form.error}<p class="alert">{form.error}</p>{/if}
  {#if form && 'info' in form && form.info}<p class="ok">Connected{form.info.version ? ` · BlueBubbles ${form.info.version}` : ''}{form.info.os ? ` · macOS ${form.info.os}` : ''}{form.info.privateApi ? ' · Private API on' : ' · Private API off (SMS may go as iMessage)'}{'hook' in form ? (form.hook ? ' · live updates on' : ` · live updates not set up (${form.hookError})`) : ''}.</p>{/if}
  {#if form && 'disconnected' in form}<p class="ok">Disconnected.</p>{/if}
  <form class="card" method="POST" action="?/save" use:enhance={() => async ({ update }) => update({ reset: false })}>
    <label>Server URL<input name="url" value={data.url} placeholder="http://192.168.1.20:1234 or https://….trycloudflare.com" required></label>
    <label>Password<input name="password" type="password" autocomplete="off" placeholder={data.hasPassword ? 'Saved — leave empty to keep' : 'BlueBubbles server password'}></label>
    <div class="row"><button class="primary">Save &amp; connect</button>{#if data.url}<button formaction="?/test">Test</button><button formaction="?/webhook" title="Re-register the webhook that pushes new messages to AadOS">Re-register live updates</button><span class="sp"></span><button class="danger" formaction="?/disconnect" formnovalidate>Disconnect</button>{/if}</div>
  </form>
  {#if data.hook}<p class="muted small">Live updates: BlueBubbles posts new messages to <code>{data.hook}</code> (with a secret token).</p>{/if}
  <details><summary>Setup on the Mac</summary><ol>
    <li>Install BlueBubbles Server (bluebubbles.app) and sign in to Messages with your Apple ID; grant Full Disk Access when asked.</li>
    <li>Set a server password. For the connection pick <b>LAN/manual</b> if this AadOS can reach the Mac on your network, or a <b>Cloudflare</b>/Dynamic DNS URL otherwise.</li>
    <li>Paste the URL and password here. AadOS registers its webhook automatically so new texts appear instantly.</li>
    <li>Keep the Mac awake (System Settings → Battery/Energy → prevent sleep) — when it sleeps, Messages pauses.</li>
  </ol></details>
</main>
<style>
  main{color:#29344c;max-width:760px}h1{margin:0 0 4px;font-size:20px}.muted{color:#8a95a8}.small{font-size:12px}
  .card{background:#fff;border:1px solid #e3e8f1;border-radius:12px;padding:14px;display:grid;gap:10px;margin:10px 0}
  label{display:grid;gap:4px;font-size:11px;font-weight:700;color:#53607a}input{border:1px solid #dbe1eb;border-radius:8px;padding:8px;font:inherit;font-size:13px;font-weight:400}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sp{flex:1}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:7px 12px;font-weight:700;color:#43516c;cursor:pointer;font-size:12px}.primary{background:#3157de;border-color:#3157de;color:#fff}.danger{color:#b53c50}
  .alert{background:#fff0f1;color:#a5414d;border-radius:8px;padding:10px}.ok{background:#e9f7ef;color:#1e7a47;border-radius:8px;padding:10px}
  details{background:#fff;border:1px solid #e3e8f1;border-radius:12px;padding:10px 14px}summary{cursor:pointer;font-weight:700}ol{margin:8px 0 0;padding-left:18px;display:grid;gap:5px}
</style>
