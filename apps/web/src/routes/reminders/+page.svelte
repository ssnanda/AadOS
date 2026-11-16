<script lang="ts">
  import { enhance } from '$app/forms';
  import AppShell from '$lib/components/AppShell.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let editing = $state('');
  let tab = $state<'upcoming' | 'history'>('upcoming');
  const when = (iso: string) => new Date(iso).toLocaleString([], { timeZone: data.tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  // <input type=date/time> values in the owner's zone.
  const parts = (iso: string) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: data.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
  const icon = (s: string) => s === 'task' ? '☑' : s === 'event' ? '▣' : '◔';
  const SNOOZE = [[10, '10 min'], [60, '1 hour'], [180, '3 hours'], [1440, 'Tomorrow']] as const;
</script>
<svelte:head><title>Reminders · AadOS</title></svelte:head>
<AppShell title="Reminders">
<main>
  <header><div><h1>Reminders</h1><p>{data.active.length} waiting · {data.unread} unread · {data.upcoming.length} upcoming · times in {data.tz}</p></div>
    {#if data.unread}<form method="POST" action="?/readAll" use:enhance><button class="btn">Mark all read</button></form>{/if}</header>
  {#if form && 'error' in form && form.error}<div class="alert">{form.error}</div>{/if}
  <form method="POST" action="?/create" use:enhance class="add"><input name="title" placeholder="Remind me to…" required maxlength="200" aria-label="Reminder"><input type="date" name="date" required aria-label="Date"><input type="time" name="time" required aria-label="Time"><button class="btn">Add</button></form>

  <h2>Notifications</h2>
  <section>{#if data.active.length === 0}<div class="empty">Nothing needs your attention.</div>{/if}
    <ul>{#each data.active as r (r.id)}
      <li class:unread={r.unread}>
        <span class="ico">{icon(r.source)}</span>
        <div><strong>{r.title}</strong><small>{when(r.at)}{r.snoozed ? ' · snoozed' : ''}{r.note ? ` · ${r.note}` : ''}{#if r.link} · <a href={r.link}>Open</a>{/if}</small></div>
        <form method="POST" action="?/act" use:enhance class="ops"><input type="hidden" name="id" value={r.id}>
          <button name="op" value="done" title="Mark complete">✓ Done</button>
          <label class="snz"><select name="minutes" aria-label="Snooze for">{#each SNOOZE as [m, l] (m)}<option value={m}>{l}</option>{/each}</select><button name="op" value="snooze">Snooze</button></label>
          <button name="op" value="dismiss">Dismiss</button>
        </form>
      </li>{/each}</ul></section>

  <nav class="tabs"><button type="button" class:on={tab === 'upcoming'} onclick={() => tab = 'upcoming'}>Upcoming<i>{data.upcoming.length}</i></button><button type="button" class:on={tab === 'history'} onclick={() => tab = 'history'}>History<i>{data.history.length}</i></button></nav>
  {#if tab === 'upcoming'}
  <section>{#if data.upcoming.length === 0}<div class="empty">No upcoming reminders. Tasks with a due date and calendar events create them automatically.</div>{/if}
    <ul>{#each data.upcoming as r (r.id)}
      {#if editing === r.id}{@const p = parts(r.original)}
      <li class="edit"><form method="POST" action="?/edit" use:enhance={() => async ({ update }) => { await update(); editing = ''; }}><input type="hidden" name="id" value={r.id}><input name="title" value={r.title} required maxlength="200" aria-label="Reminder"><input type="date" name="date" value={p.date} required aria-label="Date"><input type="time" name="time" value={p.time} required aria-label="Time"><input name="note" value={r.note} placeholder="Note" maxlength="500" aria-label="Note"><button class="btn">Save</button><button type="button" class="btn" onclick={() => editing = ''}>Cancel</button></form></li>
      {:else}
      <li><span class="ico">{icon(r.source)}</span>
        <div><strong>{r.title}</strong><small>{when(r.at)}{r.snoozed ? ' · snoozed' : ''}{r.auto ? ' · automatic' : ''}{r.note ? ` · ${r.note}` : ''}{#if r.link} · <a href={r.link}>Open</a>{/if}</small></div>
        <span class="ops">{#if !r.auto}<button type="button" onclick={() => editing = r.id}>Edit</button>{/if}
          <form method="POST" action="?/act" use:enhance={({ cancel }) => { if (!confirm('Delete this reminder?')) cancel(); }}><input type="hidden" name="id" value={r.id}><button name="op" value={r.auto ? 'dismiss' : 'delete'}>{r.auto ? 'Skip' : 'Delete'}</button></form></span>
      </li>{/if}{/each}</ul></section>
  {:else}
  <section>{#if data.history.length === 0}<div class="empty">No history yet.</div>{/if}
    <ul>{#each data.history as r (r.id)}<li class="past"><span class="ico">{icon(r.source)}</span><div><strong>{r.title}</strong><small>{r.status === 'done' ? 'Completed' : 'Dismissed'}{r.closedAt ? ` ${when(r.closedAt)}` : ''} · was due {when(r.original)}</small></div></li>{/each}</ul></section>
  {/if}
</main>
</AppShell>
<style>
  main{max-width:860px}header{display:flex;gap:16px;align-items:flex-start;margin-bottom:14px}header>div{flex:1}header form{margin:0}h1{margin:0 0 3px;font-size:22px}header p{margin:0;color:#8a95a8;font-size:12px}h2{font-size:14px;margin:18px 0 8px;color:#53607a}
  .alert{padding:9px 14px;border-radius:9px;margin-bottom:10px;font-size:13px;background:#fff0f1;color:#a5414d}
  .add,.edit form{display:flex;gap:8px;flex-wrap:wrap}.add input,.edit input{border:1px solid #e4e9f2;border-radius:10px;padding:9px 11px;font-size:13px;background:#fff;min-width:0}.add input[name=title],.edit input[name=title]{flex:1;min-width:160px}
  .btn{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:8px 13px;color:#43516c;font-weight:700;cursor:pointer;font-size:13px}.btn:hover{border-color:#8da2f0}
  section{background:#fff;border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}ul{list-style:none;margin:0;padding:0}
  li{display:grid;grid-template-columns:26px 1fr auto;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid #eef0f5;font-size:13px}li:first-child{border-top:0}li.edit{display:block}li form{margin:0}
  li.unread{background:#fbfcff}li.unread strong{font-weight:800}li.past strong{color:#8a95a8;font-weight:600}
  .ico{color:#7c4dde;font-size:16px;text-align:center}li div{display:grid;min-width:0}strong{font-weight:600}small{color:#8a95a8;font-size:11px}small a{color:#3157de;text-decoration:none;font-weight:700}
  .ops{display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.ops button{border:1px solid #e4e9f2;background:#fff;border-radius:6px;padding:3px 9px;font-size:11px;font-weight:700;color:#53607a;cursor:pointer}.ops button:hover{border-color:#8da2f0;color:#3157de}
  .snz{display:inline-flex;gap:3px}.snz select{border:1px solid #e4e9f2;border-radius:6px;font-size:11px;padding:2px;background:#fff;color:#53607a}
  .tabs{display:flex;gap:6px;margin:18px 0 8px}.tabs button{display:inline-flex;gap:7px;align-items:center;padding:6px 11px;border-radius:9px;background:#fff;border:1px solid #e4e9f2;font-size:13px;font-weight:700;color:#53607a;cursor:pointer}.tabs button.on{background:#3157de;border-color:#3157de;color:#fff}
  .tabs i{font-style:normal;font-size:11px;background:#f0f2f7;color:#5b6a86;border-radius:99px;padding:1px 7px}.tabs .on i{background:#ffffff33;color:#fff}
  .empty{padding:26px;text-align:center;color:#8c96a8;font-size:13px}
  @media(max-width:640px){li{grid-template-columns:26px 1fr}.ops{grid-column:2;justify-content:flex-start}}
</style>
