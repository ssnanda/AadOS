<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let error = $derived(form && 'error' in form ? form.error : data.error);
  const accountLabel = (id: string) => { const a = data.accounts.find((x) => x.id === id); return a ? a.email || a.id : ''; };
  const folderLabel = (f: { accountId?: string; source?: string; name: string }, w: { accountId: string; source: string }) => `${(f.source || w.source) === 'gmail' ? 'Gmail' : 'Zoho'} · ${accountLabel(f.accountId || w.accountId) || 'account removed'} · ${f.name}`;
  let zohoAccounts = $derived(data.accounts.filter((a) => a.provider === 'zoho'));
  let gmailAccounts = $derived(data.accounts.filter((a) => a.provider === 'gmail'));
  let homepageUrl = $derived(data.zohoRedirect.replace('/oauth/zoho/callback', ''));
  async function copy(value: string) { await navigator.clipboard.writeText(value); }
</script>
{#snippet accountList(list: typeof data.accounts)}{#if list.length}<ul class="accounts">{#each list as a (a.id)}{@const full = a.canModify && a.canSend && (a.provider !== 'gmail' || a.canFilter)}
<li id={`acct-${a.id}`}>
  <div class="ahead"><strong title={a.email}>{a.email || a.id}</strong><span class="pill" class:ok={full} title={full ? 'Delete to Trash, mark read/unread, send, Gmail filters' : 'AadOS can only read this mailbox'}>{full ? 'Full access' : 'Read-only'}</span>{#if a.calendar}<span class="pill ok">Calendar</span>{/if}{#if a.paused}<span class="pill">Auto sync off</span>{/if}
    <small>{a.messages.toLocaleString()} emails · {a.folders.length} {a.provider==='gmail'?'labels':'folders'} · {a.lastSync ? `synced ${new Date(a.lastSync).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'not synced yet'}</small></div>
  {#if a.lastError}<small class="err">{a.lastError}</small>{/if}{#if a.calendarError}<small class="err">Calendar: {a.calendarError}</small>{/if}
  <div class="acts">
    {#if !full}<form method="POST" action="?/allowChanges"><input type="hidden" name="id" value={a.id}><button class="primary" title="One-time approval at {a.provider === 'gmail' ? 'Google' : 'Zoho'}: delete to Trash, mark read/unread, send what you write{a.provider === 'gmail' ? ', Gmail filters' : ''}">Allow changes</button></form>{/if}
    {#if a.lastError}<form method="POST" action="?/allowChanges"><input type="hidden" name="id" value={a.id}><button class="primary">Reconnect</button></form>{/if}
    <form method="POST" action="?/refreshAccount"><input type="hidden" name="id" value={a.id}><button title="Reload folders/labels">Refresh</button></form>
    <form method="POST" action="?/toggleAccountSync"><input type="hidden" name="id" value={a.id}><button title="Automatic sync of open folders">{a.paused ? 'Resume auto sync' : 'Pause auto sync'}</button></form>
    {#if a.calendar}<form method="POST" action="?/syncCalendarAccount"><input type="hidden" name="id" value={a.id}><button>Sync calendar</button></form>{:else}<form method="POST" action="?/enableCalendar"><input type="hidden" name="id" value={a.id}><button title="Read-only calendar access">Enable calendar</button></form>{/if}
    <span class="sp"></span>
    {#if a.calendar}<form method="POST" action="?/clearCalendar" onsubmit={(e) => { if (!confirm('Remove this account\'s synced calendar data from AadOS?')) e.preventDefault(); }}><input type="hidden" name="id" value={a.id}><button class="quiet danger">Clear calendar</button></form>{/if}
    <form method="POST" action="?/purgeAccountData" onsubmit={(e) => { if (!confirm('Remove all synced emails of this account from AadOS? A sync brings them back.')) e.preventDefault(); }}><input type="hidden" name="id" value={a.id}><button class="quiet danger" title="Remove local copies">Clear data</button></form>
    <form method="POST" action="?/disconnectAccount"><input type="hidden" name="id" value={a.id}><button class="quiet danger">Disconnect</button></form>
  </div>
  {#if a.calendar && data.calendars.some((c) => c.accountId === a.id)}<div class="cals">{#each data.calendars.filter((c) => c.accountId === a.id) as c (c.id)}<form method="POST" action="?/toggleCalendar"><input type="hidden" name="id" value={c.id}><button class:offc={!c.enabled} title={c.enabled ? 'Synced — click to turn off' : 'Off — click to sync'}><i style="background:{c.color || '#3157de'}"></i>{c.name}{c.enabled ? '' : ' (off)'}</button></form>{/each}</div>{/if}
</li>{/each}</ul>{/if}{/snippet}
<svelte:head><title>Email settings · AadOS</title></svelte:head>
<main><header><a href="/settings">← Settings</a><div><h1>Email settings</h1><p>Read-only personal accounts. Connect several per provider; a view can span accounts.</p></div></header>{#if error}<div class="alert">{error}</div>{/if}
<h2 class="vh" id="connections">Email connections</h2>
<section class="conn" id="zoho"><details class="outer" open><summary><div class="provider"><span class="zoho">Z</span><div><h2>Zoho Mail</h2><p>{zohoAccounts.length?`${zohoAccounts.length} connected`:'Not connected'}</p></div><i class="dot" class:ok={zohoAccounts.length>0} title={zohoAccounts.length?'Connected':'Not connected'}></i></div></summary>{@render accountList(zohoAccounts)}
<details class="setup" open={!data.configured}><summary>Zoho API Console app credentials &amp; setup</summary><ol>
  <li><a href="https://api-console.zoho.com/" target="_blank" rel="noreferrer">Open Zoho API Console ↗</a> and sign in with the personal Zoho account you will connect.</li>
  <li>Select <strong>Add Client</strong>, then <strong>Server-based Applications</strong>.</li>
  <li>Enter these values:<div class="values"><span>Client name</span><code>AadOS</code><button type="button" onclick={() => copy('AadOS')}>Copy</button><span>Homepage URL</span><code>{homepageUrl}</code><button type="button" onclick={() => copy(homepageUrl)}>Copy</button><span>Authorized redirect URI</span><code>{data.zohoRedirect}</code><button type="button" onclick={() => copy(data.zohoRedirect)}>Copy</button></div></li>
  <li>Create the client, then copy its Client ID and Client Secret below.</li>
  <li>Choose the data center matching the account domain: <code>zoho.com</code> → <code>com</code>, <code>zoho.eu</code> → <code>eu</code>, and so on.</li>
  <li>Save, then connect Zoho. AadOS requests read-only access to accounts, regular folders, and messages. No Organization ID is needed.</li>
</ol>
<form method="POST" action="?/saveZoho" class="grid"><label>Client ID<input name="clientId" required></label><label>Client secret<input name="clientSecret" type="password" placeholder={data.configured?'Saved — leave blank to keep':''}></label><label>Data center<select name="dataCenter" value={data.dataCenter}><option>com</option><option>eu</option><option>in</option><option>com.au</option><option>jp</option><option>ca</option><option>sa</option></select></label><label>Redirect URI<input value={data.zohoRedirect} readonly></label><button>Save Zoho</button></form></details><div class="actions"><form method="POST" action="?/connectZoho"><button class="primary">{zohoAccounts.length?'Add another Zoho account':'Connect Zoho'}</button></form></div>{#if zohoAccounts.length}<p class="hint">For a different Zoho login, sign out of Zoho first or use a private window.</p>{/if}</details></section>
<section class="conn" id="gmail"><details class="outer" open><summary><div class="provider"><span class="gmail">G</span><div><h2>Gmail</h2><p>{gmailAccounts.length?`${gmailAccounts.length} connected`:'Not connected'}</p></div><i class="dot" class:ok={gmailAccounts.length>0} title={gmailAccounts.length?'Connected':'Not connected'}></i></div></summary>{@render accountList(gmailAccounts)}
<details class="setup" open={!data.gmailConfigured}><summary>Google Cloud OAuth app credentials &amp; setup</summary><ol>
  <li><a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">Open Gmail API in Google Cloud ↗</a>, select or create a project, and enable the API.</li>
  <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform ↗</a>. Configure the app as <strong>External</strong>, use <strong>AadOS</strong> as the app name, and add your email as the support and developer contact.</li>
  <li>Under Audience, add the Gmail address you will connect as a test user while the app is in testing.</li>
  <li>Under Data Access, add <code>https://www.googleapis.com/auth/gmail.readonly</code>.</li>
  <li>Open <strong>Google Auth Platform → Clients</strong>, select <strong>Create client</strong>, then choose <strong>Web application</strong>. Do not use a Desktop client; Desktop clients do not have a redirect-URI field.</li>
  <li>Set the name, then find <strong>Authorized redirect URIs</strong>, select <strong>+ Add URI</strong>, and paste the redirect URI below. <strong>Authorized JavaScript origins can stay empty.</strong><div class="values"><span>Client name</span><code>AadOS</code><button type="button" onclick={() => copy('AadOS')}>Copy</button><span>Authorized redirect URI</span><code>{data.gmailRedirect}</code><button type="button" onclick={() => copy(data.gmailRedirect)}>Copy</button></div></li>
  <li>Create the client, copy its Client ID and Client Secret below, save, then connect Gmail. AadOS reads regular user labels and messages only.</li>
</ol>
<form method="POST" action="?/saveGmail" class="grid"><label>Client ID<input name="clientId" required></label><label>Client secret<input name="clientSecret" type="password" placeholder={data.gmailConfigured?'Saved — leave blank to keep':''}></label><label class="wide">Redirect URI<input value={data.gmailRedirect} readonly></label><button>Save Gmail</button></form></details><div class="actions"><form method="POST" action="?/connectGmail"><button class="primary">{gmailAccounts.length?'Add another Gmail account':'Connect Gmail'}</button></form></div></details></section>
<section id="views"><h2 class="vh">Views</h2><details class="add-view"><summary>+ Add view</summary><form method="POST" action="?/create" class="grid">
    <label class="wide">Folders or labels<select name="folder" required multiple size="8">{#each data.accounts as a (a.id)}<optgroup label={`${a.provider === 'gmail' ? 'Gmail' : 'Zoho'} — ${a.email || a.id}`}>{#each a.folders as folder}<option value={`${a.id}|${folder.id}`}>{folder.path || folder.name}</option>{/each}</optgroup>{/each}</select><small>Pick one or more, from any accounts. Command/Ctrl-click.</small></label>
    <label>View type<select name="parser" required><option value="shop">Shopping</option><option value="health">Health</option><option value="generic">Custom</option></select></label>
    <label>Name<input name="name" placeholder="Use folder or label name" /></label><button disabled={data.accounts.length === 0}>Add view</button>
  </form></details>
  {#if data.pipelines.length === 0}<p class="hint">No views yet.</p>{/if}<div class="views">{#each data.pipelines as workflow (workflow.id)}<article><div class="vicon">{workflow.parser === 'shop' ? '🛍' : workflow.parser === 'health' ? '♡' : '✉'}</div><div><small>{#each workflow.folders as f, n}{n ? ' + ' : ''}{folderLabel(f, workflow)}{/each}</small><h3><a href={`/pipelines/${workflow.id}`}>{workflow.name}</a></h3><p>{data.itemCounts[workflow.id] || 0} items · {workflow.enabled ? 'auto sync · 15 min' : 'paused'}{workflow.lastError ? ` · ${workflow.lastError}` : ''}</p></div><div class="actions"><form method="POST" action="?/toggle"><input type="hidden" name="id" value={workflow.id}><button>{workflow.enabled ? 'Pause' : 'Enable'}</button></form></div></article>{/each}</div></section>
</main>
<style>
  .outer>summary{list-style:none;cursor:pointer}.outer>summary::-webkit-details-marker{display:none}.outer>summary .provider{margin:0}.outer[open]>summary .provider{margin-bottom:17px}
  .dot{margin-left:auto;width:12px;height:12px;border-radius:50%;background:#e0485b;box-shadow:0 0 0 4px #fde8eb}.dot.ok{background:#2fb96b;box-shadow:0 0 0 4px #def5e8}
  .outer>summary:after{content:'▾';color:#8a95a8;margin-left:12px}.outer[open]>summary:after{content:'▴'}
  .conn{padding:16px 20px}
  .vh{margin:0 0 14px;scroll-margin-top:12px;font-size:16px}.add-view{border:1px solid #e3e8f1;border-radius:10px;margin-bottom:14px}.add-view summary{cursor:pointer;padding:11px 14px;font-weight:700;color:#43516c}.add-view .grid{padding:0 14px 14px}.views{display:grid;gap:10px}.views article{display:grid;grid-template-columns:34px 1fr auto;gap:12px;align-items:center;border:1px solid #e7ebf2;border-radius:10px;padding:12px}.vicon{font-size:22px}.views h3{margin:3px 0;font-size:15px}.views h3 a{color:#304fbe;text-decoration:none}.views p,.views small{margin:0;color:#8a95a8;font-size:11px}.views .actions{margin:0}@media(max-width:650px){.views article{grid-template-columns:30px 1fr}.views .actions{grid-column:2;flex-wrap:wrap}}
  .accounts{list-style:none;margin:0 0 14px;padding:0;display:grid;gap:6px}.accounts li{border:1px solid #e7ebf2;border-radius:9px;padding:9px 12px;display:grid;gap:6px}
  .ahead{display:flex;gap:7px;align-items:center;flex-wrap:wrap;min-width:0}.ahead strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.ahead small{color:#8a95a8;font-size:11px;margin-left:auto}
  .pill{font-size:10px;font-weight:800;border-radius:99px;padding:2px 8px;background:#fff4df;color:#a1752a}.pill.ok{background:#e3f6f3;color:#0f7f74}
  .acts{display:flex;gap:4px;flex-wrap:wrap;align-items:center}.acts form{margin:0}.acts button{padding:4px 9px;font-size:11px;border-radius:7px}.acts .sp{flex:1}.quiet{border-color:transparent!important;background:transparent!important}
  .accounts small,.hint{color:#8a95a8;font-size:11px}.accounts .err{color:#a5414d}.hint{margin:8px 0 0}.danger{color:#a5414d}
  .cals{display:flex;gap:6px;flex-wrap:wrap}.cals form{margin:0}.cals button{display:inline-flex;gap:6px;align-items:center;padding:3px 9px;font-size:11px;border-radius:99px}.cals i{width:8px;height:8px;border-radius:50%}.cals .offc{opacity:.5}
  .setup{border:1px solid #e3e8f1;border-radius:10px;margin:0 0 18px}
  .setup summary{cursor:pointer;padding:12px 14px;font-weight:700;color:#43516c}
  .setup form.grid{padding:0 14px 14px}
  .setup ol{margin:0;padding:0 34px 14px 40px;font-size:12px;line-height:1.55}
  .setup li{margin:9px 0}
  .setup a{color:#3157de;font-weight:700}
  .values{display:grid;grid-template-columns:145px minmax(0,1fr) auto;gap:7px;align-items:center;margin-top:9px}
  .values code{overflow:auto;background:#f4f6fa;border-radius:6px;padding:8px}
  .values button{padding:7px 10px;color:#3157de}
  @media(max-width:650px){.values{grid-template-columns:1fr}.values button{justify-self:start}}
main{max-width:900px;margin:auto;padding:32px;color:#29344c}header{display:flex;gap:24px;margin-bottom:25px}header a,.workflows{color:#3157de;text-decoration:none}h1{margin:0}header p,.provider p{color:#8a95a8}.alert{padding:11px;background:#fff0f1;color:#a5414d;border-radius:8px}section{background:#fff;border:1px solid #e3e8f1;border-radius:14px;padding:20px;margin:16px 0}.provider{display:flex;gap:12px;align-items:center;margin-bottom:17px}.provider span{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;font-weight:800}.zoho{background:#eef1ff;color:#3157de}.gmail{background:#fff0ee;color:#d94d43}.provider h2,.provider p{margin:2px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px;font-size:11px;font-weight:700}.wide{grid-column:span 2}input,select{border:1px solid #dbe1eb;border-radius:8px;padding:10px}.actions{display:flex;gap:8px;margin-top:13px}.actions form{margin:0}button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:9px 13px}.primary{background:#3157de;color:#fff}.workflows{display:block;margin-top:20px}@media(max-width:650px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}</style>
