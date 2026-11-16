<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let actionError = $derived(form && 'error' in form ? form.error : '');
</script>

<svelte:head><title>Zoho pipelines · AadOS</title></svelte:head>
<main class="shell">
  <header><a href="/">← Inbox</a><div><h1>Zoho pipelines</h1><p>Connect one personal mailbox, then turn folders into focused workflows.</p></div></header>
  {#if data.error || actionError}<div class="alert">{data.error || actionError}</div>{/if}
  {#if data.connectedNow}<div class="ok">Zoho connected and folders loaded.</div>{/if}

  <section><h2>Connection</h2><div class="status"><span class:live={data.connected}></span><strong>{data.connected ? data.connectedEmail : 'Not connected'}</strong></div>
    <form method="POST" action="?/save" class="grid">
      <label>Client ID<input name="clientId" required /></label>
      <label>Client secret<input name="clientSecret" type="password" placeholder={data.configured ? 'Saved — leave blank to keep' : ''} /></label>
      <label>Data center<select name="dataCenter" value={data.dataCenter}><option>com</option><option>eu</option><option>in</option><option>com.au</option><option>jp</option><option>ca</option><option>sa</option></select></label>
      <label>Redirect URI<input value={data.redirectUri} readonly /></label>
      <button>Save connection</button>
    </form>
    <div class="actions">
      <form method="POST" action="?/connect"><button class="primary" disabled={!data.configured}>Connect Zoho</button></form>
      {#if data.connected}<form method="POST" action="?/refreshFolders"><button>Refresh folders</button></form><form method="POST" action="?/disconnect"><button class="danger">Disconnect</button></form>{/if}
    </div>
  </section>

  <section><h2>Create pipeline</h2>
    <form method="POST" action="?/createPipeline" class="grid">
      <label>Folder<select name="folderId" required><option value="">Select folder</option>{#each data.folders as folder}<option value={folder.id}>{folder.path || folder.name}</option>{/each}</select></label>
      <label>Name<input name="name" placeholder="Use folder name" /></label>
      <label>Parser<select name="parser"><option value="generic">Generic</option><option value="shop">Shop</option><option value="health">Health</option></select></label>
      <button disabled={!data.connected}>Create pipeline</button>
    </form>
  </section>

  <section><h2>Pipelines</h2>{#if data.pipelines.length === 0}<p class="muted">No folder pipelines yet.</p>{/if}
    <div class="pipelines">{#each data.pipelines as pipeline}<article><div><small>{pipeline.folderName}</small><h3><a href={`/pipelines/${pipeline.id}`}>{pipeline.name}</a></h3><p>{pipeline.parser} parser · {data.itemCounts[pipeline.id] || 0} items · {pipeline.enabled ? 'hourly on' : 'paused'}</p></div><div class="actions"><form method="POST" action="?/sync"><input type="hidden" name="id" value={pipeline.id} /><button>Sync now</button></form><form method="POST" action="?/toggle"><input type="hidden" name="id" value={pipeline.id} /><button>{pipeline.enabled ? 'Pause' : 'Enable'}</button></form></div></article>{/each}</div>
  </section>
</main>
<style>
  .shell{max-width:980px;margin:auto;padding:32px;color:#29344c}header{display:flex;gap:25px;align-items:flex-start;margin-bottom:24px}header a{color:#3157de;text-decoration:none;margin-top:8px}h1{margin:0;font-size:27px}header p,.muted{color:#8994a8}section{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:20px;margin:16px 0}h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 16px;color:#68758e}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}label{display:grid;gap:6px;font-size:11px;font-weight:750;color:#647087}input,select{width:100%;border:1px solid #dbe1eb;border-radius:8px;padding:10px;background:#fbfcfe}button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:9px 13px;color:#43516c}.grid>button{align-self:end}.primary{background:#3157de;color:#fff;border-color:#3157de}.danger{color:#a5424c}.actions{display:flex;gap:9px;margin-top:15px}.status{display:flex;gap:8px;align-items:center;margin-bottom:15px}.status span{width:8px;height:8px;border-radius:50%;background:#c8ced8}.status span.live{background:#38b878}.alert,.ok{padding:11px 14px;border-radius:9px}.alert{background:#fff0f1;color:#a5414d}.ok{background:#edf9f1;color:#287649}.pipelines{display:grid;gap:10px}.pipelines article{display:flex;align-items:center;justify-content:space-between;border:1px solid #e7ebf2;border-radius:10px;padding:13px}.pipelines h3{margin:3px 0}.pipelines a{color:#304fbe;text-decoration:none}.pipelines p,.pipelines small{margin:0;color:#8a95a8;font-size:11px}@media(max-width:650px){.grid{grid-template-columns:1fr}header{display:block}.actions{flex-wrap:wrap}}
</style>
