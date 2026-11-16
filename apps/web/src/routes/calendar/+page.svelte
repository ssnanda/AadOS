<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const dayOf = (it: { start: string; allDay: boolean }) => it.allDay ? it.start : new Date(it.start).toLocaleDateString('en-CA');
  const groups = $derived(Object.entries(data.items.reduce<Record<string, typeof data.items>>((m, it) => { (m[dayOf(it)] ||= []).push(it); return m; }, {})));
  const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const time = (it: { start: string; end: string; allDay: boolean }) => it.allDay ? 'All day' : `${new Date(it.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(it.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
</script>
<svelte:head><title>Calendar · AadOS</title></svelte:head>
<AppShell title="Calendar">
<main>
  <header><h1>Calendar</h1><p>Next {data.days} days · read-only · {data.calendars} calendar{data.calendars === 1 ? '' : 's'}</p></header>
  {#if data.calendars === 0}<div class="empty">No calendars connected. Google and Zoho calendars need extra read-only permission on your existing accounts, which has not been granted yet.</div>
  {:else if groups.length === 0}<div class="empty">No events in the next {data.days} days.</div>
  {:else}{#each groups as [day, list] (day)}<h2>{label(day)}</h2><section><ul>{#each list as it (it.key)}<li><time>{time(it)}</time><div><strong>{it.title}{#if it.tentative} <em>(tentative)</em>{/if}</strong>{#if it.location}<small>{it.location}</small>{/if}</div><span class="cal {it.provider}">{it.calendar}</span></li>{/each}</ul></section>{/each}{/if}
</main>
</AppShell>
<style>
  main{max-width:800px}header{margin-bottom:14px}h1{margin:0 0 3px;font-size:22px}header p{margin:0;color:#8a95a8;font-size:12px}h2{font-size:13px;margin:18px 0 8px;color:#53607a}
  section{background:#fff;border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}ul{list-style:none;margin:0;padding:0}
  li{display:grid;grid-template-columns:130px 1fr auto;gap:12px;align-items:center;padding:10px 14px;border-top:1px solid #eef0f5;font-size:13px}li:first-child{border-top:0}
  time{font-size:12px;font-weight:700;color:#53607a}li div{display:grid;min-width:0}strong{font-weight:600}em{font-style:normal;color:#8a95a8;font-weight:400}small{color:#8a95a8;font-size:11px}
  .cal{font-size:10px;font-weight:800;border-radius:6px;padding:2px 7px;background:#fff0ee;color:#d94d43}.cal.zoho{background:#eef1ff;color:#3157de}
  .empty{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:35px;text-align:center;color:#8c96a8}
  @media(max-width:600px){li{grid-template-columns:1fr}}
</style>
