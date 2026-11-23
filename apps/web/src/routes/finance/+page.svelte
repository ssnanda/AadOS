<script lang="ts">
  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import AppShell from '$lib/components/AppShell.svelte';
  import LineChart from '$lib/components/finance/LineChart.svelte';
  import { DECISION_TYPES, KIND_META, RANGES, costBasisValue, holdingsCsv, isMuted, isStale, marketValue, periodChange, rangeStart, unitCost, type Range } from '$lib/finance/model';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const TABS = [['overview', 'Overview'], ['accounts', 'Accounts'], ['positions', 'Positions'], ['watchlist', 'Watchlist'], ['plans', 'Plans & decisions'], ['insights', 'Insights'], ['history', 'History'], ['realestate', 'Real estate'], ['settings', 'Settings']] as const;
  type Tab = (typeof TABS)[number][0];
  const start = page.url.searchParams.get('tab') as Tab;
  let tab = $state<Tab>(TABS.some(([t]) => t === start) ? start : 'overview');
  const go = (t: Tab) => { tab = t; const u = new URL(page.url); u.searchParams.set('tab', t); replaceState(u, {}); };
  let notice = $state(''), busy = $state(''), range = $state<Range>('3M');
  let owner = $state(''), acctFilter = $state(''), sort = $state<'value' | 'gain' | 'day' | 'ticker'>('value'), openAccount = $state(''), editing = $state<Record<string, any> | null>(null);

  const usd = (v: number | null | undefined, d = 0) => v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: d, minimumFractionDigits: d });
  const pctf = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');
  async function api(op: string, payload: Record<string, unknown> = {}, label = op) {
    busy = label; notice = '';
    try {
      const res = await fetch('/finance/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...payload }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || b.error) throw new Error(b.error || `HTTP ${res.status}`);
      return b;
    } catch (e) { notice = e instanceof Error ? e.message : 'Failed.'; return null; } finally { busy = ''; }
  }
  const act = async (op: string, payload: Record<string, unknown> = {}, msg = '') => { const r = await api(op, payload); if (r) { if (msg) notice = msg; await invalidateAll(); } return r; };

  // ---- derived views ----
  const D = $derived(data.available ? data : null);
  const holdings = $derived(D ? D.holdings.filter((h) => (!acctFilter || h.accountId === acctFilter) && (!owner || D.accounts.find((a) => a.id === h.accountId)?.owner === owner)) : []);
  const series = $derived(D ? D.series.map((p) => ({ date: p.date, value: p.total })) : []);
  const from = $derived(D && series.length ? rangeStart(range, series[0].date) : '');
  const changes = $derived(D ? { day: periodChange(series, rangeStart('1W', series[0]?.date || '')), week: periodChange(series, rangeStart('1W', series[0]?.date || '')), month: periodChange(series, rangeStart('1M', series[0]?.date || '')), ytd: periodChange(series, rangeStart('YTD', series[0]?.date || '')), year: periodChange(series, rangeStart('1Y', series[0]?.date || '')) } : null);
  const sortedPositions = $derived(D ? [...D.positions].sort((a, b) => sort === 'ticker' ? a.ticker.localeCompare(b.ticker) : sort === 'gain' ? (b.marketValue - b.costBasis) - (a.marketValue - a.costBasis) : sort === 'day' ? b.todayChange - a.todayChange : b.marketValue - a.marketValue) : []);
  // History tab: the selected range, indexed to 100 at its first day (portfolio vs SPY/QQQ).
  const hwin = $derived(D ? D.series.filter((p) => p.date >= from) : []);
  const hbase = $derived(hwin[0]);
  const openDecisions = $derived(D ? D.decisions.filter((d) => d.status === 'open' || d.status === 'scheduled') : []);
  const bars = (rec: Record<string, number>) => Object.entries(rec).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const totalOf = (rec: Record<string, number>) => Object.values(rec).reduce((t, v) => t + Math.max(0, v), 0);

  // ---- CSV ----
  function exportCsv() { if (!D) return; const blob = new Blob([holdingsCsv(D.holdings, D.accounts)], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `holdings-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href); }
  async function importCsv(e: Event) { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (!f) return; const text = await f.text(); const dry = await api('csv.import', { text, dryRun: true }); if (!dry) return; if (!confirm(`Import ${dry.rows} holding rows?${dry.errors.length ? `\n${dry.errors.length} line(s) will be skipped:\n${dry.errors.slice(0, 5).join('\n')}` : ''}`)) return; const r = await act('csv.import', { text }); if (r) notice = `Imported: ${r.added} added, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} skipped` : ''}.`; }

  // ---- history drill-downs ----
  let drill = $state<{ title: string; series: { name: string; color: string; points: { date: string; value: number }[]; dashed?: boolean }[] } | null>(null);
  async function showHolding(ticker: string) { const r = await api('history.holding', { ticker, range: '1y' }); if (r) drill = { title: `${ticker} — price (1 year) and your position`, series: [{ name: 'Price', color: '#2f7cf6', points: r.prices.map((p: any) => ({ date: p.date, value: p.close })) }, ...(r.series.length > 1 ? [{ name: 'Position value', color: '#2a9d5c', points: r.series.map((p: any) => ({ date: p.date, value: p.value })) }] : [])] }; }
  async function showAccount(id: string, name: string) { const r = await api('history.account', { id }); if (r) drill = { title: `${name} — value history`, series: [{ name: 'Value', color: '#2a9d5c', points: r.series.map((p: any) => ({ date: p.date, value: p.value })) }, { name: 'Cost', color: '#a0a8b8', dashed: true, points: r.series.map((p: any) => ({ date: p.date, value: p.cost })) }] }; }

  // ---- connections ----
  let etradeUrl = $state(''), verifier = $state(''), etradeAccounts = $state<any[]>([]), plaidAccounts = $state<Record<string, any[]>>({});
  async function plaidLink(itemId?: string) {
    const r = await api('plaid.linkToken', { itemId }); if (!r) return;
    if (!(window as any).Plaid) await new Promise<void>((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'; s.onload = () => ok(); s.onerror = () => bad(new Error('Could not load Plaid Link.')); document.head.appendChild(s); }).catch((e) => { notice = e.message; });
    (window as any).Plaid?.create({ token: r.linkToken, onSuccess: async (publicToken: string, meta: any) => { if (itemId) { await act('plaid.sync', { itemId }, 'Reconnected.'); return; } const x = await act('plaid.exchange', { publicToken, institutionId: meta?.institution?.institution_id || '', institutionName: meta?.institution?.name || '' }, 'Connected. Link its accounts below.'); if (x) loadPlaidAccounts(x.itemId); } }).open();
  }
  async function loadPlaidAccounts(itemId: string) { const r = await api('plaid.accounts', { itemId }); if (r) plaidAccounts = { ...plaidAccounts, [itemId]: r.accounts }; }

  // ---- AJAdvisor import ----
  let importReport = $state<any>(null), importFile = $state<File | null>(null);
  async function runImport(mode: 'dry-run' | 'apply') {
    if (!importFile) { notice = 'Choose the AJAdvisor database file first.'; return; }
    if (mode === 'apply' && !confirm('Migrate AJAdvisor data into AadOS? Records already in AadOS are kept as they are; nothing is deleted.')) return;
    busy = mode; const fd = new FormData(); fd.set('file', importFile); fd.set('mode', mode);
    try { const res = await fetch('/finance/import', { method: 'POST', body: fd }); const b = await res.json(); if (!res.ok || b.error) throw new Error(b.error); importReport = b; if (mode === 'apply') await invalidateAll(); } catch (e) { notice = e instanceof Error ? e.message : 'Import failed.'; } finally { busy = ''; }
  }

  const blankHolding = () => ({ kind: 'holding', accountId: acctFilter || D?.accounts[0]?.id || '', ticker: '', name: '', quantity: '', costBasis: '', currentPrice: '', categories: '', notes: '' });
  const blankProperty = () => ({ kind: 'property', location: '', units: 1 });
  async function saveEdit() {
    const e = editing; if (!e) return;
    const ops: Record<string, string> = { account: 'account.save', holding: 'holding.save', watch: 'watch.save', plan: 'plan.save', decision: 'decision.save', property: 'property.save' };
    const payload = { ...e, ...(e.kind === 'holding' && typeof e.categories === 'string' ? { categories: e.categories.split(',').map((x: string) => x.trim()).filter(Boolean) } : {}) };
    if (await act(ops[e.kind], payload, 'Saved.')) editing = null;
  }
</script>

<svelte:head><title>Finance · AadOS</title></svelte:head>
<AppShell title="Finance">
<main>
{#if !D}
  <section class="card"><h1>Finance</h1><p class="muted">{('error' in data && data.error) || 'Finance needs PostgreSQL storage (AADOS_STORAGE=postgres) and the latest database migration.'}</p></section>
{:else}
  <header class="head">
    <div><h1>Finance &amp; Investments</h1><small class="muted">Prices {D.lastRefresh ? `updated ${when(D.lastRefresh.refreshedAt)} · Yahoo (delayed)` : 'not refreshed yet'}{D.lastRefresh?.failedTickers?.length ? ` · ${D.lastRefresh.failedTickers.length} without a quote` : ''}</small></div>
    <span class="sp"></span>
    <select bind:value={owner} aria-label="Owner"><option value="">All owners</option>{#each D.owners as o (o)}<option>{o}</option>{/each}</select>
    <button class="primary" disabled={Boolean(busy)} onclick={() => act('refresh', {}, 'Prices refreshed.')}>{busy === 'refresh' ? 'Refreshing…' : '↻ Refresh prices'}</button>
  </header>
  <nav class="tabs">{#each TABS as [t, l] (t)}<button class:on={tab === t} onclick={() => go(t)}>{l}{#if t === 'insights' && D.signals.length}<i>{D.signals.length}</i>{/if}{#if t === 'plans' && openDecisions.length}<i>{openDecisions.length}</i>{/if}</button>{/each}</nav>
  {#if notice}<div class="notice">{notice} <button class="link" onclick={() => (notice = '')}>✕</button></div>{/if}
  {#if D.summary.missingPrices.length || D.summary.stalePrices.length}<div class="warn">⚠ {D.summary.missingPrices.length ? `${D.summary.missingPrices.length} holding(s) have no price (excluded from totals): ${D.summary.missingPrices.slice(0, 6).map((h) => h.ticker).join(', ')}. ` : ''}{D.summary.stalePrices.length ? `${D.summary.stalePrices.length} price(s) are older than a day.` : ''}</div>{/if}

  {#if tab === 'overview'}
    {#if D.recentAlerts.length}<section class="card alerts"><h2>Alerts <small class="muted">last 7 days</small></h2><ul>{#each D.recentAlerts.slice(0, 8) as a (a.key)}<li class:conn={a.kind === 'connection'}><span>{a.title}</span><time class="muted small">{new Date(a.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></li>{/each}</ul></section>{/if}
    <div class="tiles">
      <div class="tile big"><small>Net worth</small><b>{usd(D.summary.netWorth)}</b><em class="muted">investments + cash + real-estate equity</em></div>
      <div class="tile"><small>Investments</small><b>{usd(D.summary.investments)}</b><em class={tone(D.summary.dayChange)}>{usd(D.summary.dayChange)} today</em></div>
      <div class="tile"><small>Cash</small><b>{usd(D.summary.cash)}</b></div>
      <div class="tile"><small>Real-estate equity</small><b>{usd(D.summary.realEstateEquity)}</b><em class="muted">{usd(D.summary.realEstateValue)} value − {usd(D.summary.realEstateMortgage)} mortgage</em></div>
      <div class="tile"><small>Invested (cost) → value</small><b>{usd(D.summary.costBasis)} → {usd(D.summary.investments + D.summary.cash)}</b><em class={tone(D.summary.gain)}>{usd(D.summary.gain)} ({pctf(D.summary.costBasis ? (D.summary.gain / D.summary.costBasis) * 100 : null)})</em></div>
      <div class="tile"><small>Rental cash flow</small><b>{usd(D.summary.monthlyRentalCashFlow)}/mo</b></div>
    </div>
    {#if changes}<div class="periods">{#each [['Week', changes.week], ['Month', changes.month], ['YTD', changes.ytd], ['Year', changes.year]] as [l, c] (l)}{@const cc = c as any}<span>{l}: <b class={tone(cc.change)}>{cc.percent == null ? '—' : `${usd(cc.change)} (${pctf(cc.percent)})`}</b></span>{/each}</div>{/if}
    <section class="card"><div class="row"><h2>Portfolio value</h2><span class="sp"></span>{#each RANGES as r (r)}<button class="chip" class:on={range === r} onclick={() => (range = r)}>{r}</button>{/each}</div>
      <LineChart series={[{ name: 'Total', color: '#2f7cf6', points: series.filter((p) => p.date >= from) }, { name: 'Cost basis', color: '#a0a8b8', dashed: true, points: D.series.filter((p) => p.date >= from).map((p) => ({ date: p.date, value: p.cost })) }]} /></section>
    <div class="grid2">
      {#each [['By account type', D.summary.byType], ['By owner', D.summary.byOwner], ['By category', D.summary.byCategory], ['By asset class', { Stocks: D.summary.buckets.stocks, Funds: D.summary.buckets.funds, Cash: D.summary.buckets.cash, 'Real estate (funds/other)': D.summary.buckets.realEstateOther, 'Real estate (properties)': D.summary.realEstateValue }]] as [title, rec] (title)}
        {@const r = rec as Record<string, number>}<section class="card"><h2>{title}</h2>{#each bars(r).slice(0, 10) as [k, v] (k)}<div class="bar"><span>{k}</span><div><i style="width:{(v / Math.max(1, totalOf(r))) * 100}%"></i></div><b>{usd(v)}</b><small>{((v / Math.max(1, totalOf(r))) * 100).toFixed(1)}%</small></div>{:else}<p class="muted">No data.</p>{/each}</section>
      {/each}
    </div>
    {#if D.signals.length}<section class="card"><div class="row"><h2>Top insights</h2><span class="sp"></span><button class="link" onclick={() => go('insights')}>All {D.signals.length} →</button></div>{#each D.signals.slice(0, 5) as sg (sg.id)}<div class="sig {sg.tone}"><b>{sg.title}</b><small>{sg.next}</small></div>{/each}</section>{/if}

  {:else if tab === 'accounts'}
    <div class="row wrapr"><button class="primary" onclick={() => (editing = { kind: 'account', name: '', type: 'Regular Brokerage', owner: '', brokerage: '' })}>＋ Account</button><button onclick={() => (editing = blankHolding())} disabled={!D.accounts.length}>＋ Holding</button><button onclick={exportCsv}>⇩ Export CSV</button><label class="filebtn">⇧ Import CSV<input type="file" accept=".csv,text/csv" onchange={importCsv}></label></div>
    {#each D.summary.byAccount.filter((a) => !owner || a.owner === owner) as a (a.id)}{@const acct = D.accounts.find((x) => x.id === a.id)}{@const hs = D.holdings.filter((h) => h.accountId === a.id)}
      <section class="card acct">
        <div class="row"><button class="link big" onclick={() => (openAccount = openAccount === a.id ? '' : a.id)}>{openAccount === a.id ? '▾' : '▸'} {a.name}</button>
          <span class="tag">{a.type}</span>{#if a.owner}<span class="tag">{a.owner}</span>{/if}{#if acct?.brokerage}<span class="tag">{acct.brokerage}</span>{/if}{#if acct?.source !== 'manual'}<span class="tag src">{acct?.source}</span>{/if}
          <span class="sp"></span><b>{usd(a.value + a.cash)}</b><small class={tone(a.dayChange)}>{usd(a.dayChange)}</small><small class="muted">cash {usd(a.cash)}</small>
          <button class="ic" title="History" onclick={() => showAccount(a.id, a.name)}>📈</button><button class="ic" title="Edit" onclick={() => (editing = { kind: 'account', ...acct })}>✎</button>
          <button class="ic danger" title="Delete account" onclick={() => confirm(`Delete ${a.name} and its ${hs.length} holdings? History snapshots are kept.`) && act('account.delete', { id: a.id })}>🗑</button></div>
        {#if openAccount === a.id}<table><thead><tr><th>Ticker</th><th>Name</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Value</th><th>Gain</th><th>Day</th><th></th></tr></thead><tbody>
          {#each hs as h (h.id)}{@const mv = marketValue(h)}{@const cb = costBasisValue(h)}<tr><td><button class="link" onclick={() => showHolding(h.ticker)}>{h.ticker}</button>{#if h.source !== 'manual'}<small class="src">{h.source}</small>{/if}</td><td class="nm">{h.name}<small>{h.categories.join(', ')}</small></td><td>{h.quantity}</td><td>{usd(unitCost(h), 2)}</td>
            <td class:stale={h.ticker !== 'CASH' && isStale(h.priceAt)} title={h.priceAt ? `${h.priceSource || ''} · ${when(h.priceAt)}` : 'no price'}>{usd(h.currentPrice, 2)}</td><td>{usd(mv)}</td><td class={tone(mv == null ? null : mv - cb)}>{mv == null ? '—' : `${usd(mv - cb)} (${pctf(cb ? ((mv - cb) / cb) * 100 : null)})`}</td>
            <td class={tone(h.currentPrice != null && h.previousClose != null ? h.currentPrice - h.previousClose : null)}>{h.currentPrice != null && h.previousClose != null ? usd((h.currentPrice - h.previousClose) * h.quantity) : '—'}</td>
            <td><button class="ic" onclick={() => (editing = { kind: 'holding', ...h, categories: h.categories.join(', ') })}>✎</button><button class="ic danger" onclick={() => confirm(`Delete ${h.ticker}?`) && act('holding.delete', { id: h.id })}>🗑</button></td></tr>{:else}<tr><td colspan="9" class="muted">No holdings.</td></tr>{/each}</tbody></table>
          <button class="small" onclick={() => (editing = { ...blankHolding(), accountId: a.id })}>＋ Holding in {a.name}</button>{/if}
      </section>{:else}<p class="muted">No accounts yet. Add one, import a CSV, connect E*TRADE/Plaid, or import from AJAdvisor (Settings).</p>{/each}

  {:else if tab === 'positions'}
    <div class="row wrapr"><select bind:value={acctFilter}><option value="">All accounts</option>{#each D.accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}</select><span class="sp"></span>Sort <select bind:value={sort}><option value="value">Value</option><option value="gain">Gain</option><option value="day">Today</option><option value="ticker">Ticker</option></select></div>
    <section class="card"><table><thead><tr><th>Ticker</th><th>Name</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Value</th><th>Gain</th><th>Today</th><th>% of inv.</th><th>Accounts</th></tr></thead><tbody>
      {#each (acctFilter || owner ? sortedPositions.filter((p) => holdings.some((h) => h.ticker === p.ticker)) : sortedPositions) as p (p.ticker)}<tr><td><button class="link" onclick={() => showHolding(p.ticker)}>{p.ticker}</button></td><td class="nm">{p.name}<small>{p.categories.join(', ')}</small></td><td>{+p.quantity.toFixed(4)}</td><td>{usd(p.unitCost, 2)}</td><td>{usd(p.currentPrice, 2)}</td><td>{usd(p.marketValue)}</td>
        <td class={tone(p.marketValue - p.costBasis)}>{usd(p.marketValue - p.costBasis)} ({pctf(p.costBasis ? ((p.marketValue - p.costBasis) / p.costBasis) * 100 : null)})</td><td class={tone(p.todayChange)}>{usd(p.todayChange)} ({pctf(p.previousValue ? (p.todayChange / p.previousValue) * 100 : null)})</td><td>{D.summary.investments ? ((p.marketValue / D.summary.investments) * 100).toFixed(1) : '—'}%</td><td class="nm"><small>{p.accountNames.join(', ')}</small>{#if D.earnings[p.ticker]}<small>Earnings {D.earnings[p.ticker]}</small>{/if}</td></tr>{/each}</tbody></table></section>

  {:else if tab === 'watchlist'}
    <div class="row"><button class="primary" onclick={() => (editing = { kind: 'watch', ticker: '', name: '', targetPrice: '', dipPercent: 5, thesis: '' })}>＋ Watch a ticker</button></div>
    <section class="card"><table><thead><tr><th>Ticker</th><th>Price</th><th>Today</th><th>Buy below</th><th>Distance</th><th>Dip alert</th><th>Thesis</th><th></th></tr></thead><tbody>
      {#each D.watchlist as w (w.id)}{@const day = w.currentPrice != null && w.previousClose ? ((w.currentPrice - w.previousClose) / w.previousClose) * 100 : null}<tr class:hit={w.targetPrice != null && w.currentPrice != null && w.currentPrice <= w.targetPrice}>
        <td><button class="link" onclick={() => showHolding(w.ticker)}>{w.ticker}</button><small>{w.name}</small></td><td class:stale={isStale(w.priceAt)}>{usd(w.currentPrice, 2)}</td><td class={tone(day)}>{pctf(day)}</td><td>{usd(w.targetPrice, 2)}</td>
        <td>{w.targetPrice != null && w.currentPrice != null ? pctf(((w.currentPrice - w.targetPrice) / w.targetPrice) * 100) : '—'}</td><td>{w.dipPercent}%</td><td class="nm">{w.thesis || '—'}</td>
        <td><button class="ic" onclick={() => (editing = { kind: 'watch', ...w })}>✎</button><button class="ic danger" onclick={() => act('watch.delete', { ticker: w.ticker })}>🗑</button></td></tr>{:else}<tr><td colspan="8" class="muted">Nothing on the watchlist.</td></tr>{/each}</tbody></table></section>

  {:else if tab === 'plans'}
    <div class="row wrapr"><button class="primary" onclick={() => (editing = { kind: 'plan', ticker: '' })}>＋ Investment plan</button><button onclick={() => (editing = { kind: 'decision', ticker: '', type: 'research', notes: '', status: 'open', scheduledFor: '' })}>＋ Log decision</button></div>
    <section class="card"><h2>Open &amp; scheduled decisions ({openDecisions.length})</h2>
      {#each openDecisions as d (d.id)}<div class="dec"><span class="tag dt">{d.type.toUpperCase()}</span><b>{d.ticker}</b><span class="nm">{d.notes || ''}</span><span class="sp"></span><small class="muted">{d.status === 'scheduled' && d.scheduledFor ? `scheduled ${when(d.scheduledFor)}` : `since ${when(d.decidedAt)}`}</small>
        <button class="small" onclick={() => act('decision.save', { ...d, status: 'completed' })}>✓ Done</button><button class="small" onclick={() => act('decision.save', { ...d, status: 'dismissed' })}>Dismiss</button><button class="ic" onclick={() => (editing = { kind: 'decision', ...d, scheduledFor: d.scheduledFor?.slice(0, 16) || '' })}>✎</button></div>{:else}<p class="muted">No open decisions.</p>{/each}</section>
    <section class="card"><h2>Plans</h2>{#each D.plans as p (p.id)}{@const pos = D.positions.find((x) => x.ticker === p.ticker)}{@const share = pos && D.summary.investments ? (pos.marketValue / D.summary.investments) * 100 : null}
      <div class="plan"><div class="row"><b>{p.ticker}</b>{#if p.name}<span class="muted">{p.name}</span>{/if}<span class="sp"></span>{#if p.nextReviewDate}<small class:due={p.nextReviewDate <= new Date().toISOString().slice(0, 10)}>review {p.nextReviewDate}</small>{/if}<button class="ic" onclick={() => (editing = { kind: 'plan', ...p })}>✎</button><button class="ic danger" onclick={() => confirm(`Delete the ${p.ticker} plan?`) && act('plan.delete', { ticker: p.ticker })}>🗑</button></div>
        <div class="kv"><span>Allocation <b>{share == null ? '—' : `${share.toFixed(1)}%`}</b> (target {p.targetAllocationPercent ?? '—'}%, max {p.maxAllocationPercent ?? '—'}%)</span><span>Buy {usd(p.buyRangeLow, 2)}–{usd(p.buyRangeHigh, 2)}</span><span>Trim {usd(p.trimRangeLow, 2)}–{usd(p.trimRangeHigh, 2)}</span><span>Price <b>{usd(pos?.currentPrice, 2)}</b></span></div>
        {#if p.thesis}<p><b>Thesis:</b> {p.thesis}</p>{/if}{#if p.strategy}<p><b>Strategy:</b> {p.strategy}</p>{/if}{#if p.exitConditions}<p><b>Exit:</b> {p.exitConditions}</p>{/if}
        <small class="muted">Decisions: {D.decisions.filter((d) => d.ticker === p.ticker).map((d) => `${d.type} (${d.status})`).join(', ') || 'none'}</small></div>{:else}<p class="muted">No plans yet.</p>{/each}</section>
    <section class="card"><h2>Decision history</h2><table><tbody>{#each D.decisions.filter((d) => d.status === 'completed' || d.status === 'dismissed') as d (d.id)}<tr><td>{when(d.decidedAt)}</td><td><span class="tag dt">{d.type}</span></td><td>{d.ticker}</td><td class="nm">{d.notes || ''}</td><td>{d.status}</td><td><button class="ic danger" onclick={() => act('decision.delete', { id: d.id })}>🗑</button></td></tr>{:else}<tr><td class="muted">None yet.</td></tr>{/each}</tbody></table></section>

  {:else if tab === 'insights'}
    {#each Object.entries(KIND_META) as [kind, meta] (kind)}{@const list = D.signals.filter((x) => x.kind === kind)}{#if list.length}<section class="card"><h2>{meta.section}</h2>
      {#each list as sg (sg.id)}<div class="sig {sg.tone}"><div class="row"><b>{sg.title}</b><span class="sp"></span>{#if sg.ticker}<button class="small" onclick={() => (editing = { kind: 'decision', ticker: sg.ticker, type: sg.kind === 'buy' ? 'buy' : sg.kind === 'trim' ? 'trim' : 'research', notes: sg.title, status: 'open', scheduledFor: '' })}>Log decision</button>{/if}
        <select aria-label="Mute" onchange={(e) => { const d = e.currentTarget.value; if (d) act('signal.mute', { signalId: sg.id, title: sg.title, kind: sg.kind, ticker: sg.ticker, duration: d }, 'Muted.'); }}><option value="">Mute…</option><option value="1d">1 day</option><option value="1w">1 week</option><option value="1m">1 month</option><option value="3m">3 months</option><option value="forever">Permanently</option></select></div>
        <p>{sg.why}</p><small>→ {sg.next}</small></div>{/each}</section>{/if}{:else}{/each}
    {#if !D.signals.length}<p class="muted">Nothing needs attention.</p>{/if}
    {#if D.muted.some((m) => isMuted(m))}<section class="card"><h2>Muted ({D.muted.filter((m) => isMuted(m)).length})</h2>{#each D.muted.filter((m) => isMuted(m)) as m (m.id)}<div class="row"><span class="nm">{m.title}</span><span class="sp"></span><small class="muted">{m.mutedUntil ? `until ${when(m.mutedUntil)}` : 'permanently'}</small><button class="small" onclick={() => act('signal.unmute', { id: m.id })}>Unmute</button></div>{/each}</section>{/if}

  {:else if tab === 'history'}
    <section class="card"><div class="row"><h2>Portfolio vs benchmarks</h2><span class="sp"></span>{#each RANGES as r (r)}<button class="chip" class:on={range === r} onclick={() => (range = r)}>{r}</button>{/each}</div>
      <LineChart money={false} series={[{ name: 'Portfolio (index)', color: '#2f7cf6', points: hwin.map((p) => ({ date: p.date, value: hbase ? (p.total / hbase.total) * 100 : 100 })) }, ...['SPY', 'QQQ'].map((t, i) => ({ name: t, color: i ? '#a03fc9' : '#e8862a', dashed: true, points: hwin.filter((p) => p.benchmarks[t] && hbase?.benchmarks?.[t]).map((p) => ({ date: p.date, value: (p.benchmarks[t] / hbase!.benchmarks[t]) * 100 })) }))]} /></section>
    <section class="card"><h2>Daily snapshots</h2><table><thead><tr><th>Date</th><th>Total</th><th>Cost</th><th>Cash</th><th>Day change</th><th>Real estate</th><th>RE equity</th></tr></thead><tbody>{#each [...D.series].reverse().slice(0, 60) as p (p.date)}<tr><td>{p.date}</td><td>{usd(p.total)}</td><td>{usd(p.cost)}</td><td>{usd(p.cash)}</td><td class={tone(p.dayChange)}>{usd(p.dayChange)}</td><td>{usd(p.realEstate)}</td><td>{usd(p.realEstateEquity)}</td></tr>{/each}</tbody></table></section>

  {:else if tab === 'realestate'}
    <div class="tiles"><div class="tile"><small>Value</small><b>{usd(D.summary.realEstateValue)}</b></div><div class="tile"><small>Mortgage</small><b>{usd(D.summary.realEstateMortgage)}</b></div><div class="tile"><small>Equity</small><b>{usd(D.summary.realEstateEquity)}</b></div><div class="tile"><small>Cash flow</small><b>{usd(D.summary.monthlyRentalCashFlow)}/mo</b></div><div class="tile"><small>Properties / units</small><b>{D.properties.length} / {D.properties.reduce((t, p) => t + p.units, 0)}</b></div></div>
    <div class="row"><button class="primary" onclick={() => (editing = blankProperty())}>＋ Property</button></div>
    <section class="card"><table><thead><tr><th>Property</th><th>Units</th><th>Owner</th><th>Year</th><th>Cost</th><th>Value</th><th>Mortgage</th><th>Rent</th><th>Cash flow/mo</th><th>Gain</th><th></th></tr></thead><tbody>
      {#each D.properties.filter((p) => !owner || p.owner === owner) as p (p.id)}{@const m = D.propertyMetrics[p.id]}<tr><td class="nm">{p.name || p.location}{#if p.name}<small>{p.location}</small>{/if}</td><td>{p.units}</td><td>{p.owner || '—'}</td><td>{p.yearAcquired || '—'}</td><td>{usd(p.cost)}</td><td title={m.valueSource}>{usd(m.value)}{#if m.valueSource === 'Zestimate'}<small>Zestimate</small>{/if}</td><td>{usd(p.mortgageBalance)}</td><td>{usd(p.currentRent)}{#if p.normalizedRent != null && p.normalizedRent !== p.currentRent}<small>norm. {usd(p.normalizedRent)}</small>{/if}</td>
        <td class={tone(m.cashFlow)}>{usd(m.cashFlow)}</td><td class={tone(m.gain)}>{usd(m.gain)}</td><td><button class="ic" onclick={() => (editing = { kind: 'property', ...p })}>✎</button><button class="ic danger" onclick={() => confirm(`Delete ${p.location}?`) && act('property.delete', { id: p.id })}>🗑</button></td></tr>{:else}<tr><td colspan="11" class="muted">No properties.</td></tr>{/each}</tbody></table></section>

  {:else if tab === 'settings'}
    <section class="card"><h2>Alerts</h2><p class="muted small">Shown on the Overview tab and the Dashboard. Each alert fires once per day; mute single insights on the Insights tab.</p>
      <form class="grid3" onsubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act('alerts.save', { enabled: f.has('enabled'), movementThresholdPercent: f.get('mv'), costBasisDiscountPercent: f.get('cb'), allocationAlerts: f.has('alloc'), earningsAlerts: f.has('earn'), reviewAlerts: f.has('rev'), staleDataAlerts: f.has('stale'), connectionAlerts: f.has('conn') }, 'Alert settings saved.'); }}>
        <label class="chk"><input type="checkbox" name="enabled" checked={D.alerts.enabled}> Finance alerts on</label><label>Price move ≥ <input name="mv" type="number" step="0.1" value={D.alerts.movementThresholdPercent}> %</label><label>Below cost basis ≥ <input name="cb" type="number" step="1" value={D.alerts.costBasisDiscountPercent}> %</label>
        <label class="chk"><input type="checkbox" name="alloc" checked={D.alerts.allocationAlerts}> Allocation limits</label><label class="chk"><input type="checkbox" name="earn" checked={D.alerts.earningsAlerts}> Upcoming earnings</label><label class="chk"><input type="checkbox" name="rev" checked={D.alerts.reviewAlerts}> Plan reviews</label>
        <label class="chk"><input type="checkbox" name="stale" checked={D.alerts.staleDataAlerts}> Missing/stale prices</label><label class="chk"><input type="checkbox" name="conn" checked={D.alerts.connectionAlerts}> Connection failures</label><button class="primary">Save</button></form></section>
    <section class="card"><h2>Lists</h2><div class="grid3">{#each [['type', 'Account types', D.accountTypes], ['owner', 'Owners', D.owners], ['brokerage', 'Brokerages', D.brokerages], ['category', 'Categories', D.categories]] as [kind, title, list] (kind)}<div><h3>{title}</h3>{#each list as string[] as v (v)}<div class="row"><span>{v}</span><span class="sp"></span><button class="ic" onclick={() => { const to = prompt(`Rename ${v}`, v); if (to && to !== v) act('lookup.rename', { kind, from: v, to }); }}>✎</button><button class="ic danger" onclick={() => confirm(`Remove ${v}?`) && act('lookup.delete', { kind, name: v })}>✕</button></div>{/each}<button class="small" onclick={() => { const name = prompt(`New ${String(title).toLowerCase().replace(/s$/, '')}`); if (name) act('lookup.add', { kind, name }); }}>＋ Add</button></div>{/each}</div></section>
    {#if D.owner}
    <section class="card"><h2>E*TRADE <small class="muted">read-only · {D.etrade.sandbox ? 'sandbox' : 'production'}</small></h2>
      {#if D.etrade.lastError}<p class="err">{D.etrade.lastError}</p>{/if}
      {#if !D.etrade.fromEnv}<form class="grid3" onsubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act('etrade.config', { sandbox: f.has('sandbox'), consumerKey: f.get('key'), consumerSecret: f.get('secret') }, 'Saved.'); }}><label>Consumer key<input name="key" placeholder={D.etrade.configured ? 'saved — leave empty to keep' : ''} autocomplete="off"></label><label>Consumer secret<input name="secret" type="password" placeholder={D.etrade.configured ? 'saved — leave empty to keep' : ''} autocomplete="off"></label><label class="chk"><input type="checkbox" name="sandbox" checked={D.etrade.sandbox}> Sandbox</label><button>Save keys</button></form>{:else}<p class="muted small">Keys come from the environment (ETRADE_API_KEY).</p>{/if}
      <div class="row wrapr">{#if D.etrade.connected}<span class="ok">Connected {when(D.etrade.connectedAt)} · last sync {when(D.etrade.lastSyncedAt)}</span><button onclick={async () => { const r = await api('etrade.accounts'); if (r) etradeAccounts = r.accounts; }}>Accounts</button><button class="primary" onclick={() => act('etrade.sync', {}, 'E*TRADE synced.')}>↻ Sync</button><button class="danger" onclick={() => act('etrade.disconnect')}>Disconnect</button>
        {:else if D.etrade.configured}<button class="primary" onclick={async () => { const r = await api('etrade.start'); if (r) etradeUrl = r.url; }}>Connect E*TRADE</button>{/if}</div>
      {#if etradeUrl || D.etrade.pending}<div class="row wrapr">{#if etradeUrl}<a href={etradeUrl} target="_blank" rel="noopener noreferrer">1. Approve on E*TRADE ↗</a>{/if}<input bind:value={verifier} placeholder="2. Paste the verification code"><button class="primary" onclick={async () => { if (await act('etrade.complete', { verifier }, 'E*TRADE connected.')) { etradeUrl = ''; verifier = ''; } }}>Finish</button></div><small class="muted">E*TRADE tokens expire at midnight US Eastern; reconnect when sync reports it.</small>{/if}
      {#each etradeAccounts as a (a.accountIdKey)}{@const linked = D.accounts.find((x) => x.etradeAccountIdKey === a.accountIdKey)}<div class="row"><span>{a.accountDesc || a.accountName} <small class="muted">{a.accountType} · {a.accountStatus}</small></span><span class="sp"></span>{#if linked}<small class="ok">linked → {linked.name}</small><button class="small" onclick={() => act('etrade.import', { accountIdKey: a.accountIdKey }, 'Synced.')}>Sync</button><button class="small" onclick={() => act('etrade.unlink', { id: linked.id })}>Unlink</button>{:else}<button class="small primary" onclick={() => act('etrade.import', { accountIdKey: a.accountIdKey }, 'Imported.')}>Import</button>{/if}</div>{/each}</section>
    <section class="card"><h2>Plaid <small class="muted">investments, read-only · {D.plaid.env}</small></h2>
      {#if !D.plaid.fromEnv}<form class="grid3" onsubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act('plaid.config', { env: f.get('env'), clientId: f.get('cid'), secret: f.get('secret'), redirectUri: f.get('redirect') }, 'Saved.'); }}><label>Client ID<input name="cid" placeholder={D.plaid.configured ? 'saved — leave empty to keep' : ''} autocomplete="off"></label><label>Secret<input name="secret" type="password" placeholder={D.plaid.configured ? 'saved — leave empty to keep' : ''} autocomplete="off"></label><label>Environment<select name="env"><option value="sandbox" selected={D.plaid.env === 'sandbox'}>Sandbox</option><option value="production" selected={D.plaid.env === 'production'}>Production</option></select></label><label>Redirect URI (OAuth banks)<input name="redirect" value={D.plaid.redirectUri}></label><button>Save</button></form>{:else}<p class="muted small">Keys come from the environment (PLAID_CLIENT_ID).</p>{/if}
      {#if D.plaid.configured}<button class="primary" onclick={() => plaidLink()}>＋ Connect an institution</button>{/if}
      {#each D.plaid.items as it (it.id)}<div class="item"><div class="row"><b>{it.institutionName}</b>{#if it.status === 'login_required'}<span class="tag warnt">needs reconnect</span>{/if}<small class="muted">synced {when(it.lastSyncedAt)}{it.lastSyncSummary ? ` · ${it.lastSyncSummary}` : ''}</small><span class="sp"></span>
          <button class="small" onclick={() => loadPlaidAccounts(it.id)}>Accounts</button><button class="small primary" onclick={() => act('plaid.sync', { itemId: it.id }, 'Synced.')}>↻ Sync</button>{#if it.status === 'login_required'}<button class="small" onclick={() => plaidLink(it.id)}>Reconnect</button>{/if}<button class="small danger" onclick={() => confirm(`Unlink ${it.institutionName}? Accounts and history stay as manual records.`) && act('plaid.remove', { itemId: it.id })}>Unlink</button></div>
        {#if it.lastError}<small class="err">{it.lastError}</small>{/if}
        {#each plaidAccounts[it.id] || [] as a (a.accountId)}<div class="row sub"><span>{a.display} <small class="muted">{a.subtype || a.type} · {usd(a.balance)}</small></span><span class="sp"></span>{#if a.linkedTo}<small class="ok">linked → {D.accounts.find((x) => x.id === a.linkedTo)?.name}</small>{:else}<select onchange={(e) => { const v = e.currentTarget.value; if (v) act('plaid.link', { itemId: it.id, plaidAccountId: a.accountId, existingId: v === 'new' ? '' : v }, 'Linked. Sync to load holdings.').then(() => loadPlaidAccounts(it.id)); }}><option value="">Link to…</option><option value="new">New Finance account</option>{#each D.accounts.filter((x) => !x.plaidAccountId) as x (x.id)}<option value={x.id}>{x.name}{x.etradeAccountIdKey ? ' (E*TRADE — holdings stay from E*TRADE)' : ''}</option>{/each}</select>{/if}</div>{/each}</div>{/each}</section>
    <section class="card"><h2>Import from AJAdvisor</h2>
      <p class="muted small">Choose AJAdvisor's database file (<code>ajadvisor/data/dev.db</code>). A dry run shows counts and problems first; Migrate copies accounts, holdings, categories, snapshots, plans, decisions, muted insights, real estate and the watchlist, keeping ids and dates. Your AJAdvisor file is not changed; records already in AadOS are kept as they are. Logins and brokerage tokens are not copied — reconnect E*TRADE/Plaid above.</p>
      <div class="row wrapr"><input type="file" accept=".db,.sqlite,application/octet-stream" onchange={(e) => (importFile = e.currentTarget.files?.[0] || null)}><button onclick={() => runImport('dry-run')} disabled={Boolean(busy)}>{busy === 'dry-run' ? 'Checking…' : 'Dry run'}</button><button class="primary" onclick={() => runImport('apply')} disabled={Boolean(busy) || importReport?.mode !== 'dry-run'}>{busy === 'apply' ? 'Migrating…' : 'Migrate'}</button></div>
      {#if importReport}<div class="report"><b>{importReport.mode === 'apply' ? 'Migration' : 'Dry run'} — {importReport.at}</b>
        <table><thead><tr><th>Table</th><th>AJAdvisor</th><th>Already in AadOS</th>{#if importReport.mode === 'apply'}<th>Inserted</th>{/if}</tr></thead><tbody>{#each Object.keys(importReport.source) as k (k)}<tr><td>{k}</td><td>{importReport.source[k]}</td><td>{importReport.existing[k] ?? '—'}</td>{#if importReport.mode === 'apply'}<td>{importReport.inserted[k] ?? 0}</td>{/if}</tr>{/each}</tbody></table>
        <p>Totals (AJAdvisor): {importReport.totals.ajadvisor.holdings} holdings · value {usd(importReport.totals.ajadvisor.marketValue)} · cost {usd(importReport.totals.ajadvisor.costBasis)} · {importReport.totals.ajadvisor.properties} properties · {usd(importReport.totals.ajadvisor.realEstateValue)} real estate · mortgage {usd(importReport.totals.ajadvisor.mortgage)}</p>
        {#if importReport.totals.aados}<p class={importReport.totals.matches ? 'ok' : 'err'}>{importReport.totals.matches ? '✓ Reconciled: AadOS totals match AJAdvisor.' : `Differences: ${importReport.totals.differences.join('; ')}`}</p>{/if}
        {#if importReport.invalid.length}<p class="err">{importReport.invalid.length} record(s) skipped: {importReport.invalid.slice(0, 8).map((i: any) => `${i.table} ${i.id} (${i.reason})`).join('; ')}</p>{/if}
        <small class="muted">Not migrated: {importReport.notMigrated.join(' · ')}</small></div>{/if}
      {#if D.imports.length}<small class="muted">Previous runs: {D.imports.map((r) => `${r.mode} ${when(r.at)}${r.matches === true ? ' ✓' : r.matches === false ? ' ⚠' : ''}`).join(' · ')}</small>{/if}</section>
    <p class="muted small">AI: Finance data is shared with the AI assistant only when “Finance” is ticked in Settings → AI (currently {D.aiShare ? 'on' : 'off'}).</p>
    {/if}
  {/if}
{/if}
{#if drill}<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) drill = null; }}><section class="sheet"><div class="row"><h2>{drill.title}</h2><span class="sp"></span><button class="link" onclick={() => (drill = null)}>✕</button></div><LineChart series={drill.series} /></section></div>{/if}
{#if editing}{@const e = editing}<div class="backdrop" role="presentation" onclick={(ev) => { if (ev.target === ev.currentTarget) editing = null; }}><form class="sheet" onsubmit={(ev) => { ev.preventDefault(); saveEdit(); }}>
  <h2>{e.id ? 'Edit' : 'New'} {e.kind === 'watch' ? 'watchlist item' : e.kind}</h2>
  <div class="grid3">
  {#if e.kind === 'account'}<label>Name<input bind:value={e.name} required></label><label>Type<input bind:value={e.type} list="types"></label><label>Owner<input bind:value={e.owner} list="owners"></label><label>Brokerage<input bind:value={e.brokerage} list="brokerages"></label><label class="wide">Notes<input bind:value={e.notes}></label>
  {:else if e.kind === 'holding'}<label>Account<select bind:value={e.accountId}>{#each D?.accounts || [] as a (a.id)}<option value={a.id}>{a.name}</option>{/each}</select></label><label>Ticker<input bind:value={e.ticker} required></label><label>Name<input bind:value={e.name}></label><label>Quantity<input type="number" step="any" bind:value={e.quantity} required></label><label>Avg cost / share<input type="number" step="any" bind:value={e.costBasis}></label><label>Manual price<input type="number" step="any" bind:value={e.currentPrice} placeholder="only if no quote feed"></label><label class="wide">Categories (comma-separated)<input bind:value={e.categories} placeholder="auto if empty"></label><label class="wide">Notes<input bind:value={e.notes}></label>
  {:else if e.kind === 'watch'}<label>Ticker<input bind:value={e.ticker} required disabled={Boolean(e.id)}></label><label>Name<input bind:value={e.name}></label><label>Buy below $<input type="number" step="any" bind:value={e.targetPrice}></label><label>Alert on daily dip ≥ %<input type="number" step="0.5" bind:value={e.dipPercent}></label><label class="wide">Thesis<textarea rows="3" bind:value={e.thesis}></textarea></label>
  {:else if e.kind === 'plan'}<label>Ticker<input bind:value={e.ticker} required disabled={Boolean(e.id)}></label><label>Name<input bind:value={e.name}></label><label>Next review<input type="date" bind:value={e.nextReviewDate}></label><label>Target allocation %<input type="number" step="0.1" bind:value={e.targetAllocationPercent}></label><label>Max allocation %<input type="number" step="0.1" bind:value={e.maxAllocationPercent}></label><span></span><label>Buy range low<input type="number" step="any" bind:value={e.buyRangeLow}></label><label>Buy range high<input type="number" step="any" bind:value={e.buyRangeHigh}></label><span></span><label>Trim range low<input type="number" step="any" bind:value={e.trimRangeLow}></label><label>Trim range high<input type="number" step="any" bind:value={e.trimRangeHigh}></label><span></span>
    <label class="wide">Purpose<input bind:value={e.purpose}></label><label class="wide">Strategy<textarea rows="2" bind:value={e.strategy}></textarea></label><label class="wide">Thesis<textarea rows="3" bind:value={e.thesis}></textarea></label><label class="wide">Exit conditions<textarea rows="2" bind:value={e.exitConditions}></textarea></label><label class="wide">Notes<textarea rows="2" bind:value={e.notes}></textarea></label>
  {:else if e.kind === 'decision'}<label>Ticker<input bind:value={e.ticker} required></label><label>Decision<select bind:value={e.type}>{#each DECISION_TYPES as t (t)}<option value={t}>{t}</option>{/each}</select></label><label>Status<select bind:value={e.status}><option value="open">open</option><option value="scheduled">scheduled</option><option value="completed">completed</option><option value="dismissed">dismissed</option></select></label><label>Scheduled for<input type="datetime-local" bind:value={e.scheduledFor}></label><label class="wide">Reasoning<textarea rows="4" bind:value={e.notes}></textarea></label>
  {:else if e.kind === 'property'}<label class="wide">Address<input bind:value={e.location} required></label><label>Name<input bind:value={e.name}></label><label>Units<input type="number" bind:value={e.units}></label><label>Owner<input bind:value={e.owner} list="owners"></label><label>Year acquired<input type="number" bind:value={e.yearAcquired}></label><label>Purchase price<input type="number" step="any" bind:value={e.cost}></label><label>Market value<input type="number" step="any" bind:value={e.marketValue}></label><label>Zestimate<input type="number" step="any" bind:value={e.zestimate}></label><label>Mortgage balance<input type="number" step="any" bind:value={e.mortgageBalance}></label><label>Loan<input bind:value={e.mortgage}></label><label>Mortgage payment/mo<input type="number" step="any" bind:value={e.mortgagePayment}></label><label>Interest/mo (property)<input type="number" step="any" bind:value={e.interestProperty}></label><label>Rent/mo<input type="number" step="any" bind:value={e.currentRent}></label><label>Normalized rent/mo<input type="number" step="any" bind:value={e.normalizedRent}></label><label>Insurance/mo<input type="number" step="any" bind:value={e.insurance}></label><label>Property tax/mo<input type="number" step="any" bind:value={e.realEstateTax}></label><label>HOA/mo<input type="number" step="any" bind:value={e.hoa}></label><label>Other expenses/mo<input type="number" step="any" bind:value={e.otherExpenses}></label><label>Net income/mo<input type="number" step="any" bind:value={e.income} placeholder="else rent − costs"></label><label class="wide">Notes<textarea rows="2" bind:value={e.notes}></textarea></label>{/if}
  </div>
  <div class="row end"><button type="button" onclick={() => (editing = null)}>Cancel</button><button class="primary" disabled={Boolean(busy)}>Save</button></div>
  <datalist id="types">{#each D?.accountTypes || [] as t (t)}<option value={t}></option>{/each}</datalist><datalist id="owners">{#each D?.owners || [] as t (t)}<option value={t}></option>{/each}</datalist><datalist id="brokerages">{#each D?.brokerages || [] as t (t)}<option value={t}></option>{/each}</datalist>
</form></div>{/if}
</main>
</AppShell>

<style>
  main{color:#29344c;font-size:13px}h1{margin:0;font-size:22px}h2{margin:0 0 8px;font-size:15px}h3{margin:0 0 6px;font-size:13px}
  .head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.sp{flex:1}.muted{color:#8a95a8}.small{font-size:12px}
  .tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #e4e9f2;margin-bottom:10px}.tabs button{border:0;background:none;padding:8px 12px;font-weight:700;color:#53607a;border-bottom:2px solid transparent;border-radius:0}.tabs button.on{color:#2f7cf6;border-bottom-color:#2f7cf6}.tabs i{font-style:normal;background:#2f7cf6;color:#fff;border-radius:999px;font-size:10px;padding:1px 6px;margin-left:5px}
  button,.filebtn{border:1px solid #d9dfeb;background:#fff;border-radius:8px;padding:6px 11px;font-weight:700;color:#43516c;cursor:pointer;font-size:12px}button:disabled{opacity:.5}.primary{background:#2f7cf6;border-color:#2f7cf6;color:#fff}.danger{color:#b53c50}.link{border:0;background:none;padding:0;color:#2f7cf6}.link.big{font-size:15px;color:#1f2a44}
  .filebtn input{display:none}.ic{border:0;background:none;padding:2px 4px;font-size:14px}.small{padding:3px 8px;font-size:11px}.chip{padding:3px 9px;border-radius:999px}.chip.on{background:#2f7cf6;border-color:#2f7cf6;color:#fff}
  select,input,textarea{border:1px solid #d9dfeb;border-radius:7px;padding:6px 8px;font:inherit;min-width:0}textarea{resize:vertical}
  .notice{background:#eef3ff;border:1px solid #cfdcff;color:#2f4fa8;border-radius:9px;padding:8px 12px;margin-bottom:8px}.warn{background:#fff8e6;border:1px solid #f3dfa8;color:#8a6a1c;border-radius:9px;padding:8px 12px;margin-bottom:8px}
  .alerts ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}.alerts li{display:flex;gap:10px;justify-content:space-between;font-size:13px}.alerts li.conn span{color:#a5414d;font-weight:600}
  .card{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:12px 14px;margin-bottom:10px;overflow-x:auto}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:10px}.tile{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:12px;display:grid;gap:3px}.tile small{color:#8a95a8;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.5px}.tile b{font-size:19px}.tile.big b{font-size:26px;color:#1f2a44}.tile em{font-style:normal;font-size:12px}
  .periods{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px}.up{color:#1e8a4c}.down{color:#c0392b}
  .row{display:flex;gap:8px;align-items:center}.wrapr{flex-wrap:wrap;margin-bottom:8px}.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px}.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;align-items:end}
  .bar{display:grid;grid-template-columns:150px 1fr 90px 46px;gap:8px;align-items:center;font-size:12px;margin:3px 0}.bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar div{background:#f0f2f7;border-radius:4px;height:8px}.bar i{display:block;height:8px;border-radius:4px;background:#2f7cf6}.bar b{text-align:right}.bar small{color:#8a95a8;text-align:right}
  table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;color:#8a95a8;font-weight:700;padding:5px 6px;border-bottom:1px solid #eef0f5;white-space:nowrap}td{padding:5px 6px;border-bottom:1px solid #f4f5f8;white-space:nowrap}td.nm{white-space:normal;min-width:140px}td small,.nm small{display:block;color:#8a95a8;font-size:11px}
  .stale{color:#b8860b}.src,.tag{font-size:10px;font-weight:700;background:#f0f2f7;color:#53607a;border-radius:5px;padding:1px 6px;margin-left:4px}.tag.src,small.src{background:#eaf2ff;color:#2f6fe4}.dt{background:#f3edff;color:#6a3fd6}.warnt{background:#fdeceb;color:#c0392b}
  tr.hit{background:#e9f7ef}.acct .row{flex-wrap:wrap}.sig{border-left:3px solid #8da2f0;padding:6px 10px;margin:6px 0;display:grid;gap:3px}.sig.up{border-color:#2a9d5c}.sig.down{border-color:#d9534f}.sig.warn{border-color:#e8a33d}.sig p{margin:0;color:#53607a}.sig small{color:#6b7690}
  .dec{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #f4f5f8;flex-wrap:wrap}.plan{border-top:1px solid #f0f2f7;padding:8px 0;display:grid;gap:4px}.plan p{margin:0}.kv{display:flex;gap:14px;flex-wrap:wrap;color:#53607a}.due{color:#c0392b;font-weight:700}
  label{display:grid;gap:3px;font-size:11px;font-weight:700;color:#53607a}label.chk{display:flex;gap:6px;align-items:center;font-size:13px;font-weight:600}.wide{grid-column:1/-1}.end{justify-content:flex-end;margin-top:10px}
  .ok{color:#1e7a47;font-weight:600}.err{color:#a5414d}.item{border-top:1px solid #f0f2f7;padding:8px 0}.sub{padding-left:14px}.report{border:1px solid #eef0f5;border-radius:9px;padding:10px;margin-top:8px;display:grid;gap:6px}
  .backdrop{position:fixed;inset:0;background:#151c2d55;z-index:60;display:grid;place-items:start center;padding:5vh 16px;overflow:auto}.sheet{background:#fff;border-radius:14px;padding:18px;width:min(900px,100%)}
  @media(max-width:700px){.bar{grid-template-columns:100px 1fr 80px}.bar small{display:none}}
</style>
