// Finance model shared by server and browser. Pure; unit-tested (tests/finance-model.test.ts).
// Ported from AJAdvisor (holdings.ts, autoCategories.ts, tradingDay.ts, signals.ts, mutedSignals.ts) with the same
// thresholds and rules, so numbers and insights match what the owner saw there.

export type Account = { id: string; name: string; type: string; owner: string | null; brokerage: string | null; source: string; etradeAccountIdKey: string | null; plaidAccountId: string | null; plaidItemId: string | null; notes: string | null; lastSyncedAt: string | null };
export type Holding = { id: string; accountId: string; ticker: string; name: string; quantity: number; costBasis: number; currentPrice: number | null; previousClose: number | null; priceSource: string | null; priceAt: string | null; source: string; notes: string | null; categories: string[] };
export type Property = { id: string; location: string; name: string | null; units: number; cost: number | null; owner: string | null; yearAcquired: number | null; marketValue: number | null; mortgageBalance: number | null; mortgage: string | null; mortgagePayment: number | null; currentRent: number | null; normalizedRent: number | null; interestOverall: number | null; interestProperty: number | null; insurance: number | null; hoa: number | null; realEstateTax: number | null; otherExpenses: number | null; income: number | null; zestimate: number | null; zestimateUpdatedAt: string | null; notes: string | null };
export type WatchItem = { id: string; ticker: string; name: string; targetPrice: number | null; dipPercent: number; thesis: string; currentPrice: number | null; previousClose: number | null; priceAt: string | null };
export type Plan = { id: string; ticker: string; name: string | null; purpose: string | null; strategy: string | null; targetAllocationPercent: number | null; maxAllocationPercent: number | null; buyRangeLow: number | null; buyRangeHigh: number | null; trimRangeLow: number | null; trimRangeHigh: number | null; thesis: string | null; exitConditions: string | null; notes: string | null; nextReviewDate: string | null };
export const DECISION_TYPES = ['buy', 'add', 'hold', 'trim', 'sell', 'avoid', 'research'] as const;
export const DECISION_STATUSES = ['open', 'scheduled', 'completed', 'dismissed'] as const;
export type Decision = { id: string; ticker: string; name: string | null; type: (typeof DECISION_TYPES)[number]; notes: string | null; status: (typeof DECISION_STATUSES)[number]; scheduledFor: string | null; decidedAt: string; resolvedAt: string | null };

// ---------- holdings (AJAdvisor holdings.ts) ----------
/** Total cost of a position. Some imports store the position TOTAL in the per-share field; detect that like AJAdvisor. */
export function costBasisValue(h: { quantity: number; costBasis: number; currentPrice?: number | null }): number {
  const extended = h.quantity * h.costBasis;
  if (h.currentPrice == null) return extended;
  const mv = h.quantity * h.currentPrice;
  const looksLikeTotal = h.quantity > 1 && mv > 0 && h.costBasis / mv >= 0.05 && h.costBasis / mv <= 20 && extended / mv > 20;
  return looksLikeTotal ? h.costBasis : extended;
}
export const unitCost = (h: { quantity: number; costBasis: number; currentPrice?: number | null }) => (h.quantity === 0 ? h.costBasis : costBasisValue(h) / h.quantity);
export const marketValue = (h: { quantity: number; currentPrice: number | null }) => (h.currentPrice == null ? null : h.quantity * h.currentPrice);

export type Bucket = 'cash' | 'stocks' | 'funds' | 'realEstateOther';
export function bucketOf(h: { ticker: string; name: string; categories: string[] }): Bucket {
  const cats = h.categories.map((c) => c.toLowerCase()), name = h.name.toLowerCase();
  if (h.ticker === 'CASH' || cats.includes('cash')) return 'cash';
  if (cats.includes('mutual funds') || name.includes('mutual fund')) return 'funds';
  if (cats.some((c) => c.includes('real estate') || c.includes('other asset')) || name.includes('real estate')) return 'realEstateOther';
  return 'stocks';
}

// ---------- auto categories (AJAdvisor autoCategories.ts) ----------
const MUTUAL_FUNDS = new Set(['FAGIX', 'FDEEX', 'MAPIX', 'TRSJX', 'FSEAX', 'FDEWX', 'TRRIX', 'TRRLX', 'FTEXX']);
const EVS = new Set(['BLNK', 'CHPT', 'EVGO', 'LCID', 'LIT', 'RIVN', 'TSLA', 'WBX']);
const TRAVEL = new Set(['AAL', 'ABNB', 'CCL', 'NCLH', 'DLAKY']);
const TECH = new Set(['HACK', 'META', 'NFLX', 'SOXL', 'TECL', 'TQQQ', 'XYZ', 'MSFT', 'RBLX']);
const ETFS = new Set(['HACK', 'LIT', 'SOXL', 'TECL', 'TQQQ', 'GLD']);
const MEDIA = new Set(['META', 'NFLX', 'RBLX']);
const FINTECH = new Set(['XYZ', 'CHYM', 'BR']);
export function autoCategories(h: { ticker: string; name?: string | null }): string[] {
  const t = h.ticker.trim().toUpperCase(), n = (h.name || '').toUpperCase(), c = new Set<string>();
  if (t === 'CASH' || t === 'FTEXX' || n.includes('MONEY MARKET')) c.add('Cash');
  if (MUTUAL_FUNDS.has(t) || n.includes('FUND')) c.add('Mutual Funds');
  if (EVS.has(t) || n.includes('ELECTRIC') || n.includes('LITHIUM')) c.add('EVs');
  if (ETFS.has(t) || /\bETF\b/.test(n) || n.includes('PROSHARES')) c.add('ETFs');
  if (TRAVEL.has(t) || n.includes('AIRLINE') || n.includes('CRUISE')) c.add('Travel & Leisure');
  if (TECH.has(t) || n.includes('TECH')) c.add('Technology');
  if (t === 'HACK' || n.includes('CYBERSECURITY')) c.add('Cybersecurity');
  if (t === 'DUK' || n.includes('ENERGY')) c.add('Energy & Utilities');
  if (MEDIA.has(t)) c.add('Media & Entertainment');
  if (t === 'SHIP' || n.includes('MARITIME')) c.add('Shipping');
  if (FINTECH.has(t) || n.includes('BLOCK INC')) c.add('Financial Technology');
  return [...c];
}

// ---------- trading day (AJAdvisor tradingDay.ts) ----------
/** YYYY-MM-DD of the trading day a snapshot represents: today's NY date on weekdays, the last Friday on weekends. */
export function tradingDay(now = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now).map((x) => [x.type, x.value]));
  let t = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  if (p.weekday === 'Sun') t -= 2 * 86_400_000; else if (p.weekday === 'Sat') t -= 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
export const isMarketWeekday = (now = new Date()) => !['Sat', 'Sun'].includes(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now));
/** Regular US session (9:30–16:00 NY) plus 30 min after the close, for refresh scheduling. */
export function marketOpen(now = new Date()): boolean {
  if (!isMarketWeekday(now)) return false;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  const m = Number(p.hour) * 60 + Number(p.minute);
  return m >= 570 && m <= 990;
}
/** A price older than this (or missing) is flagged stale in the UI. */
export const STALE_PRICE_MS = 26 * 3_600_000;
export const isStale = (priceAt: string | null, now = Date.now()) => !priceAt || now - Date.parse(priceAt) > STALE_PRICE_MS;

// ---------- positions & portfolio ----------
export type PositionAgg = { ticker: string; name: string; quantity: number; marketValue: number; costBasis: number; todayChange: number; previousValue: number; currentPrice: number | null; unitCost: number; isFund: boolean; accountIds: string[]; accountNames: string[]; categories: string[] };

/** One row per ticker across accounts (cash excluded), like AJAdvisor's dashboard aggregation. */
export function positions(holdings: Holding[], accounts: Account[]): PositionAgg[] {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const by = new Map<string, PositionAgg>();
  for (const h of holdings) {
    if (bucketOf(h) === 'cash') continue;
    const mv = marketValue(h) ?? 0, cost = costBasisValue(h);
    const prev = h.previousClose != null ? h.quantity * h.previousClose : mv;
    const p = by.get(h.ticker) || { ticker: h.ticker, name: h.name, quantity: 0, marketValue: 0, costBasis: 0, todayChange: 0, previousValue: 0, currentPrice: h.currentPrice, unitCost: 0, isFund: false, accountIds: [], accountNames: [], categories: [] };
    p.quantity += h.quantity; p.marketValue += mv; p.costBasis += cost; p.previousValue += prev; p.todayChange += mv - prev;
    p.currentPrice ??= h.currentPrice;
    p.isFund ||= bucketOf(h) === 'funds' || h.categories.includes('ETFs');
    if (!p.accountIds.includes(h.accountId)) { p.accountIds.push(h.accountId); p.accountNames.push(names.get(h.accountId) || h.accountId); }
    for (const c of h.categories) if (!p.categories.includes(c)) p.categories.push(c);
    by.set(h.ticker, p);
  }
  for (const p of by.values()) p.unitCost = p.quantity > 0 ? p.costBasis / p.quantity : 0;
  return [...by.values()].sort((a, b) => b.marketValue - a.marketValue);
}

/** Real estate: value (market value, else Zestimate), mortgage, equity, monthly cash flow (stored income, else rent − monthly costs). */
export function propertyMetrics(p: Property) {
  const value = p.marketValue ?? p.zestimate ?? 0, mortgage = p.mortgageBalance ?? 0;
  const monthlyCosts = (p.insurance ?? 0) + (p.hoa ?? 0) + (p.realEstateTax ?? 0) + (p.otherExpenses ?? 0) + (p.interestProperty ?? 0);
  const cashFlow = p.income ?? (p.currentRent != null ? p.currentRent - monthlyCosts - (p.mortgagePayment ?? 0) : null);
  return { value, mortgage, equity: value - mortgage, monthlyCosts, cashFlow, gain: p.cost != null ? value - p.cost : null, valueSource: p.marketValue != null ? 'market value' : p.zestimate != null ? 'Zestimate' : 'none' };
}

export type Summary = {
  investments: number; cash: number; costBasis: number; dayChange: number; gain: number; buckets: Record<Bucket, number>;
  realEstateValue: number; realEstateMortgage: number; realEstateEquity: number; monthlyRentalCashFlow: number; netWorth: number;
  missingPrices: { ticker: string; name: string }[]; stalePrices: { ticker: string; name: string; priceAt: string | null }[];
  byAccount: { id: string; name: string; type: string; owner: string | null; value: number; cash: number; cost: number; dayChange: number }[];
  byOwner: Record<string, number>; byType: Record<string, number>; byCategory: Record<string, number>;
};
/** Everything on the dashboard. Market value is kept separate from cost basis; holdings without a price are reported, not guessed. */
export function summarize(holdings: Holding[], accounts: Account[], properties: Property[], now = Date.now()): Summary {
  const buckets: Record<Bucket, number> = { cash: 0, stocks: 0, funds: 0, realEstateOther: 0 };
  const acct = new Map(accounts.map((a) => [a.id, { id: a.id, name: a.name, type: a.type, owner: a.owner, value: 0, cash: 0, cost: 0, dayChange: 0 }]));
  const byOwner: Record<string, number> = {}, byType: Record<string, number> = {}, byCategory: Record<string, number> = {};
  let costBasis = 0, dayChange = 0;
  const missingPrices: Summary['missingPrices'] = [], stalePrices: Summary['stalePrices'] = [];
  for (const h of holdings) {
    const b = bucketOf(h), mv = marketValue(h), cost = costBasisValue(h);
    if (mv == null) { if (b !== 'cash') missingPrices.push({ ticker: h.ticker, name: h.name }); }
    else if (b !== 'cash' && isStale(h.priceAt, now)) stalePrices.push({ ticker: h.ticker, name: h.name, priceAt: h.priceAt });
    const v = mv ?? 0, dc = h.currentPrice != null && h.previousClose != null ? (h.currentPrice - h.previousClose) * h.quantity : 0;
    buckets[b] += v; costBasis += cost; dayChange += dc;
    const a = acct.get(h.accountId);
    if (a) { if (b === 'cash') a.cash += v; else a.value += v; a.cost += cost; a.dayChange += dc; }
    const account = accounts.find((x) => x.id === h.accountId);
    byOwner[account?.owner || 'Unassigned'] = (byOwner[account?.owner || 'Unassigned'] || 0) + v;
    byType[account?.type || 'Other'] = (byType[account?.type || 'Other'] || 0) + v;
    for (const c of h.categories.length ? h.categories : ['Uncategorized']) byCategory[c] = (byCategory[c] || 0) + v;
  }
  let realEstateValue = 0, realEstateMortgage = 0, monthlyRentalCashFlow = 0;
  for (const p of properties) { const m = propertyMetrics(p); realEstateValue += m.value; realEstateMortgage += m.mortgage; monthlyRentalCashFlow += m.cashFlow ?? 0; }
  const investments = buckets.stocks + buckets.funds + buckets.realEstateOther;
  const realEstateEquity = realEstateValue - realEstateMortgage;
  return {
    investments, cash: buckets.cash, costBasis, dayChange, gain: investments + buckets.cash - costBasis, buckets,
    realEstateValue, realEstateMortgage, realEstateEquity, monthlyRentalCashFlow, netWorth: investments + buckets.cash + realEstateEquity,
    missingPrices, stalePrices, byAccount: [...acct.values()].sort((a, b) => b.value + b.cash - (a.value + a.cash)), byOwner, byType, byCategory
  };
}

// ---------- history ranges (AJAdvisor history.ts) ----------
export const RANGES = ['1W', '1M', '3M', 'YTD', '1Y', 'ALL'] as const;
export type Range = (typeof RANGES)[number];
export function rangeStart(range: Range, earliest: string, today = new Date().toISOString().slice(0, 10)): string {
  const d = new Date(`${today}T12:00:00Z`);
  const back = (days: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - days); return x.toISOString().slice(0, 10); };
  const s = range === '1W' ? back(7) : range === '1M' ? back(30) : range === '3M' ? back(91) : range === 'YTD' ? `${today.slice(0, 4)}-01-01` : range === '1Y' ? back(365) : earliest;
  return s < earliest ? earliest : s;
}
/** Change between the first and last snapshot in a window (absolute and %). */
export function periodChange(series: { date: string; value: number }[], from: string): { change: number; percent: number | null; start: number | null; end: number | null } {
  const win = series.filter((p) => p.date >= from);
  if (win.length < 2) return { change: 0, percent: null, start: win[0]?.value ?? null, end: win[0]?.value ?? null };
  const start = win[0].value, end = win[win.length - 1].value;
  return { change: end - start, percent: start ? ((end - start) / start) * 100 : null, start, end };
}

// ---------- muting (AJAdvisor mutedSignals.ts) ----------
export const MUTE_DURATIONS = { '1d': 1, '1w': 7, '1m': 30, '3m': 90, forever: null } as const;
export type MuteDuration = keyof typeof MUTE_DURATIONS;
export function mutedUntil(duration: MuteDuration, from = new Date()): string | null {
  const days = MUTE_DURATIONS[duration];
  return days == null ? null : new Date(from.getTime() + days * 86_400_000).toISOString();
}
export const isMuted = (m: { mutedUntil: string | null; unmutedAt: string | null }, now = Date.now()) => !m.unmutedAt && (m.mutedUntil == null || Date.parse(m.mutedUntil) > now);

// ---------- insights (AJAdvisor signals.ts, same thresholds) ----------
export type SignalKind = 'move' | 'buy' | 'trim' | 'cash' | 'risk' | 'event' | 'thesis' | 'data' | 'review';
export type Signal = { id: string; kind: SignalKind; score: number; ticker?: string; title: string; why: string; next: string; tone: 'up' | 'down' | 'warn' | 'info' };
export const KIND_META: Record<SignalKind, { label: string; section: string }> = {
  move: { label: 'Big move', section: 'Since yesterday' }, buy: { label: 'Buy candidate', section: 'Buy candidates' }, trim: { label: 'Trim / exit', section: 'Trim or exit review' },
  cash: { label: 'Cash idle', section: 'Cash deployment' }, risk: { label: 'Concentration', section: 'Concentration' }, event: { label: 'Upcoming event', section: 'Upcoming events' },
  thesis: { label: 'Thesis check', section: 'Thesis checks' }, data: { label: 'Data issue', section: 'Data health' }, review: { label: 'Review due', section: 'Plan reviews' }
};
const MOVE_PERCENT = 3, TRIM_GAIN_PERCENT = 75, EXIT_LOSS_PERCENT = 25, CONC_STOCK = 10, CONC_FUND = 25, CASH_PCT = 4, CASH_MIN = 500, EVENT_DAYS = 14;
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 });
const pct = (n: number) => n.toFixed(Math.abs(n) >= 10 ? 0 : 1);
const label = (t: string, n?: string | null) => (!n?.trim() || n.trim().toUpperCase() === t.toUpperCase() ? t : `${t} (${n.trim()})`);
const RETIREMENT = /ira|401|403|457|hsa|retire|roth|sep/i;

export type SignalInput = {
  positions: PositionAgg[]; watchlist: WatchItem[]; accounts: { id: string; name: string; type: string; cash: number }[];
  totalMarketValue: number; totalCash: number; discountThreshold: number; earnings: Record<string, string | null>;
  missingPrices: { ticker: string; name: string }[]; sessionLabel: string; plans: Plan[]; now?: number;
};
export function buildSignals(input: SignalInput): Signal[] {
  const out: Signal[] = [], now = input.now ?? Date.now();
  const sane = (p: PositionAgg) => p.quantity > 0 && p.marketValue > 0;
  const planBy = new Map(input.plans.map((p) => [p.ticker, p]));
  const total = input.totalMarketValue, withCash = total + input.totalCash;
  for (const p of input.positions) {
    if (!sane(p) || p.previousValue <= 0) continue;
    const today = (p.todayChange / p.previousValue) * 100;
    if (Math.abs(today) < MOVE_PERCENT) continue;
    const up = p.todayChange >= 0;
    out.push({ id: `move-${p.ticker}`, kind: 'move', score: Math.min(90, Math.abs(today) * 7 + Math.abs(p.todayChange) / 200), ticker: p.ticker, tone: up ? 'up' : 'down',
      title: `${label(p.ticker, p.name)} ${up ? 'rose' : 'fell'} ${usd(Math.abs(p.todayChange) / p.quantity)}/share (${up ? '+' : '-'}${pct(Math.abs(today))}%) ${input.sessionLabel}`,
      why: `A one-session move of ${pct(Math.abs(today))}% is well beyond normal drift — your ${usd(p.marketValue)} position changed ${up ? '+' : ''}${usd(p.todayChange)}.`,
      next: up ? 'Find what drove the jump. If the story is unchanged, consider whether it pulled forward your price target.' : 'Find the cause of the drop. Company-specific bad news: reassess the thesis; market noise: maybe a buying window.' });
  }
  for (const p of input.positions) {
    if (!sane(p) || p.currentPrice == null || p.unitCost <= 0) continue;
    const discount = ((p.unitCost - p.currentPrice) / p.unitCost) * 100;
    if (discount < input.discountThreshold) continue;
    out.push({ id: `buy-basis-${p.ticker}`, kind: 'buy', score: Math.min(85, 35 + discount), ticker: p.ticker, tone: 'warn', title: `${label(p.ticker, p.name)} is ${pct(discount)}% below your average cost`,
      why: `You paid ${usd(p.unitCost)}/share on average; it now trades at ${usd(p.currentPrice)} — past your ${pct(input.discountThreshold)}% threshold.`, next: 'Re-verify the thesis. If it holds, adding lowers your basis; if not, this belongs in exit review.' });
  }
  for (const w of input.watchlist) {
    if (w.currentPrice == null) continue;
    if (w.targetPrice != null && w.currentPrice <= w.targetPrice) {
      out.push({ id: `buy-target-${w.ticker}`, kind: 'buy', score: 80, ticker: w.ticker, tone: 'up', title: `${label(w.ticker, w.name)} hit your buy-below price`,
        why: `Now ${usd(w.currentPrice)}, at or under the ${usd(w.targetPrice)} you set.`, next: w.thesis ? `Re-read your thesis ("${w.thesis.slice(0, 80)}${w.thesis.length > 80 ? '…' : ''}") — if it holds, this is your entry.` : 'Confirm why you wanted it at this price, then size the position.' });
      continue;
    }
    if (w.previousClose && w.previousClose > 0) {
      const dip = ((w.previousClose - w.currentPrice) / w.previousClose) * 100;
      if (dip >= w.dipPercent) out.push({ id: `buy-dip-${w.ticker}`, kind: 'buy', score: Math.min(75, 40 + dip * 3), ticker: w.ticker, tone: 'warn', title: `Watchlist: ${label(w.ticker, w.name)} dipped ${pct(dip)}% ${input.sessionLabel}`,
        why: `You asked to be alerted on a ${pct(w.dipPercent)}% daily dip; it's at ${usd(w.currentPrice)}.`, next: 'Check whether the dip is noise or news; compare against your buy-below price.' });
    }
  }
  for (const p of input.positions) {
    if (!sane(p) || p.currentPrice == null || p.costBasis <= 0) continue;
    const gain = ((p.marketValue - p.costBasis) / p.costBasis) * 100;
    if (gain > 1000) continue;
    const share = total > 0 ? (p.marketValue / total) * 100 : 0;
    if (gain >= TRIM_GAIN_PERCENT) out.push({ id: `trim-${p.ticker}`, kind: 'trim', score: Math.min(70, 25 + gain / 5 + share), ticker: p.ticker, tone: 'up', title: `${label(p.ticker, p.name)} is up ${pct(gain)}% on your cost — trim review`,
      why: `The gain (${usd(p.marketValue - p.costBasis)}) now dominates the position${share >= CONC_STOCK ? ` and it is ${pct(share)}% of your portfolio` : ''}.`, next: 'Decide if today\'s price still offers forward returns. Selling a slice locks in gains.' });
    else if (gain <= -EXIT_LOSS_PERCENT) out.push({ id: `exit-${p.ticker}`, kind: 'trim', score: Math.min(65, 25 + Math.abs(gain) / 3), ticker: p.ticker, tone: 'down', title: `${label(p.ticker, p.name)} is down ${pct(Math.abs(gain))}% from your cost — exit review`,
      why: `A drawdown this deep (${usd(p.marketValue - p.costBasis)}) usually means the market disagrees with the thesis.`, next: 'Write down why you would buy it today. If you cannot, selling frees capital and a tax loss.' });
  }
  const cashPct = withCash > 0 ? (input.totalCash / withCash) * 100 : 0;
  const idle = input.accounts.filter((a) => a.cash >= CASH_MIN).sort((a, b) => b.cash - a.cash);
  const retirement = idle.filter((a) => RETIREMENT.test(a.type));
  if (input.totalCash > 0 && (cashPct >= CASH_PCT || retirement.length)) out.push({ id: 'cash-idle', kind: 'cash', score: Math.min(60, 20 + cashPct * 3 + (retirement.length ? 10 : 0)), tone: 'info',
    title: `${usd(input.totalCash)} in cash (${pct(cashPct)}% of portfolio) is waiting for a job`,
    why: retirement.length ? `${retirement.map((a) => `${a.name} (${usd(a.cash)})`).join(', ')} ${retirement.length === 1 ? 'is' : 'are'} tax-advantaged — idle cash there has no excuse on a long horizon.` : idle[0] ? `Largest idle pile: ${idle[0].name} with ${usd(idle[0].cash)}.` : `Cash is above the ${CASH_PCT}% comfort level.`,
    next: 'Match this cash against today\'s buy candidates, or schedule it into index funds.' });
  for (const p of input.positions) {
    if (!sane(p) || total <= 0) continue;
    const share = (p.marketValue / total) * 100, planMax = planBy.get(p.ticker)?.maxAllocationPercent ?? null;
    const limit = planMax ?? (p.isFund ? CONC_FUND : CONC_STOCK);
    if (share < limit) continue;
    out.push({ id: `risk-${p.ticker}`, kind: 'risk', score: Math.min(80, share * 2.5 + (planMax != null ? 5 : 0)), ticker: p.ticker, tone: 'warn', title: `${label(p.ticker, p.name)} is ${pct(share)}% of your portfolio`,
      why: planMax != null ? `Your plan caps this position at ${pct(limit)}%; it is past that (${usd(p.marketValue)} exposed).` : `A single ${p.isFund ? 'fund' : 'stock'} above ${limit}% means one ${p.isFund ? 'strategy' : 'company'}'s bad day moves your net worth (${usd(p.marketValue)} exposed).`,
      next: planMax != null ? 'Trim back toward the plan\'s target, or revisit the plan if conviction has grown.' : 'Decide your maximum single-position exposure; trimming back de-risks without abandoning it.' });
  }
  for (const plan of input.plans) {
    if (!plan.nextReviewDate || Date.parse(`${plan.nextReviewDate}T00:00:00Z`) > now) continue;
    const overdue = Math.max(0, Math.floor((now - Date.parse(`${plan.nextReviewDate}T00:00:00Z`)) / 86_400_000));
    out.push({ id: `review-${plan.ticker}`, kind: 'review', score: Math.min(50, 20 + overdue), ticker: plan.ticker, tone: 'info', title: `${label(plan.ticker, plan.name)} plan review is due${overdue > 0 ? ` (${overdue}d overdue)` : ''}`,
      why: 'Time to revisit whether the thesis, allocation, and buy/trim ranges still hold.', next: 'Re-read the plan, update what changed, and log a Hold/Trim/Sell/Research decision.' });
  }
  for (const p of input.positions) {
    const date = input.earnings[p.ticker];
    if (!sane(p) || !date) continue;
    const days = Math.ceil((Date.parse(`${date}T12:00:00Z`) - now) / 86_400_000);
    if (days < 0 || days > EVENT_DAYS) continue;
    out.push({ id: `event-${p.ticker}`, kind: 'event', score: Math.min(55, 20 + (EVENT_DAYS - days) * 2.5), ticker: p.ticker, tone: 'info', title: `${label(p.ticker, p.name)} reports earnings ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`} (${date})`,
      why: `Earnings are the most common cause of overnight gaps; you hold ${usd(p.marketValue)} going into the print.`, next: 'Decide before the print whether you would add on a dip or trim into strength.' });
  }
  for (const w of input.watchlist) {
    if (w.thesis && w.targetPrice != null) continue;
    out.push({ id: `thesis-${w.ticker}`, kind: 'thesis', score: 12, ticker: w.ticker, tone: 'info', title: `${label(w.ticker, w.name)} is on your radar without ${!w.thesis && w.targetPrice == null ? 'a thesis or buy price' : !w.thesis ? 'a thesis' : 'a buy price'}`,
      why: 'A watchlist entry can only produce a real buy signal with both a written reason and an attractive price.', next: !w.thesis ? 'Write one sentence on why it deserves your money, then set a bargain price.' : 'Set a buy-below price so you get alerted when it gets there.' });
  }
  for (const p of input.positions) {
    if (p.quantity <= 0) { out.push({ id: `data-qty-${p.ticker}`, kind: 'data', score: 45, ticker: p.ticker, tone: 'warn', title: `${label(p.ticker, p.name)} nets out to ${p.quantity} shares — bookkeeping error`, why: `Across ${p.accountNames.slice(0, 4).join(', ')} the share count is zero or negative.`, next: 'Correct or delete the leftover rows for this ticker.' }); continue; }
    if (p.currentPrice != null && p.unitCost <= 0 && p.marketValue > 0) { out.push({ id: `data-basis-${p.ticker}`, kind: 'data', score: 30, ticker: p.ticker, tone: 'warn', title: `${label(p.ticker, p.name)} has no cost basis recorded`, why: `Worth ${usd(p.marketValue)} but its cost is blank, so gain/loss can't be computed.`, next: 'Edit the holding and enter what you paid per share.' }); continue; }
    if (p.costBasis > 0 && p.marketValue > 0 && ((p.marketValue - p.costBasis) / p.costBasis) * 100 > 1000) out.push({ id: `data-gain-${p.ticker}`, kind: 'data', score: 35, ticker: p.ticker, tone: 'warn', title: `${label(p.ticker, p.name)} shows a +${pct(((p.marketValue - p.costBasis) / p.costBasis) * 100)}% gain — cost basis looks wrong`, why: `Recorded cost ${usd(p.costBasis)} for a position worth ${usd(p.marketValue)} is usually an import placeholder.`, next: 'Set the real cost per share.' });
  }
  if (input.missingPrices.length) out.push({ id: 'data-missing-prices', kind: 'data', score: 50, tone: 'warn', title: `${input.missingPrices.length} holding${input.missingPrices.length === 1 ? ' has' : 's have'} no live price: ${input.missingPrices.slice(0, 5).map((h) => label(h.ticker, h.name)).join(', ')}${input.missingPrices.length > 5 ? '…' : ''}`,
    why: 'Totals and signals exclude these positions, so your numbers are understated.', next: 'Fix the ticker symbol (mutual funds often need the 5-letter symbol) or enter a manual price.' });
  return out.sort((a, b) => b.score - a.score);
}

// ---------- CSV (AJAdvisor csv.ts format, so exports/imports are interchangeable) ----------
export const CSV_HEADERS = ['Account', 'Account Type', 'Owner', 'Brokerage', 'Category', 'Ticker', 'Name', 'Quantity', 'Avg Cost Basis', 'Cost Basis Total', 'Current Price', 'Market Value', 'Notes'];
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function holdingsCsv(holdings: Holding[], accounts: Account[]): string {
  const by = new Map(accounts.map((a) => [a.id, a]));
  const lines = [CSV_HEADERS.join(',')];
  for (const h of holdings) {
    const a = by.get(h.accountId), mv = marketValue(h);
    lines.push([a?.name || '', a?.type || '', a?.owner || '', a?.brokerage || '', h.categories.join('; '), h.ticker, h.name, String(h.quantity), unitCost(h).toFixed(4), costBasisValue(h).toFixed(2), h.currentPrice == null ? '' : String(h.currentPrice), mv == null ? '' : mv.toFixed(2), h.notes || ''].map(esc).join(','));
  }
  return lines.join('\n');
}
/** Parse a holdings CSV (same columns as export; extra/missing optional columns tolerated). Returns rows + per-line errors. */
export function parseHoldingsCsv(text: string): { rows: { account: string; accountType: string; owner: string; brokerage: string; categories: string[]; ticker: string; name: string; quantity: number; unitCost: number; currentPrice: number | null; notes: string }[]; errors: string[] } {
  const parse = (line: string) => { const out: string[] = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()); };
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ['The file is empty.'] };
  const head = parse(lines[0]).map((h) => h.toLowerCase()), col = (n: string) => head.indexOf(n.toLowerCase());
  const errors: string[] = [], rows: ReturnType<typeof parseHoldingsCsv>['rows'] = [];
  if (col('Ticker') < 0 || col('Quantity') < 0 || col('Account') < 0) return { rows: [], errors: ['Missing required columns: Account, Ticker, Quantity.'] };
  const num = (v: string | undefined) => { const n = Number(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };
  lines.slice(1).forEach((line, i) => {
    const c = parse(line), g = (n: string) => (col(n) >= 0 ? c[col(n)] || '' : '');
    const ticker = g('Ticker').toUpperCase(), quantity = num(g('Quantity')), account = g('Account');
    if (!ticker || quantity == null || !account) { errors.push(`Line ${i + 2}: needs Account, Ticker and a numeric Quantity.`); return; }
    const avg = num(g('Avg Cost Basis')), total = num(g('Cost Basis Total'));
    rows.push({ account, accountType: g('Account Type') || 'Regular Brokerage', owner: g('Owner'), brokerage: g('Brokerage'), categories: g('Category').split(/;\s*/).filter(Boolean), ticker, name: g('Name') || ticker, quantity, unitCost: avg ?? (total != null && quantity ? total / quantity : 0), currentPrice: num(g('Current Price')), notes: g('Notes') });
  });
  return { rows, errors };
}
