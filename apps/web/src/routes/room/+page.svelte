<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import EventForm from '$lib/components/EventForm.svelte';
  import { startAutoSync } from '$lib/sync';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  type Booking = (typeof data.bookings)[number];
  let form = $state<{ date: string; startTime?: string; existing?: Booking } | null>(null);
  let now = $state(Date.now());
  // Bookings stay current like the Calendar (auto sync on open and every 2 minutes while visible).
  onMount(() => { const auto = startAutoSync(() => ({}), () => invalidateAll(), '/calendar/live'); void auto.run(); const t = setInterval(() => (now = Date.now()), 30_000); return () => { auto.stop(); clearInterval(t); }; });

  const dayOf = (b: Booking) => (b.allDay ? b.start.slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: data.tz }).format(new Date(b.start)));
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { timeZone: data.tz, hour: 'numeric', minute: '2-digit' });
  const label = (d: string) => d === data.today ? 'Today' : new Date(`${d}T12:00:00Z`).toLocaleDateString([], { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
  const timed = $derived(data.bookings.filter((b) => !b.allDay));
  const current = $derived(timed.find((b) => Date.parse(b.start) <= now && Date.parse(b.end) > now));
  const next = $derived(timed.find((b) => Date.parse(b.start) > now));
  const days = $derived.by(() => { const out: string[] = []; for (let i = 0; i < 14; i++) { const d = new Date(`${data.today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); out.push(d.toISOString().slice(0, 10)); } return out; });
  const byDay = $derived(Object.fromEntries(days.map((d) => [d, data.bookings.filter((b) => dayOf(b) === d)])));
  const mins = (ms: number) => { const m = Math.round(ms / 60_000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`; };
  // Free hour slots today, 8 AM–6 PM in the owner's zone, from the next whole hour on.
  const hourIn = (ms: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: data.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Number(p.hour) + Number(p.minute) / 60; };
  const freeToday = $derived.by(() => {
    if (!data.selected) return [];
    const today = (byDay[data.today] || []).filter((b) => !b.allDay).map((b) => ({ s: dayOf(b) === data.today ? hourIn(Date.parse(b.start)) : 0, e: hourIn(Date.parse(b.end)) || 24 }));
    const slots: string[] = [];
    for (let h = Math.max(8, Math.ceil(hourIn(now))); h < 18; h++) if (!today.some((b) => b.s < h + 1 && b.e > h)) slots.push(`${String(h).padStart(2, '0')}:00`);
    return slots;
  });
</script>

<svelte:head><title>Conference Room · AadOS</title></svelte:head>
<AppShell title="Conference Room">
<main>
  <header class="head"><h1>Conference Room</h1>
    <form method="POST" action="?/pick" use:enhance={() => async ({ update }) => { await update({ reset: false }); }} class="pick">
      <label>Calendar <select name="id" value={data.selected?.id || ''} onchange={(e) => e.currentTarget.form?.requestSubmit()}><option value="">Choose a calendar…</option>{#each data.calendars as c (c.id)}<option value={c.id}>{c.name} · {c.account}</option>{/each}</select></label>
    </form>
    <span class="sp"></span>{#if data.selected?.writable}<button class="primary" onclick={() => (form = { date: data.today })}>＋ Book the room</button>{:else if data.selected}<small class="muted">Read-only calendar — <a href="/settings/emails">Allow calendar editing</a> to book from here</small>{/if}
  </header>
  {#if !data.calendars.length}<div class="empty">No calendars yet. <a href="/settings/emails">Turn on Calendar</a> for the account that has the room (e.g. a Zoho group calendar).</div>
  {:else if !data.selected}<div class="empty">Pick the calendar that holds the room's bookings.</div>
  {:else}
    <section class="status" class:busy={Boolean(current)}>
      {#if current}<b>In use</b><span>until {time(current.end)} · {current.title}{current.organizer ? ` · ${current.organizer}` : ''}</span><small>{mins(Date.parse(current.end) - now)} left</small>
      {:else}<b>Free now</b><span>{next ? `Next: ${dayOf(next) === data.today ? '' : `${label(dayOf(next))} `}${time(next.start)} – ${time(next.end)} · ${next.title}` : 'Nothing booked in the next 14 days'}</span>{#if next && dayOf(next) === data.today}<small>free for {mins(Date.parse(next.start) - now)}</small>{/if}{/if}
    </section>
    {#if data.selected.writable && freeToday.length}<div class="slots"><small class="muted">Free today:</small>{#each freeToday as s (s)}<button class="slot" onclick={() => (form = { date: data.today, startTime: s })}>{Number(s.slice(0, 2)) % 12 || 12} {Number(s.slice(0, 2)) < 12 ? 'AM' : 'PM'}</button>{/each}</div>{/if}
    <div class="days">{#each days as d (d)}{@const list = byDay[d] || []}{#if list.length || d === data.today}
      <section class="day" class:today={d === data.today}><h2>{label(d)}{#if data.selected.writable}<button class="link" onclick={() => (form = { date: d })}>＋</button>{/if}</h2>
        {#each list as b (b.key)}<button class="booking" class:past={!b.allDay && Date.parse(b.end) < now} class:now={current?.key === b.key} onclick={() => data.selected?.writable && (form = { date: d, existing: b })}><time>{b.allDay ? 'All day' : `${time(b.start)} – ${time(b.end)}`}</time><b>{b.title}</b>{#if b.organizer || b.location}<small>{[b.organizer, b.location].filter(Boolean).join(' · ')}</small>{/if}{#if b.recurring}<small>↻ repeats</small>{/if}</button>{:else}<p class="muted">No bookings.</p>{/each}
      </section>{/if}{/each}</div>
    <small class="muted">{data.bookings.length} booking(s) in the next 14 days · {data.selected.name} ({data.selected.account}){data.lastSync ? ` · synced ${new Date(data.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</small>
  {/if}
  {#if form && data.selected}<EventForm calendars={data.calendars} tz={data.tz} date={form.date} calendar={data.selected.id} startTime={form.startTime} existing={form.existing ? { eventId: form.existing.eventId, calendarId: form.existing.calendarId, title: form.existing.title, start: form.existing.start, end: form.existing.end, allDay: form.existing.allDay, location: form.existing.location, rawDescription: form.existing.rawDescription, recurring: form.existing.recurring } : null} onclose={() => (form = null)} onsaved={() => invalidateAll()} />{/if}
</main>
</AppShell>

<style>
  main{color:#29344c;font-size:13px;max-width:1000px}.head{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:12px}h1{margin:0;font-size:22px}.sp{flex:1}.muted{color:#8a95a8}
  .pick label{display:flex;gap:8px;align-items:center;font-weight:600;color:#53607a}select{border:1px solid #d9dfeb;border-radius:8px;padding:6px 9px;font:inherit;min-width:260px}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:6px 12px;font-weight:700;color:#43516c;cursor:pointer;font-size:12px}.primary{background:#3157de;border-color:#3157de;color:#fff}.link{border:0;background:none;color:#3157de;padding:0 4px;font-size:15px}
  .empty{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:18px}.empty a,a{color:#3157de;font-weight:600}
  .status{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;background:#e9f7ef;border:1px solid #c9ead6;border-radius:14px;padding:14px 16px;margin-bottom:10px}.status b{font-size:20px;color:#1e7a47}.status.busy{background:#fdeceb;border-color:#f3c9c6}.status.busy b{color:#c0392b}.status small{color:#6b7690}
  .slots{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.slot{border-radius:999px;padding:4px 10px;background:#eef3ff;border-color:#cfdcff;color:#2f4fa8}
  .days{display:grid;gap:10px;margin-bottom:10px}.day{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:10px 14px}.day.today{border-color:#8da2f0}.day h2{margin:0 0 6px;font-size:13px;display:flex;justify-content:space-between;align-items:center}
  .booking{display:grid;grid-template-columns:150px 1fr;gap:2px 10px;width:100%;text-align:left;border:0;border-left:3px solid #3157de;border-radius:6px;background:#f7f8fb;padding:7px 10px;margin:4px 0;font-weight:500}.booking b{color:#1f2a44}.booking small{grid-column:2;color:#8a95a8}.booking time{color:#53607a;font-weight:700}
  .booking.past{opacity:.5}.booking.now{border-left-color:#c0392b;background:#fdf3f2}
  @media(max-width:600px){.booking{grid-template-columns:1fr}.booking small{grid-column:1}select{min-width:0}}
</style>
