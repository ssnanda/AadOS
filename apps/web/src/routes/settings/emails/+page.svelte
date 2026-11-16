<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let error = $derived(form && 'error' in form ? form.error : data.error);
  let zohoAccounts = $derived(data.accounts.filter((a) => a.provider === 'zoho'));
  let gmailAccounts = $derived(data.accounts.filter((a) => a.provider === 'gmail'));
  let homepageUrl = $derived(data.zohoRedirect.replace('/oauth/zoho/callback', ''));
  async function copy(value: string) { await navigator.clipboard.writeText(value); }
</script>
{#snippet accountList(list: typeof data.accounts)}{#if list.length}<ul class="accounts">{#each list as a (a.id)}<li><div><strong>{a.email || a.id}</strong><small>{a.folders.length} {a.provider==='gmail'?'labels':'folders'}</small></div><form method="POST" action="?/refreshAccount"><input type="hidden" name="id" value={a.id}><button>Refresh</button></form><form method="POST" action="?/disconnectAccount"><input type="hidden" name="id" value={a.id}><button class="danger">Disconnect</button></form></li>{/each}</ul>{/if}{/snippet}
<svelte:head><title>Email settings · AadOS</title></svelte:head>
<main><header><a href="/settings">← Settings</a><div><h1>Email settings</h1><p>Read-only personal accounts. Regular Zoho folders and Gmail labels become email workflows.</p></div></header>{#if error}<div class="alert">{error}</div>{/if}
<section><div class="provider"><span class="zoho">Z</span><div><h2>Zoho Mail</h2><p>{zohoAccounts.length?`${zohoAccounts.length} connected`:'Not connected'}</p></div></div>{@render accountList(zohoAccounts)}
<details class="setup" open><summary>Zoho API Console setup</summary><ol>
  <li><a href="https://api-console.zoho.com/" target="_blank" rel="noreferrer">Open Zoho API Console ↗</a> and sign in with the personal Zoho account you will connect.</li>
  <li>Select <strong>Add Client</strong>, then <strong>Server-based Applications</strong>.</li>
  <li>Enter these values:<div class="values"><span>Client name</span><code>AadOS</code><button type="button" onclick={() => copy('AadOS')}>Copy</button><span>Homepage URL</span><code>{homepageUrl}</code><button type="button" onclick={() => copy(homepageUrl)}>Copy</button><span>Authorized redirect URI</span><code>{data.zohoRedirect}</code><button type="button" onclick={() => copy(data.zohoRedirect)}>Copy</button></div></li>
  <li>Create the client, then copy its Client ID and Client Secret below.</li>
  <li>Choose the data center matching the account domain: <code>zoho.com</code> → <code>com</code>, <code>zoho.eu</code> → <code>eu</code>, and so on.</li>
  <li>Save, then connect Zoho. AadOS requests read-only access to accounts, regular folders, and messages. No Organization ID is needed.</li>
</ol></details>
<form method="POST" action="?/saveZoho" class="grid"><label>Client ID<input name="clientId" required></label><label>Client secret<input name="clientSecret" type="password" placeholder={data.configured?'Saved — leave blank to keep':''}></label><label>Data center<select name="dataCenter" value={data.dataCenter}><option>com</option><option>eu</option><option>in</option><option>com.au</option><option>jp</option><option>ca</option><option>sa</option></select></label><label>Redirect URI<input value={data.zohoRedirect} readonly></label><button>Save Zoho</button></form><div class="actions"><form method="POST" action="?/connectZoho"><button class="primary">{zohoAccounts.length?'Add another Zoho account':'Connect Zoho'}</button></form></div>{#if zohoAccounts.length}<p class="hint">For a different Zoho login, sign out of Zoho first or use a private window.</p>{/if}</section>
<section><div class="provider"><span class="gmail">G</span><div><h2>Gmail</h2><p>{gmailAccounts.length?`${gmailAccounts.length} connected`:'Not connected'}</p></div></div>{@render accountList(gmailAccounts)}
<details class="setup" open><summary>Google Cloud OAuth setup</summary><ol>
  <li><a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">Open Gmail API in Google Cloud ↗</a>, select or create a project, and enable the API.</li>
  <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform ↗</a>. Configure the app as <strong>External</strong>, use <strong>AadOS</strong> as the app name, and add your email as the support and developer contact.</li>
  <li>Under Audience, add the Gmail address you will connect as a test user while the app is in testing.</li>
  <li>Under Data Access, add <code>https://www.googleapis.com/auth/gmail.readonly</code>.</li>
  <li>Open Clients, create an <strong>OAuth client ID</strong>, and choose <strong>Web application</strong>.</li>
  <li>Enter these values:<div class="values"><span>Client name</span><code>AadOS</code><button type="button" onclick={() => copy('AadOS')}>Copy</button><span>Authorized JavaScript origin</span><code>{homepageUrl}</code><button type="button" onclick={() => copy(homepageUrl)}>Copy</button><span>Authorized redirect URI</span><code>{data.gmailRedirect}</code><button type="button" onclick={() => copy(data.gmailRedirect)}>Copy</button></div></li>
  <li>Create the client, copy its Client ID and Client Secret below, save, then connect Gmail. AadOS reads regular user labels and messages only.</li>
</ol></details>
<form method="POST" action="?/saveGmail" class="grid"><label>Client ID<input name="clientId" required></label><label>Client secret<input name="clientSecret" type="password" placeholder={data.gmailConfigured?'Saved — leave blank to keep':''}></label><label class="wide">Redirect URI<input value={data.gmailRedirect} readonly></label><button>Save Gmail</button></form><div class="actions"><form method="POST" action="?/connectGmail"><button class="primary">{gmailAccounts.length?'Add another Gmail account':'Connect Gmail'}</button></form></div></section>
<a class="workflows" href="/emails">Choose Shopping and Health folders →</a></main>
<style>
  .accounts{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:6px}.accounts li{display:flex;gap:8px;align-items:center;border:1px solid #e7ebf2;border-radius:9px;padding:8px 12px}.accounts li div{flex:1;min-width:0}.accounts strong{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis}.accounts small,.hint{color:#8a95a8;font-size:11px}.accounts form{margin:0}.hint{margin:8px 0 0}.danger{color:#a5414d}
  .setup{border:1px solid #e3e8f1;border-radius:10px;margin:0 0 18px}
  .setup summary{cursor:pointer;padding:12px 14px;font-weight:700;color:#43516c}
  .setup ol{margin:0;padding:0 34px 14px 40px;font-size:12px;line-height:1.55}
  .setup li{margin:9px 0}
  .setup a{color:#3157de;font-weight:700}
  .values{display:grid;grid-template-columns:145px minmax(0,1fr) auto;gap:7px;align-items:center;margin-top:9px}
  .values code{overflow:auto;background:#f4f6fa;border-radius:6px;padding:8px}
  .values button{padding:7px 10px;color:#3157de}
  @media(max-width:650px){.values{grid-template-columns:1fr}.values button{justify-self:start}}
main{max-width:900px;margin:auto;padding:32px;color:#29344c}header{display:flex;gap:24px;margin-bottom:25px}header a,.workflows{color:#3157de;text-decoration:none}h1{margin:0}header p,.provider p{color:#8a95a8}.alert{padding:11px;background:#fff0f1;color:#a5414d;border-radius:8px}section{background:#fff;border:1px solid #e3e8f1;border-radius:14px;padding:20px;margin:16px 0}.provider{display:flex;gap:12px;align-items:center;margin-bottom:17px}.provider span{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;font-weight:800}.zoho{background:#eef1ff;color:#3157de}.gmail{background:#fff0ee;color:#d94d43}.provider h2,.provider p{margin:2px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px;font-size:11px;font-weight:700}.wide{grid-column:span 2}input,select{border:1px solid #dbe1eb;border-radius:8px;padding:10px}.actions{display:flex;gap:8px;margin-top:13px}.actions form{margin:0}button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:9px 13px}.primary{background:#3157de;color:#fff}.workflows{display:block;margin-top:20px}@media(max-width:650px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}</style>
