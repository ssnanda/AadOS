<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const accountLabel = (id: string) => { const a = data.accounts.find((x) => x.id === id); return a ? a.email || a.id : ''; };
  const folderLabel = (f: { accountId?: string; source?: string; name: string }, w: { accountId: string; source: string }) => `${(f.source || w.source) === 'gmail' ? 'Gmail' : 'Zoho'} · ${accountLabel(f.accountId || w.accountId)} · ${f.name}`;
</script>
<svelte:head><title>Email views · Settings · AadOS</title></svelte:head>
<main>
<h1>Email views</h1>
{#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}
<section id="views"><details class="add-view"><summary>+ Add view</summary><form method="POST" action="?/create" class="grid" use:enhance>
    <label class="wide">Folders or labels<select name="folder" required multiple size="8">{#each data.accounts as a (a.id)}<optgroup label={`${a.provider === 'gmail' ? 'Gmail' : 'Zoho'} — ${a.email || a.id}`}>{#each a.folders as folder}<option value={`${a.id}|${folder.id}`}>{folder.path || folder.name}</option>{/each}</optgroup>{/each}</select><small>Pick one or more, from any accounts. Command/Ctrl-click.</small></label>
    <label>View type<select name="parser" required><option value="shop">Shopping</option><option value="health">Health</option><option value="generic">Custom</option></select></label>
    <label>Name<input name="name" placeholder="Use folder or label name" /></label><button disabled={data.accounts.length === 0}>Add view</button>
  </form></details>
  {#if data.pipelines.length === 0}<p class="hint">No views yet.</p>{/if}<div class="views">{#each data.pipelines as workflow (workflow.id)}<article><div class="vicon">{workflow.parser === 'shop' ? '🛍' : workflow.parser === 'health' ? '♡' : '✉'}</div><div><small>{#each workflow.folders as f, n}{n ? ' + ' : ''}{folderLabel(f, workflow)}{/each}</small><h3><a href={`/pipelines/${workflow.id}`}>{workflow.name}</a></h3><p>{data.itemCounts[workflow.id] || 0} items · {workflow.enabled ? 'auto sync' : 'paused'}{workflow.lastError ? ` · ${workflow.lastError}` : ''}</p></div><div class="actions"><form method="POST" action="?/toggle" use:enhance><input type="hidden" name="id" value={workflow.id}><button>{workflow.enabled ? 'Pause' : 'Enable'}</button></form></div></article>{/each}</div></section>
</main>
<style>
  main{color:#29344c}h1{margin:0 0 12px;font-size:20px}.alert{padding:10px;background:#fff0f1;color:#a5414d;border-radius:8px;margin-bottom:10px}
  .add-view{border:1px solid #e3e8f1;border-radius:10px;margin-bottom:14px;background:#fff}.add-view summary{cursor:pointer;padding:11px 14px;font-weight:700;color:#43516c}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 14px 14px}.wide{grid-column:span 2}label{display:grid;gap:6px;font-size:11px;font-weight:700}label small{font-weight:400;color:#8a95a8}
  input,select{border:1px solid #dbe1eb;border-radius:8px;padding:9px;font:inherit}button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:8px 13px;font-weight:700;cursor:pointer;align-self:end}
  .hint{color:#8a95a8}.views{display:grid;gap:10px}.views article{display:grid;grid-template-columns:34px 1fr auto;gap:12px;align-items:center;border:1px solid #e7ebf2;border-radius:10px;padding:12px;background:#fff}
  .vicon{font-size:22px}.views h3{margin:3px 0;font-size:15px}.views h3 a{color:#304fbe;text-decoration:none}.views p,.views small{margin:0;color:#8a95a8;font-size:11px}.actions form{margin:0}
  @media(max-width:650px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
</style>
