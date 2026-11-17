<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import { startAutoSync } from '$lib/sync';
  import EventForm from '$lib/components/EventForm.svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  // Calendars sync automatically (on open, every 2 minutes while visible), like email.
  onMount(() => { if (!data.enabled) return; const auto = startAutoSync(() => ({}), () => invalidateAll(), '/calendar/live'); void auto.run(); return () => auto.stop(); });
  let openRef = $state('');
  // Event form: null = closed; `existing` = editing that event.
  let eventForm = $state<{ date: string; existing?: NonNullable<typeof detail> } | null>(null);
  const detail = $derived(openRef ? data.details[openRef] : null);

  // Every link keeps the other filters, so navigation never loses the current view.
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    const merged: Record<string, string> = { view: data.view, date: data.date, account: data.account, off: data.off.join(','), ...over };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === 'view' && v === 'month') && !(k === 'date' && v === data.today)) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : '?';
  };
  const toggleOff = (id: string) => (data.off.includes(id) ? data.off.filter((x) => x !== id) : [...data.off, id]).join(',');
  const VIEWS = [['month', 'Month'], ['week', 'Week'], ['day', 'Day'], ['agenda', 'Agenda']] as const;
  const noon = (d: string) => new Date(`${d}T12:00:00Z`);
  const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => noon(d).toLocaleDateString([], { timeZone: 'UTC', ...o });
  const title = $derived(data.view === 'month' ? fmtDay(data.date, { month: 'long', year: 'numeric' })
    : data.view === 'day' ? fmtDay(data.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : `${fmtDay(data.days[0].date, { month: 'short', day: 'numeric' })} – ${fmtDay(data.days[data.days.length - 1].date, { month: 'short', day: 'numeric', year: 'numeric' })}`);
  const time = (iso: string, tz = data.tz) => new Date(iso).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const weekdays = $derived(data.days.slice(0, 7).map((d) => fmtDay(d.date, { weekday: 'short' })));
  const span = (d: NonNullable<typeof detail>) => d.allDay
    ? (d.end > d.start && noon(d.end).getTime() - noon(d.start).getTime() > 86_400_000 ? `${fmtDay(d.start, { weekday: 'short', month: 'short', day: 'numeric' })} – ${fmtDay(new Date(noon(d.end).getTime() - 86_400_000).toISOString().slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })} · all day` : `${fmtDay(d.start, { weekday: 'long', month: 'long', day: 'numeric' })} · all day`)
    : `${new Date(d.start).toLocaleDateString([], { timeZone: data.tz, weekday: 'long', month: 'long', day: 'numeric' })} · ${time(d.start)} – ${time(d.end)}${new Date(d.start).toLocaleDateString('en-CA', { timeZone: data.tz }) !== new Date(d.end).toLocaleDateString('en-CA', { timeZone: data.tz }) ? ` (${new Date(d.end).toLocaleDateString([], { timeZone: data.tz, month: 'short', day: 'numeric' })})` : ''}`;
  const label = (i: { allDay: boolean; start: string; part: string }) => i.allDay ? '' : i.part === 'end' ? '→' : time(i.start);
  const listDays = $derived(data.view === 'agenda' ? data.days.filter((d) => d.items.length) : data.days);
</script>
<svelte:head><title>Calendar · AadOS</title></svelte:head>
<AppShell title="Calendar">
<main>
  <header>
    <div><h1>{title}</h1><p>{data.total} event{data.total === 1 ? '' : 's'}{data.canEditAny ? '' : ' · read-only'} · {data.tz}{#if data.lastSync} · synced {new Date(data.lastSync).toLocaleString()}{/if}</p></div>
  </header>
  {#if data.canEditAny}<button type="button" class="btn newev" onclick={() => (eventForm = { date: data.date })}>＋ New event</button>{:else if data.enabled}<a class="btn" href="/settings/emails" title="Grant AadOS permission to add and edit events">Allow calendar editing</a>{/if}
  {#each data.errors as e (e.id)}<div class="alert">{e.label}: {e.message} · <a href="/settings/emails#acct-{e.id}">Settings</a></div>{/each}

  <div class="bar">
    <a class="btn" href={href({ date: data.today })}>Today</a>
    <a class="btn nav" href={href({ date: data.prev })} aria-label="Previous">‹</a><a class="btn nav" href={href({ date: data.next })} aria-label="Next">›</a>
    <nav class="views" aria-label="Calendar views">{#each VIEWS as [v, l] (v)}<a class:on={data.view === v} href={href({ view: v })}>{l}</a>{/each}</nav>
  </div>
  {#if data.calendars.length}<div class="filters">
    {#if data.accounts.length > 1}<a class="chip" class:on={!data.account} href={href({ account: '' })}>All accounts</a>{#each data.accounts as a (a.id)}<a class="chip" class:on={data.account === a.id} href={href({ account: data.account === a.id ? '' : a.id })}>{a.label}</a>{/each}<span class="sep"></span>{/if}
    {#each data.calendars.filter((c) => c.syncing && (!data.account || c.accountId === data.account)) as c (c.id)}<a class="chip cal" class:offc={!c.shown} href={href({ off: toggleOff(c.id) })} title={c.shown ? 'Hide' : 'Show'}><i style="background:{c.color}"></i>{c.name}</a>{/each}
    <a class="manage" href="/settings/emails">Manage calendars</a>
  </div>{/if}

  {#if data.enabled === 0}<div class="empty">No calendar access yet. <a href="/settings/emails">Enable calendar</a> on a Google or Zoho account in Settings to see and edit your events here.</div>
  {:else if data.calendars.length === 0}<div class="empty">Calendar access is on. Your events load automatically.</div>
  {:else if data.view === 'month'}
    <div class="month" role="grid" aria-label={title}>
      {#each weekdays as w (w)}<div class="wd">{w}</div>{/each}
      {#each data.days as d (d.date)}
        <div class="cell" class:out={!d.inMonth} class:today={d.isToday}>
          <a class="num" href={href({ view: 'day', date: d.date })} aria-label={fmtDay(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}>{Number(d.date.slice(8))}</a>{#if data.canEditAny}<button type="button" class="add" title="New event on this day" aria-label="New event on this day" onclick={() => (eventForm = { date: d.date })}>＋</button>{/if}
          {#each d.items.slice(0, 3) as i (i.key)}<button type="button" class="ev" class:block={i.allDay} style="--c:{i.color}" onclick={() => openRef = i.ref}>{#if !i.allDay}<i></i><em>{label(i)}</em>{/if}<span>{i.title}</span></button>{/each}
          {#if d.items.length > 3}<a class="more" href={href({ view: 'day', date: d.date })}>+{d.items.length - 3} more</a>{/if}
          {#if d.items.length}<a class="dots" href={href({ view: 'day', date: d.date })} aria-label="{d.items.length} events">{#each d.items.slice(0, 4) as i (i.key)}<i style="background:{i.color}"></i>{/each}</a>{/if}
        </div>
      {/each}
    </div>
  {:else if data.view === 'week'}
    <div class="week">{#each data.days as d (d.date)}
      <div class="col" class:today={d.isToday}><a class="colh" href={href({ view: 'day', date: d.date })}><span>{fmtDay(d.date, { weekday: 'short' })}</span><b>{Number(d.date.slice(8))}</b></a>
        {#each d.items as i (i.key)}<button type="button" class="ev wk" class:block={i.allDay} style="--c:{i.color}" onclick={() => openRef = i.ref}>{#if !i.allDay}<em>{label(i)}</em>{/if}<span>{i.title}</span></button>{/each}
        {#if !d.items.length}<p class="none">—</p>{/if}</div>{/each}</div>
  {:else}
    {#if listDays.length === 0}<div class="empty">No events in this period.</div>{/if}
    {#each listDays as d (d.date)}
      <h2 class:todayh={d.isToday}>{fmtDay(d.date, { weekday: 'long', month: 'short', day: 'numeric' })}{d.isToday ? ' · Today' : ''}</h2>
      <section>{#if !d.items.length}<p class="none pad">No events.</p>{/if}<ul>{#each d.items as i (i.key)}{@const x = data.details[i.ref]}
        <li><button type="button" class="row" onclick={() => openRef = i.ref}><time>{i.allDay ? 'All day' : i.part === 'end' ? `until ${time(x.end)}` : `${time(i.start)}${i.part === 'single' ? ` – ${time(x.end)}` : ' →'}`}</time><span class="t"><i style="background:{i.color}"></i><strong>{i.title}{#if x.recurring} <span class="rec" title={x.recurrence || 'Repeats'}>↻</span>{/if}{#if x.tentative} <em>(tentative)</em>{/if}</strong>{#if x.location}<small>{x.location}</small>{/if}</span><span class="cal">{x.calendar}</span></button></li>{/each}</ul></section>
    {/each}
  {/if}
</main>

{#if detail}
  <div class="backdrop" role="presentation" onclick={() => openRef = ''}></div>
  <aside class="panel" aria-label="Event details">
    <header><div><h3><i style="background:{detail.color}"></i>{detail.title}</h3><p>{span(detail)}</p></div>{#if detail.writable}<button type="button" class="btn" onclick={() => (eventForm = { date: data.date, existing: detail })}>✎ Edit</button>{/if}<button type="button" class="btn" onclick={() => openRef = ''}>✕</button></header>
    <dl>
      {#if detail.recurring}<dt>Repeats</dt><dd>↻ {detail.recurrence || 'Recurring event'}</dd>{/if}
      {#if !detail.allDay && detail.timeZone && detail.timeZone !== data.tz}<dt>Event time zone</dt><dd>{time(detail.start, detail.timeZone)} – {time(detail.end, detail.timeZone)} ({detail.timeZone})</dd>{/if}
      {#if detail.meetingUrl}<dt>Meeting</dt><dd><a href={detail.meetingUrl} target="_blank" rel="noreferrer noopener">Join online meeting ↗</a></dd>{/if}
      {#if detail.location}<dt>Location</dt><dd>{detail.location}</dd>{/if}
      {#if detail.organizer}<dt>Organizer</dt><dd>{detail.organizer}</dd>{/if}
      {#if detail.attendees.length}<dt>Attendees ({detail.attendeeCount})</dt><dd><ul class="att">{#each detail.attendees as a (a.email)}<li>{a.name || a.email}{#if a.status} <em>{a.status.replace('needsAction', 'no reply').replace('needs-action', 'no reply')}</em>{/if}</li>{/each}</ul></dd>{/if}
      <dt>Calendar</dt><dd>{detail.calendar} · {detail.provider === 'google' ? 'Google' : 'Zoho'}{detail.tentative ? ' · tentative' : ''}</dd>
      {#if detail.description}<dt>Description</dt><dd class="desc">{detail.description}</dd>{/if}
      <dt>Actions</dt><dd class="acts">
        <form method="POST" action="/tasks?/add"><input type="hidden" name="title" value={detail.title.slice(0, 200)}><input type="hidden" name="due" value={detail.allDay ? detail.start : new Date(detail.start).toLocaleDateString('en-CA', { timeZone: data.tz })}><input type="hidden" name="eventKey" value={openRef}><button class="btn">☑ Add task</button></form>
        {#if !detail.allDay && new Date(detail.start).getTime() > Date.now()}<form method="POST" action="/reminders?/create"><input type="hidden" name="title" value={detail.title.slice(0, 200)}><input type="hidden" name="date" value={new Date(new Date(detail.start).getTime() - 3600_000).toLocaleDateString('en-CA', { timeZone: data.tz })}><input type="hidden" name="time" value={new Date(new Date(detail.start).getTime() - 3600_000).toLocaleTimeString('en-GB', { timeZone: data.tz, hour: '2-digit', minute: '2-digit' })}><button class="btn">◔ Remind me 1 hour before</button></form>{/if}</dd>
      {#if detail.htmlLink}<dt></dt><dd><a href={detail.htmlLink} target="_blank" rel="noreferrer noopener">Open in Google Calendar ↗</a></dd>{/if}
    </dl>
  </aside>
{/if}
</AppShell>
{#if eventForm}<EventForm calendars={data.calendars} tz={data.tz} date={eventForm.date} existing={eventForm.existing ?? null} onclose={() => (eventForm = null)} onsaved={async () => { openRef = ''; await invalidateAll(); }} />{/if}

<style>
  .newev{background:#3157de;border-color:#3157de;color:#fff;margin-bottom:10px}.cell{position:relative}.add{position:absolute;top:4px;right:4px;border:0;background:none;color:#8da2f0;font-size:13px;cursor:pointer;opacity:0;padding:0 4px}.cell:hover .add{opacity:1}.add:hover{color:#3157de}
  main{max-width:1150px}header{display:flex;gap:16px;align-items:flex-start;margin-bottom:12px}header>div{flex:1;min-width:0}h1{margin:0 0 3px;font-size:22px}header p{margin:0;color:#8a95a8;font-size:12px}
  .btn{border:1px solid #d9dfeb;background:#fff;border-radius:9px;padding:7px 12px;color:#43516c;font-weight:700;cursor:pointer;font-size:13px;text-decoration:none;display:inline-block}.btn:hover{border-color:#8da2f0}.btn.nav{padding:7px 11px}
  .alert{padding:9px 14px;border-radius:9px;margin-bottom:10px;font-size:13px}.alert{background:#fff0f1;color:#a5414d}.alert a{color:#a5414d;font-weight:700}
  .bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.views{margin-left:auto;display:inline-flex;background:#fff;border:1px solid #e4e9f2;border-radius:10px;overflow:hidden}.views a{padding:7px 14px;font-size:13px;font-weight:700;color:#53607a;text-decoration:none}.views a.on{background:#3157de;color:#fff}
  .filters{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.chip{display:inline-flex;gap:6px;align-items:center;background:#fff;border:1px solid #e4e9f2;border-radius:99px;padding:4px 10px;font-size:12px;font-weight:700;color:#43516c;text-decoration:none}.chip.on{background:#3157de;border-color:#3157de;color:#fff}
  .chip.cal i{width:9px;height:9px;border-radius:50%}.chip.offc{opacity:.45;text-decoration:line-through}.sep{width:1px;height:18px;background:#e4e9f2;margin:0 4px}.manage{margin-left:auto;font-size:11px;color:#3157de;font-weight:700;text-decoration:none}
  .month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));background:#fff;border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}
  .wd{padding:7px 8px;font-size:10px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#a3adbf;border-bottom:1px solid #eef0f5}
  .cell{min-height:104px;padding:5px;border-top:1px solid #eef0f5;border-left:1px solid #eef0f5;display:flex;flex-direction:column;gap:2px;min-width:0}.cell:nth-child(7n+1){border-left:0}.cell.out{background:#fafbfd}.cell.out .num{color:#b6bfcd}
  .num{align-self:flex-start;font-size:12px;font-weight:700;color:#43516c;text-decoration:none;border-radius:99px;min-width:22px;height:22px;display:grid;place-items:center}.cell.today .num{background:#3157de;color:#fff}
  .ev{--c:#3157de;display:flex;gap:4px;align-items:center;border:0;background:none;padding:1px 3px;border-radius:5px;font:inherit;font-size:11px;color:#29344c;cursor:pointer;text-align:left;min-width:0;width:100%}.ev:hover{background:#f0f2f7}
  .ev i{width:7px;height:7px;border-radius:50%;background:var(--c);flex:none}.ev em{font-style:normal;color:#8a95a8;flex:none;font-size:10px}.ev span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ev.block{background:color-mix(in srgb,var(--c) 16%,#fff);color:color-mix(in srgb,var(--c) 70%,#000);font-weight:700}.ev.block:hover{background:color-mix(in srgb,var(--c) 26%,#fff)}
  .more{font-size:10px;color:#3157de;font-weight:700;text-decoration:none;padding:0 3px}.dots{display:none;gap:3px;justify-content:center;padding-top:2px}.dots i{width:6px;height:6px;border-radius:50%}
  .week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}.col{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:8px;min-height:220px;display:flex;flex-direction:column;gap:4px;min-width:0}.col.today{border-color:#8da2f0}
  .colh{display:flex;justify-content:space-between;align-items:baseline;text-decoration:none;color:#8a95a8;font-size:11px;font-weight:800;text-transform:uppercase;margin-bottom:4px}.colh b{font-size:17px;color:#29344c}.col.today .colh b{color:#3157de}
  .ev.wk{flex-direction:column;align-items:flex-start;gap:0;padding:4px 6px;border-left:3px solid var(--c);border-radius:4px;background:#f7f8fb}.ev.wk span{white-space:normal;font-weight:600}.none{color:#b6bfcd;font-size:12px;margin:0;text-align:center}.none.pad{padding:14px}
  h2{font-size:13px;margin:16px 0 8px;color:#53607a}h2.todayh{color:#3157de}section{background:#fff;border:1px solid #e4e9f2;border-radius:12px;overflow:hidden}ul{list-style:none;margin:0;padding:0}section li{border-top:1px solid #eef0f5}section li:first-child{border-top:0}
  .row{display:grid;grid-template-columns:150px 1fr auto;gap:12px;align-items:center;width:100%;border:0;background:none;padding:10px 14px;font:inherit;font-size:13px;text-align:left;cursor:pointer;color:#29344c}.row:hover{background:#fafbfd}
  .row time{font-size:12px;font-weight:700;color:#53607a}.t{display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:center;min-width:0}.t i{width:9px;height:9px;border-radius:50%}.t strong{font-weight:600}.t small{grid-column:2;color:#8a95a8;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.t em{font-style:normal;color:#8a95a8;font-weight:400}.rec{color:#7c4dde}
  .cal{font-size:10px;font-weight:800;border-radius:6px;padding:2px 7px;background:#f0f2f7;color:#5b6a86}
  .empty{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:35px;text-align:center;color:#8c96a8}.empty a{color:#3157de}
  .backdrop{position:fixed;inset:0;background:#151c2d55;z-index:40}.panel{position:fixed;top:0;right:0;bottom:0;width:min(460px,96vw);background:#fff;z-index:41;display:flex;flex-direction:column;box-shadow:-10px 0 30px #151c2d30;overflow:auto}
  .panel header{padding:16px 18px;border-bottom:1px solid #e4e9f2;margin:0}.panel h3{margin:0;font-size:17px;display:flex;gap:9px;align-items:center}.panel h3 i{width:11px;height:11px;border-radius:50%;flex:none}.panel header p{margin:5px 0 0;font-size:12px;color:#53607a}
  dl{margin:0;padding:14px 18px;display:grid;grid-template-columns:110px 1fr;gap:9px 12px;font-size:13px}dt{color:#8a95a8;font-size:11px;font-weight:700;padding-top:2px}dd{margin:0;min-width:0;word-break:break-word}dd a{color:#3157de;font-weight:700;text-decoration:none}
  .acts{display:flex;gap:6px;flex-wrap:wrap}.acts form{margin:0}.acts .btn{font-size:12px;padding:5px 10px}
  .desc{white-space:pre-wrap;color:#43516c;font-size:12px}.att{display:grid;gap:3px}.att em{font-style:normal;color:#8a95a8;font-size:11px}
  @media(max-width:760px){.views{margin-left:0;width:100%}.views a{flex:1;text-align:center}.cell{min-height:58px;padding:3px}.cell .ev,.cell .more{display:none}.dots{display:flex}.week{grid-template-columns:1fr}.col{min-height:0}.row{grid-template-columns:1fr auto}.row time{grid-column:1/-1}dl{grid-template-columns:1fr}dt{padding-top:6px}}
</style>
