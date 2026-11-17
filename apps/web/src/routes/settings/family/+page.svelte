<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const LABELS: Record<string, string> = { emails: 'Emails', messages: 'Messages', finance: 'Finance', calendar: 'Calendar', tasks: 'Tasks', reminders: 'Reminders', asana: 'Asana', documents: 'Documents', assistant: 'Assistant' };
  let adding = $state(false), editing = $state(''), resetting = $state('');
  let newAll = $state(false);
</script>

{#snippet access(perms: string[], boxes: string[] | 'all', ownAccounts = false)}
  <fieldset><legend>Sections</legend><div class="opts">{#each data.permissions as p (p)}<label><input type="checkbox" name="perm" value={p} checked={perms.includes(p)}> {LABELS[p]}</label>{/each}</div></fieldset>
  <fieldset><legend>Email &amp; calendar accounts — share mine and/or let them link their own</legend><div class="opts">
    <label class="own"><input type="checkbox" name="ownAccounts" checked={ownAccounts}> <b>Can link their own email &amp; calendar</b> (private to them)</label>
    <label><input type="checkbox" name="allMail" checked={boxes === 'all'}> All of my mailboxes</label>
    {#each data.accounts as a (a.id)}<label><input type="checkbox" name="mailbox" value={a.id} checked={boxes !== 'all' && boxes.includes(a.id)}> {a.provider === 'gmail' ? 'Gmail' : 'Zoho'} · {a.email}</label>{/each}
  </div></fieldset>
{/snippet}

<svelte:head><title>Family · Settings · AadOS</title></svelte:head>
<main>
  <header><h1>Family</h1><button class="primary" onclick={() => (adding = !adding)}>{adding ? 'Cancel' : '＋ Add member'}</button></header>
  {#if form && 'error' in form && form.error}<p class="alert">{form.error}</p>{/if}
  {#if form && 'shown' in form && form.shown}<p class="ok">Password for <b>{form.shown.username}</b>: <code>{form.shown.password}</code> — copy it now; it is not shown again.</p>
  {:else if form && 'created' in form}<p class="ok">Added {form.created}.</p>{:else if form && 'saved' in form}<p class="ok">Saved {form.saved}.</p>{/if}

  {#if adding}
    <form class="card" method="POST" action="?/create" use:enhance={() => async ({ update, result }) => { await update(); if (result.type === 'success') adding = false; }}>
      <div class="grid"><label>Name<input name="name" required maxlength="60"></label><label>Username<input name="username" required autocomplete="off" pattern="[A-Za-z0-9._\-]{'{'}3,32{'}'}"></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" placeholder="Leave empty to generate"></label></div>
      {@render access(['calendar', 'tasks', 'reminders'], newAll ? 'all' : [])}
      <div class="row"><button class="primary">Create login</button></div>
    </form>
  {/if}

  {#if !data.members.length && !adding}<p class="muted">No family members yet. Each member signs in with their own username and only sees the sections (and mailboxes) you allow. Settings stays yours.</p>{/if}
  <ul class="members">{#each data.members as m (m.id)}
    <li class="card" class:off={m.disabled}>
      <div class="mhead"><span class="av">{m.name.slice(0, 1).toUpperCase()}</span><div><strong>{m.name}</strong><small>{m.username}{m.disabled ? ' · disabled' : ''}</small></div>
        <span class="tags">{#each m.permissions as p (p)}<i>{LABELS[p]}</i>{:else}<i class="none">No access</i>{/each}{#if m.ownAccounts}<i class="ownt">Own accounts</i>{/if}{#if m.permissions.includes('emails')}<i class="mail">{m.mailboxes === 'all' ? 'All mail' : `${m.mailboxes.length} mailbox${m.mailboxes.length === 1 ? '' : 'es'}`}</i>{/if}</span>
        <span class="sp"></span>
        <button onclick={() => (editing = editing === m.id ? '' : m.id)}>Access</button><button onclick={() => (resetting = resetting === m.id ? '' : m.id)}>Password</button>
        <form method="POST" action="?/toggle" use:enhance><input type="hidden" name="id" value={m.id}><button>{m.disabled ? 'Enable' : 'Disable'}</button></form>
        <form method="POST" action="?/remove" use:enhance={({ cancel }) => { if (!confirm(`Remove ${m.name}'s login?`)) cancel(); }}><input type="hidden" name="id" value={m.id}><button class="danger">Remove</button></form>
      </div>
      {#if editing === m.id}<form method="POST" action="?/update" use:enhance={() => async ({ update }) => { await update({ reset: false }); editing = ''; }}><input type="hidden" name="id" value={m.id}><label class="nm">Name<input name="name" value={m.name}></label>{@render access(m.permissions, m.mailboxes, m.ownAccounts)}<div class="row"><button class="primary">Save access</button></div></form>{/if}
      {#if resetting === m.id}<form class="row" method="POST" action="?/password" use:enhance={() => async ({ update }) => { await update(); resetting = ''; }}><input type="hidden" name="id" value={m.id}><input name="password" type="password" autocomplete="new-password" placeholder="New password (empty = generate)"><button class="primary">Set password</button><small class="muted">Signs {m.name} out everywhere.</small></form>{/if}
    </li>{/each}</ul>
</main>

<style>
  main{padding:30px;color:#29344c;max-width:900px}header{display:flex;align-items:center;gap:12px;margin-bottom:12px}h1{margin:0;flex:1}
  .card{background:#fff;border:1px solid #e3e8f1;border-radius:12px;padding:14px;display:grid;gap:10px;margin-bottom:10px}.card.off{opacity:.6}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}label{display:grid;gap:4px;font-size:11px;font-weight:700;color:#53607a}
  input{border:1px solid #dbe1eb;border-radius:8px;padding:8px;font:inherit;font-size:13px;font-weight:400}
  fieldset{border:1px solid #eef0f5;border-radius:10px;padding:8px 10px;margin:0}legend{font-size:11px;font-weight:800;color:#8a95a8;padding:0 4px}
  .opts{display:flex;flex-wrap:wrap;gap:6px 14px}.opts label{display:flex;gap:5px;align-items:center;font-size:13px;font-weight:500;color:#29344c}
  .row{display:flex;gap:8px;align-items:center}.row input[type=password]{flex:1}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:7px 12px;font-weight:700;color:#43516c;cursor:pointer;font-size:12px}.primary{background:#3157de;border-color:#3157de;color:#fff}.danger{color:#b53c50}
  .members{list-style:none;margin:0;padding:0}.mhead{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.mhead form{margin:0}.mhead div{display:grid}.mhead small{color:#8a95a8}
  .av{width:34px;height:34px;border-radius:50%;background:#f1ebff;color:#6a3fd1;display:grid;place-items:center;font-weight:800}
  .tags{display:flex;gap:4px;flex-wrap:wrap}.tags i{font-style:normal;font-size:11px;font-weight:700;background:#eef1ff;color:#3157de;border-radius:6px;padding:2px 7px}.tags .mail{background:#e9f7ef;color:#1e7a47}.tags .none{background:#f2f3f6;color:#8a95a8}.tags .ownt{background:#fff1e3;color:#c26b1a}.opts .own{flex-basis:100%}
  .sp{flex:1}.nm{max-width:300px}
  .alert{background:#fff0f1;color:#a5414d;border-radius:8px;padding:10px}.ok{background:#e9f7ef;color:#1e7a47;border-radius:8px;padding:10px}.ok code{background:#fff;padding:2px 6px;border-radius:5px;font-size:13px}.muted{color:#8a95a8}
  @media(max-width:700px){.grid{grid-template-columns:1fr}}
</style>
