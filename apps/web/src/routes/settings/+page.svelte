<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>
<svelte:head><title>General · Settings · AadOS</title></svelte:head>
<main><header><div><h1>General</h1></div></header>
{#if form && 'error' in form && form.error}<p class="bad">{form.error}</p>{/if}
<section><h2>Calendar</h2><form method="POST" action="?/prefs" class="grid">
  <label>Time zone<input name="timeZone" value={data.prefs.timeZone || 'UTC'} required list="zones"></label>
  <label>Week starts<select name="weekStart" value={String(data.prefs.weekStart)}><option value="0">Sunday</option><option value="1">Monday</option></select></label>
  <button class="save">Save</button></form>
  <datalist id="zones">{#each Intl.supportedValuesOf('timeZone') as z (z)}<option value={z}></option>{/each}</datalist></section>
<section><h2>Password</h2>
  {#if form && 'pwError' in form && form.pwError}<p class="bad">{form.pwError}</p>{/if}{#if form && 'pwSaved' in form}<p class="ok">Password changed. Other devices have been signed out.</p>{/if}
  <form method="POST" action="?/password" class="grid">
    <label class="full">Current password<input type="password" name="current" autocomplete="current-password" required></label>
    <label>New password<input type="password" name="next" autocomplete="new-password" minlength="12" maxlength="200" required></label>
    <label>Confirm new password<input type="password" name="confirm" autocomplete="new-password" minlength="12" maxlength="200" required></label>
    <button class="save">Change password</button></form></section>
<section><h2>Sessions</h2><form method="POST" action="/logout"><input type="hidden" name="all" value="1"><button onclick={(e) => { if (!confirm('Sign out on every device?')) e.preventDefault(); }}>Sign out everywhere</button></form></section>
{#if data.db.mode === 'compare'}<section><h2>Database</h2>
  {#if data.db.error}<p class="bad">{data.db.error}</p>{:else if data.db.comparison?.match}<p class="ok">Mirror matches legacy state</p>{:else if data.db.comparison}<ul class="bad">{#each data.db.comparison.differences as d (d)}<li>{d}</li>{/each}</ul>{/if}</section>{/if}</main>
<style>main{padding:35px;color:#29344c}h1{margin:0 0 14px}h2{margin:0 0 10px;font-size:15px}section{background:#fff;border:1px solid #e3e8f1;border-radius:14px;padding:16px 20px;max-width:520px}form{margin:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid .full{grid-column:1/-1}.grid label{display:grid;gap:5px;font-size:11px;font-weight:700}.grid input,.grid select{border:1px solid #dbe1eb;border-radius:8px;padding:8px;font:inherit;font-size:13px;min-width:0}.save{color:#3157de;justify-self:start}section+section{margin-top:12px}.ok{color:#0f7f74;margin:0;font-size:13px}.bad{color:#a5414d;margin:0;font-size:13px;padding-left:0;list-style:none}button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:9px 13px;cursor:pointer;color:#a5414d;font-weight:700}</style>
