<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import { startAutoSync } from '$lib/sync';
  import { freeWindows, greeting, rankAttention, SOURCE_META, type Attention, type AttentionSource } from '$lib/attention';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  // ── Clock (drives the countdown, now-line and greeting) and live data (same auto sync as Emails).
  let now = $state(Date.now());
  onMount(() => {
    const auto = startAutoSync(() => ({}), () => invalidateAll()); void auto.run();
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => { auto.stop(); clearInterval(t); };
  });
  const hourIn = (ms: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: data.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Number(p.hour) + Number(p.minute) / 60; };
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { timeZone: data.tz, hour: 'numeric', minute: '2-digit' });
  const hourLabel = (h: number) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${hh % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${hh < 12 || hh === 24 ? 'AM' : 'PM'}`; };
  const dur = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
  const ago = (iso?: string) => { if (!iso) return ''; const m = Math.round((now - Date.parse(iso)) / 60_000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
  const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const dateLine = $derived(new Date(now).toLocaleDateString([], { timeZone: data.tz, weekday: 'long', month: 'long', day: 'numeric' }));
  const hello = $derived(`${greeting(Math.floor(hourIn(now)))}${data.greetingName ? `, ${data.greetingName.split(' ')[0].replace(/^./, (c) => c.toUpperCase())}` : ''}`);

  // ── Needs your attention: synchronous items now, Messages / Asana / Finance merged as they stream in.
  let msgItems = $state<Attention[] | null>(null), asanaItems = $state<Attention[] | null>(null), fin = $state<Awaited<NonNullable<PageData['finance']>>>(null);
  let pending = $state<string[]>([]);
  $effect(() => {
    const m = data.messages, a = data.asana, f = data.finance;
    pending = [m && 'Messages', a && 'Asana', f && 'Finance'].filter(Boolean) as string[];
    const done = (name: string) => (pending = pending.filter((x) => x !== name));
    if (m) void m.then((x) => { msgItems = x; done('Messages'); }); else msgItems = null;
    if (a) void a.then((x) => { asanaItems = x?.attention ?? null; done('Asana'); }); else asanaItems = null;
    if (f) void f.then((x) => { fin = x; done('Finance'); }); else fin = null;
  });
  // "Done for now" hides an item until tomorrow (this browser only).
  const SNOOZE = 'aados.dashboard.snoozed';
  let snoozed = $state<Record<string, string>>({});
  onMount(() => { try { const all = JSON.parse(localStorage.getItem(SNOOZE) || '{}') as Record<string, string>; snoozed = Object.fromEntries(Object.entries(all).filter(([, d]) => d >= data.calendar.today)); } catch { snoozed = {}; } });
  function snooze(id: string) { snoozed = { ...snoozed, [id]: data.calendar.today }; try { localStorage.setItem(SNOOZE, JSON.stringify(snoozed)); } catch { /* private window */ } }
  const ranked = $derived(rankAttention(data.attention as Attention[], msgItems, asanaItems, fin?.attention as Attention[] | undefined).filter((a) => snoozed[a.id] !== data.calendar.today));
  let filter = $state<AttentionSource | ''>('');
  let showAll = $state(false);
  const sources = $derived((Object.keys(SOURCE_META) as AttentionSource[]).map((s) => ({ s, n: ranked.filter((a) => a.source === s).length })).filter((x) => x.n));
  const shown = $derived(ranked.filter((a) => !filter || a.source === filter));
  const urgent = $derived(ranked.filter((a) => a.score >= 80).length);
  const band = (score: number) => (score >= 80 ? 'now' : score >= 60 ? 'today' : 'look');

  // ── Today: up next, timeline with focus windows, week strip.
  type Ev = PageData['calendar']['todayEvents'][number];
  const timed = $derived(data.calendar.todayEvents.filter((e) => !e.allDay));
  const allDay = $derived(data.calendar.todayEvents.filter((e) => e.allDay));
  const current = $derived(timed.find((e) => Date.parse(e.start) <= now && Date.parse(e.end) > now));
  const upNext = $derived(timed.find((e) => Date.parse(e.start) > now) ?? (data.calendar.next && Date.parse(data.calendar.next.start) > now ? data.calendar.next : null));
  const startH = 7, endH = 21;
  const busy = $derived(timed.map((e) => ({ s: new Intl.DateTimeFormat('en-CA', { timeZone: data.tz }).format(new Date(e.start)) < data.calendar.today ? 0 : hourIn(Date.parse(e.start)), e: hourIn(Date.parse(e.end)) || 24 })));
  const focus = $derived(freeWindows(busy, Math.max(startH, Math.ceil(hourIn(now) * 2) / 2), endH, 60).filter((w) => w.s < 18));
  type Slot = { kind: 'event'; e: Ev } | { kind: 'free'; s: number; e: number } | { kind: 'now' };
  const timeline = $derived.by(() => {
    const out: (Slot & { at: number })[] = [
      ...timed.map((e) => ({ kind: 'event' as const, e, at: hourIn(Date.parse(e.start)) })),
      ...focus.map((w) => ({ kind: 'free' as const, s: w.s, e: w.e, at: w.s })),
      { kind: 'now' as const, at: hourIn(now) }
    ];
    return out.sort((a, b) => a.at - b.at || (a.kind === 'now' ? -1 : 1));
  });
  const weekMax = $derived(Math.max(1, ...data.calendar.week.map((d) => d.count)));
  const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString([], { timeZone: 'UTC', weekday: 'short' });
  const spark = (v: number[]) => { if (v.length < 2) return ''; const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1; return v.map((x, i) => `${((i / (v.length - 1)) * 120).toFixed(1)},${(28 - ((x - lo) / r) * 26).toFixed(1)}`).join(' '); };

  // ── AI briefing (unchanged behaviour, now a collapsible strip).
  let briefing = $state<any>(null);
  let briefBusy = $state(false), briefError = $state(''), briefOpen = $state(false), srcOpen = $state(false);
  $effect(() => { briefing = data.briefing.cached ? { ...data.briefing.cached.content, generatedAt: data.briefing.cached.generatedAt, provider: data.briefing.cached.provider, model: data.briefing.cached.model } : null; });
  async function refreshBriefing() {
    briefBusy = true; briefError = ''; briefOpen = true;
    try { const res = await fetch('/briefing', { method: 'POST' }); const body = await res.json(); if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`); briefing = { ...body, generatedAt: new Date().toISOString() }; }
    catch (e) { briefError = e instanceof Error ? e.message : 'Failed.'; } finally { briefBusy = false; }
  }
  const escB = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const renderB = (b: any) => escB(b.summary || '').replace(/\[(S\d+)\]/g, (m: string, id: string) => { const s = (b.sources || []).find((x: any) => x.id === id); return s ? `<a class="cite" href="${escB(s.href)}" title="${escB(s.title)}">${id}</a>` : ''; }).replace(/\n/g, '<br>');
  const icon = (parser: string) => parser === 'shop' ? '🛍' : parser === 'health' ? '♡' : '✉';
</script>

<svelte:head><title>Dashboard · AadOS</title></svelte:head>
<AppShell title="Dashboard">
<div class="dash">
  <!-- Hero: who/when, the one-line pulse, what's next, money pulse -->
  <section class="hero">
    <div class="hi">
      <small>{dateLine}</small>
      <h1>{hello}</h1>
      <p class="pulse">{#if ranked.length}{#if urgent}<b class="hot">{urgent} need{urgent === 1 ? 's' : ''} you now</b> · {/if}{ranked.length} thing{ranked.length === 1 ? '' : 's'} worth your attention{:else if pending.length}Checking {pending.join(', ')}…{:else}<b class="calm">You're all caught up.</b> Nothing needs you right now.{/if}</p>
      <div class="chips">
        {#if data.inbox.unread}<a href="/emails">✉ <b>{data.inbox.unread}</b> unread</a>{/if}
        {#if data.inbox.needsReply}<a href="/emails?view=needs-reply">↩ <b>{data.inbox.needsReply}</b> to reply</a>{/if}
        {#if msgItems?.length}<a href="/messages">💬 <b>{msgItems.length}</b> texts</a>{/if}
        {#if data.brief.tasksOverdue.length + data.brief.tasksToday.length}<a href="/tasks?f=today">☑ <b>{data.brief.tasksOverdue.length + data.brief.tasksToday.length}</b> tasks</a>{/if}
        {#if data.reminders.waiting}<a href="/reminders">◔ <b>{data.reminders.waiting}</b> reminders</a>{/if}
      </div>
      <div class="quick"><a href="/calendar">＋ Event</a><a href="/tasks">＋ Task</a><a href="/reminders">＋ Reminder</a><a href="/messages">＋ Text</a></div>
    </div>
    <div class="side">
      <div class="next" class:live={Boolean(current)}>
        {#if current}<small>Happening now · ends {time(current.end)}</small><b>{current.title}</b><span>{dur(Date.parse(current.end) - now)} left{current.location ? ` · ${current.location}` : ''}</span>
        {:else if upNext}<small>Up next · {Date.parse(upNext.start) - now < 86_400_000 ? `in ${dur(Date.parse(upNext.start) - now)}` : new Date(upNext.start).toLocaleDateString([], { timeZone: data.tz, weekday: 'short', month: 'short', day: 'numeric' })}</small><b>{upNext.title}</b><span>{upNext.allDay ? 'All day' : `${time(upNext.start)} – ${time(upNext.end)}`}{upNext.location ? ` · ${upNext.location}` : ''}</span>
        {:else if data.calendar.enabled}<small>Calendar</small><b>Clear schedule</b><span>Nothing coming up.</span>
        {:else}<small>Calendar</small><b>Not connected</b><a href="/settings/emails">Turn on Calendar</a>{/if}
      </div>
      {#if fin}<a class="money" href="/finance"><small>Net worth</small><b>{money(fin.netWorth)}</b>
        <span class:up={fin.dayChange > 0} class:down={fin.dayChange < 0}>{fin.dayChange >= 0 ? '▲' : '▼'} {money(Math.abs(fin.dayChange))} ({Math.abs(fin.dayPct).toFixed(2)}%) today</span>
        {#if fin.spark.length > 1}<svg viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={spark(fin.spark)} /></svg>{/if}</a>{/if}
    </div>
  </section>

  <div class="grid">
    <!-- Ranked attention list -->
    <section class="card attn">
      <header><h2>Needs your attention</h2>{#if pending.length}<small class="muted">checking {pending.join(' · ')}…</small>{/if}</header>
      {#if sources.length > 1}<div class="filters"><button class:on={!filter} onclick={() => (filter = '')}>All {ranked.length}</button>{#each sources as x (x.s)}<button class:on={filter === x.s} onclick={() => (filter = filter === x.s ? '' : x.s)} style="--c:{SOURCE_META[x.s].color}">{SOURCE_META[x.s].icon} {SOURCE_META[x.s].label} {x.n}</button>{/each}</div>{/if}
      {#if shown.length}<ul>
        {#each shown.slice(0, showAll ? 60 : 9) as a (a.id)}
          <li class={band(a.score)} style="--c:{SOURCE_META[a.source].color}">
            <span class="ico" title={SOURCE_META[a.source].label}>{SOURCE_META[a.source].icon}</span>
            <a class="body" href={a.href} target={a.external ? '_blank' : undefined} rel={a.external ? 'noreferrer' : undefined}><b>{a.title}</b><span>{a.why}</span></a>
            {#if a.at}<time>{ago(a.at)}</time>{/if}
            <button class="done" title="Done for now — hide until tomorrow" onclick={() => snooze(a.id)}>✓</button>
          </li>
        {/each}
      </ul>
      {#if shown.length > 9}<button class="more" onclick={() => (showAll = !showAll)}>{showAll ? 'Show less' : `Show ${shown.length - 9} more`}</button>{/if}
      {:else if !pending.length}<div class="zero"><span>✨</span><b>Inbox zero, life edition.</b><small>No replies, bills, tasks or texts waiting.</small></div>
      {:else}<p class="muted">Loading…</p>{/if}
    </section>

    <!-- Today: timeline with free focus windows -->
    <section class="card today">
      <header><h2><a href="/calendar?view=day">Today</a></h2><small class="muted">{timed.length} event{timed.length === 1 ? '' : 's'}{focus.length ? ` · ${dur(focus.reduce((t, w) => t + (w.e - w.s) * 3_600_000, 0))} free` : ''}</small></header>
      {#each allDay as e (e.key)}<div class="allday">{e.title}</div>{/each}
      {#if timed.length || focus.length}<ol class="tl">
        {#each timeline as x, i (x.kind === 'event' ? x.e.key : `${x.kind}-${i}`)}
          {#if x.kind === 'now'}<li class="nowline"><span>{time(new Date(now).toISOString())}</span></li>
          {:else if x.kind === 'free'}<li class="free"><time>{hourLabel(x.s)}</time><span>Free until {hourLabel(x.e)} · {dur((x.e - x.s) * 3_600_000)} for focus</span></li>
          {:else}<li class="ev" class:past={Date.parse(x.e.end) < now} class:on={current?.key === x.e.key}><time>{time(x.e.start)}</time><span><b>{x.e.title}</b>{#if x.e.location || x.e.calendar}<small>{[x.e.location, x.e.calendar].filter(Boolean).join(' · ')}</small>{/if}</span></li>{/if}
        {/each}
      </ol>{:else}<p class="muted">{data.calendar.enabled ? 'Nothing scheduled — the day is yours.' : 'Calendar not connected.'}</p>{/if}
      {#if data.calendar.week.length}<a class="week" href="/calendar?view=week" title="Next 7 days">
        {#each data.calendar.week as d (d.date)}<span class:td={d.date === data.calendar.today}><i style="height:{4 + (d.count / weekMax) * 26}px" class:none={!d.count}></i><small>{dayName(d.date)}</small><em>{d.count || ''}</em></span>{/each}
      </a>{/if}
      {#if data.reminders.items.length}<div class="rems"><h3><a href="/reminders">Reminders</a></h3>{#each data.reminders.items as r (r.id)}<div class:late={r.fired}><span>{r.title}</span><time>{new Date(r.at).toLocaleString([], { timeZone: data.tz, weekday: 'short', hour: 'numeric', minute: '2-digit' })}</time></div>{/each}</div>{/if}
    </section>
  </div>

  {#if data.briefing.configured}<section class="card ai">
    <header><button class="link" onclick={() => (briefOpen = !briefOpen)}><b>✦ AI briefing</b></button>{#if briefing?.generatedAt}<small class="muted">{new Date(briefing.generatedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}{briefing.day && briefing.day !== data.calendar.today ? ' · out of date' : ''}</small>{/if}
      <span class="sp"></span>{#if data.briefing.aiEnabled}<button onclick={refreshBriefing} disabled={briefBusy}>{briefBusy ? 'Generating…' : briefing ? 'Refresh' : 'Generate'}</button>{:else}<a href="/settings/ai">Enable AI</a>{/if}</header>
    {#if briefError}<p class="err">{briefError}</p>{/if}
    {#if briefing}<div class="sum" class:clamp={!briefOpen}>{@html renderB(briefing)}</div>
      {#if briefOpen && briefing.sources?.length}<button class="link" onclick={() => (srcOpen = !srcOpen)}>{srcOpen ? 'Hide' : 'Show'} sources ({briefing.sources.length})</button>{#if srcOpen}<ul class="srcs">{#each briefing.sources as s (s.id)}<li><a href={s.href}><b>{s.id}</b> {s.title}{s.date ? ` · ${s.date}` : ''}</a></li>{/each}</ul>{/if}{/if}
    {/if}
  </section>{/if}

  {#if data.tiles.some((t) => t.count > 0)}<section class="views"><h2>Views with unread</h2><div>
    {#each data.tiles.filter((t) => t.count > 0) as t (t.id)}<a href={`/pipelines/${t.id}`} title={t.latest.map((m) => m.subject).join('\n')}><span>{icon(t.parser)}</span><b>{t.name}</b><em>{t.count}</em>{#if t.lastError}<i class="err" title={t.lastError}>!</i>{/if}</a>{/each}
  </div></section>{/if}
</div>
</AppShell>

<style>
  .dash{color:#29344c;font-size:13px;display:grid;gap:14px;max-width:1240px}
  .muted{color:#8a95a8}.sp{flex:1}a{color:#3157de}
  h2{margin:0;font-size:14px;font-weight:800}h2 a{color:inherit;text-decoration:none}
  .card{background:#fff;border:1px solid #e4e9f2;border-radius:14px;padding:14px 16px;min-width:0}.card header{display:flex;gap:10px;align-items:baseline;margin-bottom:10px}
  button{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:5px 11px;font-weight:700;color:#43516c;cursor:pointer;font-size:12px}button:disabled{opacity:.6}.link{border:0;background:none;padding:0;color:#3157de}

  /* Hero */
  .hero{display:grid;grid-template-columns:1fr minmax(260px,340px);gap:14px;background:linear-gradient(135deg,#1f2a5a 0%,#3157de 62%,#6a5ae0 100%);color:#fff;border-radius:18px;padding:20px 22px;box-shadow:0 10px 30px #3157de26}
  .hi small{opacity:.75;font-weight:600}.hi h1{margin:2px 0 4px;font-size:26px;letter-spacing:-.01em}
  .pulse{margin:0 0 12px;font-size:14px;opacity:.95}.pulse .hot{background:#ff6b6b;color:#fff;border-radius:999px;padding:1px 9px}.pulse .calm{color:#b9f5d0}
  .chips,.quick{display:flex;gap:6px;flex-wrap:wrap}.chips{margin-bottom:10px}
  .chips a{background:#ffffff1f;color:#fff;text-decoration:none;border-radius:999px;padding:4px 11px;font-size:12px}.chips a:hover{background:#ffffff33}.chips b{font-size:13px}
  .quick a{color:#dfe6ff;text-decoration:none;font-size:12px;font-weight:700;border:1px solid #ffffff40;border-radius:8px;padding:4px 10px}.quick a:hover{background:#ffffff1a}
  .side{display:grid;gap:10px;align-content:start}
  .next,.money{background:#ffffff17;border:1px solid #ffffff2e;border-radius:12px;padding:10px 12px;display:grid;gap:2px;color:#fff;text-decoration:none;position:relative;overflow:hidden}
  .next small,.money small{opacity:.75;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.next b{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.next span{opacity:.85;font-size:12px}.next a{color:#fff;font-weight:700}
  .next.live{background:#ff6b6b33;border-color:#ff9b9b66}
  .money b{font-size:20px}.money span{font-size:12px;font-weight:700;opacity:.9}.money .up{color:#a6f3c4}.money .down{color:#ffc2c2}
  .money svg{position:absolute;right:10px;bottom:8px;width:120px;height:30px;opacity:.6}.money polyline{fill:none;stroke:#fff;stroke-width:1.6;vector-effect:non-scaling-stroke}

  .grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr);gap:14px;align-items:start}

  /* Attention */
  .filters{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}.filters button{border-radius:999px;padding:3px 10px;font-size:11px;color:#53607a}.filters button.on{background:var(--c,#29344c);border-color:var(--c,#29344c);color:#fff}
  .attn ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
  .attn li{display:grid;grid-template-columns:30px minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:8px 8px 8px 10px;border-radius:10px;border-left:3px solid transparent;background:#f8f9fc}
  .attn li.now{border-left-color:#e24c4c;background:#fff6f5}.attn li.today{border-left-color:#f0a33a}.attn li.look{border-left-color:#d9dfeb}
  .ico{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 14%,#fff);color:var(--c);font-weight:800;font-size:14px}
  .body{display:grid;min-width:0;text-decoration:none;color:inherit}.body b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1f2a44}.body span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b7690;font-size:12px}.body:hover b{color:#3157de}
  .attn time{font-size:11px;color:#8a95a8;font-weight:700}
  .done{border-radius:999px;width:26px;height:26px;padding:0;color:#8a95a8;opacity:.55}.attn li:hover .done{opacity:1}.done:hover{background:#e9f7ef;border-color:#9fd8b6;color:#1e7a47}
  .more{margin-top:8px}
  .zero{display:grid;place-items:center;gap:3px;padding:26px 0;text-align:center}.zero span{font-size:28px}.zero b{font-size:15px}.zero small{color:#8a95a8}

  /* Today */
  .allday{background:#eef3ff;color:#2f4fa8;border-radius:7px;padding:4px 9px;font-weight:700;font-size:12px;margin-bottom:4px}
  .tl{list-style:none;margin:0;padding:0 0 0 4px;display:grid;gap:3px;border-left:2px solid #e4e9f2}
  .tl li{display:grid;grid-template-columns:64px 1fr;gap:8px;align-items:baseline;padding:4px 8px;margin-left:-2px;border-left:2px solid transparent}
  .tl time{font-size:11px;font-weight:800;color:#53607a}.tl b{display:block;color:#1f2a44}.tl small{color:#8a95a8;font-size:11px}
  .tl .ev{border-left-color:#3157de}.tl .ev.past{opacity:.45}.tl .ev.on{border-left-color:#e24c4c;background:#fff6f5;border-radius:0 8px 8px 0}
  .tl .free{border-left-color:#9fd8b6;color:#1e7a47;font-size:12px}.tl .free time{color:#1e7a47}
  .nowline{display:block!important;padding:0!important;position:relative;height:12px}.nowline::before{content:'';position:absolute;left:0;right:0;top:6px;border-top:2px solid #e24c4c}.nowline span{position:relative;background:#e24c4c;color:#fff;font-size:10px;font-weight:800;border-radius:999px;padding:0 7px;margin-left:4px}
  .week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:12px;text-decoration:none;align-items:end;padding-top:8px;border-top:1px solid #eef1f6}
  .week span{display:grid;justify-items:center;gap:2px;align-self:end}.week i{width:16px;border-radius:5px 5px 2px 2px;background:#b8c6f6}.week i.none{background:#eef1f6}.week .td i{background:#3157de}
  .week small{color:#8a95a8;font-size:10px;font-weight:700}.week .td small{color:#3157de}.week em{font-style:normal;font-size:10px;color:#53607a;font-weight:800;min-height:12px}
  .rems{margin-top:12px;padding-top:8px;border-top:1px solid #eef1f6;display:grid;gap:3px}.rems h3{margin:0 0 2px;font-size:12px}.rems h3 a{color:#53607a;text-decoration:none}
  .rems div{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#53607a}.rems span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rems time{font-size:10px;font-weight:700;color:#8a95a8;flex:none}.rems .late time,.rems .late{color:#a5414d}

  /* AI briefing */
  .ai{border-left:3px solid #7c4dde}.ai header{margin-bottom:4px;align-items:center}.ai .link b{color:#7c4dde}.ai header a{font-weight:700;font-size:12px}
  .sum{line-height:1.55}.sum.clamp{display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#53607a}
  .sum :global(.cite){background:#eef1ff;color:#3157de;border-radius:5px;padding:0 5px;font-size:11px;font-weight:800;text-decoration:none}
  .srcs{list-style:none;padding:0;margin:6px 0;display:grid;gap:3px;font-size:12px}.srcs a{color:#53607a;text-decoration:none}.srcs b{color:#3157de;font-size:10px}.err{color:#a5414d;margin:6px 0 0}

  /* Views */
  .views h2{font-size:12px;color:#8a95a8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
  .views div{display:flex;gap:8px;flex-wrap:wrap}.views a{display:flex;gap:7px;align-items:center;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:7px 11px;text-decoration:none;color:#29344c}.views a:hover{border-color:#b9c6f5}
  .views em{font-style:normal;background:#eef1ff;color:#3157de;border-radius:999px;padding:0 8px;font-weight:800;font-size:12px}.views .err{font-style:normal;color:#a5414d;font-weight:800}

  @media(max-width:900px){.hero,.grid{grid-template-columns:1fr}}
  @media(max-width:600px){.hero{padding:16px}.hi h1{font-size:22px}.attn li{grid-template-columns:28px minmax(0,1fr) auto}.attn time{display:none}}
</style>
