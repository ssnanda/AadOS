<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import AppShell from '$lib/components/AppShell.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const autosave: SubmitFunction = () => async ({ update }) => { await update({ reset: false }); };
  const save = (e: Event & { currentTarget: HTMLInputElement }) => { const f = e.currentTarget.form; if (!f) return; (f.elements.namedItem('on') as HTMLInputElement).value = String(e.currentTarget.checked); f.requestSubmit(); };
</script>
<svelte:head><title>My accounts · AadOS</title></svelte:head>
<AppShell title="My accounts">
<main>
  <h1>My accounts</h1>
  <p class="muted">Link your own email and calendar. Only you see them in AadOS.</p>
  {#if data.error}<p class="alert">{data.error}</p>{/if}{#if data.connected}<p class="ok">Account connected. Your mail and calendar load automatically.</p>{/if}
  <div class="row">
    <form method="POST" action="?/connectGmail"><button class="primary" disabled={!data.canGmail}>＋ Link Gmail</button></form>
    <form method="POST" action="?/connectZoho"><button class="primary" disabled={!data.canZoho}>＋ Link Zoho</button></form>
    {#if !data.canGmail || !data.canZoho}<small class="muted">{!data.canGmail && !data.canZoho ? 'Gmail and Zoho are' : !data.canGmail ? 'Gmail is' : 'Zoho is'} not set up yet — ask the owner.</small>{/if}
  </div>
  <ul>{#each data.accounts as a (a.id)}
    <li class="card">
      <div class="head"><strong>{a.email}</strong><span class="pill">{a.provider === 'gmail' ? 'Gmail' : 'Zoho'}</span><span class="sp"></span>
        <form method="POST" action="?/disconnect" use:enhance={({ cancel }) => { if (!confirm(`Disconnect ${a.email} from AadOS?`)) cancel(); }}><input type="hidden" name="id" value={a.id}><button class="danger">Disconnect</button></form></div>
      {#if a.lastError}<small class="err">{a.lastError}</small>{/if}{#if a.calendarError}<small class="err">Calendar: {a.calendarError}</small>{/if}
      <div class="sync">
        <form method="POST" action="?/setSync" use:enhance={autosave}><input type="hidden" name="id" value={a.id}><input type="hidden" name="kind" value="mail"><input type="hidden" name="on" value={String(!a.paused)}><label><input type="checkbox" checked={!a.paused} onchange={save}> ✉ Email</label></form>
        {#if a.calendar}<form method="POST" action="?/setSync" use:enhance={autosave}><input type="hidden" name="id" value={a.id}><input type="hidden" name="kind" value="calendar"><input type="hidden" name="on" value={String(!a.calendarOff)}><label><input type="checkbox" checked={!a.calendarOff} onchange={save}> ▦ Calendar</label></form>{/if}
        {#if a.calendar && !a.calendarOff}{#each data.calendars.filter((c) => c.accountId === a.id) as c (c.id)}<form method="POST" action="?/toggleCalendar" use:enhance={autosave}><input type="hidden" name="id" value={c.id}><input type="hidden" name="on" value={String(c.enabled)}><label class="cal"><input type="checkbox" checked={c.enabled} onchange={save}><i style="background:{c.color || '#3157de'}"></i>{c.name}</label></form>{/each}{/if}
      </div>
    </li>{:else}<li class="muted">No accounts linked yet.</li>{/each}</ul>
</main>
</AppShell>
<style>
  main{color:#29344c;max-width:820px}h1{margin:0 0 4px;font-size:22px}.muted{color:#8a95a8}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}form{margin:0}
  ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}.card{background:#fff;border:1px solid #e3e8f1;border-radius:12px;padding:12px 14px;display:grid;gap:6px}
  .head{display:flex;gap:8px;align-items:center}.pill{font-size:11px;font-weight:700;background:#eef1ff;color:#3157de;border-radius:6px;padding:2px 7px}.sp{flex:1}
  .sync{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}.sync label{display:inline-flex;gap:6px;align-items:center;font-weight:600;cursor:pointer}.cal{font-weight:500 !important;font-size:12px}.cal i{width:9px;height:9px;border-radius:50%}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:7px 13px;font-weight:700;color:#43516c;cursor:pointer;font-size:12px}button:disabled{opacity:.5}.primary{background:#3157de;border-color:#3157de;color:#fff}.danger{color:#b53c50}
  .alert{background:#fff0f1;color:#a5414d;border-radius:8px;padding:10px}.ok{background:#e9f7ef;color:#1e7a47;border-radius:8px;padding:10px}.err{color:#a5414d}
</style>
