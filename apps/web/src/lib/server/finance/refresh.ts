// Finance refresh cycle (AJAdvisor refreshCore.ts + snapshots.ts + marketAlerts.ts, reimplemented on AadOS):
// quotes for holdings, watchlist and benchmarks → daily snapshots (holdings, accounts, portfolio incl. real-estate
// equity) → alerts raised through AadOS's own notification center (reminders). Idempotent: snapshots upsert per
// trading day and each alert is raised once per key.
import { updateState } from '../aados-store';
import { createReminder } from '../reminders';
import { alertSettings, claimAlert, db, getSetting, loadAll, newId, setSetting, type FinanceData, type Q } from './db';
import { fetchEarnings, fetchQuotes, type Quote } from './quotes';
import { bucketOf, buildSignals, costBasisValue, isMuted, marketValue, positions, propertyMetrics, summarize, tradingDay, isMarketWeekday, marketOpen } from '$lib/finance/model';

export const BENCHMARKS = ['SPY', 'QQQ', 'DIA', 'IWM'];
export type RefreshResult = { updated: number; failedTickers: string[]; totalTickers: number; durationMs: number; refreshedAt: string; error: string | null; alerts: number };

export async function refreshPrices(q?: Q): Promise<RefreshResult> {
  q ??= await db();
  const started = Date.now();
  const data = await loadAll(q);
  const tickers = [...new Set(data.holdings.map((h) => h.ticker.toUpperCase()).filter((t) => t !== 'CASH'))];
  let error: string | null = null, quotes = new Map<string, Quote>(), bench = new Map<string, Quote>();
  try { [quotes, bench] = await Promise.all([fetchQuotes([...tickers, ...data.watchlist.map((w) => w.ticker)]), fetchQuotes(BENCHMARKS)]); }
  catch (e) { error = e instanceof Error ? e.message : 'Quote refresh failed'; }
  let updated = 0;
  for (const h of data.holdings) {
    if (h.ticker === 'CASH') { await q.query("UPDATE fin_holdings SET current_price = 1, previous_close = 1, price_source = 'cash', price_at = now() WHERE id = $1", [h.id]); continue; }
    const quote = quotes.get(h.ticker.toUpperCase());
    if (quote) { updated++; await q.query("UPDATE fin_holdings SET current_price = $2, previous_close = $3, price_source = 'yahoo', price_at = $4 WHERE id = $1", [h.id, quote.price, quote.previousClose, quote.time]); }
    // No quote feed (fund units, CUSIPs): a stale previous close would fake a permanent daily move — align it.
    else if (!error && h.currentPrice != null && h.previousClose !== h.currentPrice) await q.query('UPDATE fin_holdings SET previous_close = current_price WHERE id = $1', [h.id]);
  }
  for (const w of data.watchlist) { const quote = quotes.get(w.ticker); if (quote) await q.query('UPDATE fin_watchlist SET current_price = $2, previous_close = $3, price_at = $4 WHERE id = $1', [w.id, quote.price, quote.previousClose, quote.time]); }
  // Earnings dates, refreshed at most every 12 hours (≤ 12 lookups per run).
  const earnings = await getSetting<{ at: number; dates: Record<string, string | null> }>(q, 'earnings', { at: 0, dates: {} });
  if (Date.now() - earnings.at > 12 * 3_600_000 && tickers.length) {
    const stale = tickers.filter((t) => !(t in earnings.dates)).concat(tickers.filter((t) => t in earnings.dates));
    const fresh = await fetchEarnings(stale).catch(() => ({}));
    await setSetting(q, 'earnings', { at: Date.now(), dates: { ...earnings.dates, ...fresh } });
  }
  const benchmarks: Record<string, number> = {};
  for (const t of BENCHMARKS) { const b = bench.get(t); if (b) benchmarks[t] = b.price; }
  try { await captureSnapshot(q, benchmarks); } catch { /* a snapshot failure never fails the refresh */ }
  let alerts = 0;
  try { alerts = await evaluateAlerts(q); } catch { /* alerts are best-effort */ }
  const result: RefreshResult = { updated, failedTickers: tickers.filter((t) => !quotes.has(t)).sort(), totalTickers: tickers.length, durationMs: Date.now() - started, refreshedAt: new Date().toISOString(), error, alerts };
  await setSetting(q, 'lastRefresh', result);
  return result;
}

/** Today's (trading day's) snapshot for every holding, account and the whole portfolio. Upserts — safe to repeat. */
export async function captureSnapshot(q: Q, benchmarks: Record<string, number>, data?: FinanceData) {
  data ??= await loadAll(q);
  const date = tradingDay();
  for (const h of data.holdings) {
    const mv = marketValue(h), dc = h.currentPrice != null && h.previousClose != null ? (h.currentPrice - h.previousClose) * h.quantity : null;
    await q.query(`INSERT INTO fin_holding_snapshots (id, date, holding_id, account_id, ticker, name, quantity, price, market_value, cost_basis, day_change, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), now())
      ON CONFLICT (date, holding_id) DO UPDATE SET account_id = EXCLUDED.account_id, ticker = EXCLUDED.ticker, name = EXCLUDED.name, quantity = EXCLUDED.quantity, price = EXCLUDED.price, market_value = EXCLUDED.market_value, cost_basis = EXCLUDED.cost_basis, day_change = EXCLUDED.day_change, updated_at = now()`,
      [newId(), date, h.id, h.accountId, h.ticker, h.name, h.quantity, h.currentPrice, mv, costBasisValue(h), dc]);
  }
  const s = summarize(data.holdings, data.accounts, data.properties);
  for (const a of s.byAccount) {
    const acct = data.accounts.find((x) => x.id === a.id)!;
    await q.query(`INSERT INTO fin_account_snapshots (id, date, account_id, name, type, market_value, cost_basis, cash, day_change, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), now())
      ON CONFLICT (date, account_id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, market_value = EXCLUDED.market_value, cost_basis = EXCLUDED.cost_basis, cash = EXCLUDED.cash, day_change = EXCLUDED.day_change, updated_at = now()`,
      [newId(), date, a.id, acct.name, acct.type, a.value, a.cost, a.cash, a.dayChange]);
  }
  const reCost = data.properties.reduce((t, p) => t + (p.cost ?? 0), 0);
  // Same definition as AJAdvisor's history (gross real-estate value in the total) plus the equity, so old and new rows compare.
  const total = s.buckets.cash + s.buckets.stocks + s.buckets.funds + s.buckets.realEstateOther + s.realEstateValue;
  await q.query(`INSERT INTO fin_portfolio_snapshots (id, date, total_market_value, total_cost_basis, total_cash, day_change, stocks_value, funds_value, cash_value, real_estate_value, real_estate_equity, benchmarks, inserted_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
    ON CONFLICT (date) DO UPDATE SET total_market_value = EXCLUDED.total_market_value, total_cost_basis = EXCLUDED.total_cost_basis, total_cash = EXCLUDED.total_cash, day_change = EXCLUDED.day_change, stocks_value = EXCLUDED.stocks_value,
      funds_value = EXCLUDED.funds_value, cash_value = EXCLUDED.cash_value, real_estate_value = EXCLUDED.real_estate_value, real_estate_equity = EXCLUDED.real_estate_equity, benchmarks = EXCLUDED.benchmarks, updated_at = now()`,
    [newId(), date, total, s.costBasis + reCost, s.buckets.cash, s.dayChange, s.buckets.stocks, s.buckets.funds, s.buckets.cash, s.buckets.realEstateOther + s.realEstateValue, s.realEstateEquity, JSON.stringify(benchmarks)]);
}

/** Insights for the current data (shared by the dashboard, alerts and the AI assistant). */
export async function currentSignals(q: Q, data: FinanceData) {
  const s = summarize(data.holdings, data.accounts, data.properties);
  const settings = await alertSettings(q);
  const earnings = (await getSetting<{ dates: Record<string, string | null> }>(q, 'earnings', { dates: {} })).dates;
  const all = buildSignals({
    positions: positions(data.holdings, data.accounts), watchlist: data.watchlist,
    accounts: s.byAccount.map((a) => ({ id: a.id, name: a.name, type: a.type, cash: a.cash })),
    totalMarketValue: s.investments, totalCash: s.cash, discountThreshold: settings.costBasisDiscountPercent, earnings,
    missingPrices: s.missingPrices, sessionLabel: isMarketWeekday() ? 'today' : 'on Friday', plans: data.plans
  });
  const mutedIds = new Set(data.muted.filter((m) => isMuted(m)).map((m) => m.signalId));
  return { signals: all.filter((x) => !mutedIds.has(x.id)), mutedCount: all.length - all.filter((x) => !mutedIds.has(x.id)).length, summary: s, earnings };
}

/** Raise finance alerts into AadOS notifications (once per condition per trading day). Returns how many were raised. */
export async function evaluateAlerts(q: Q, data?: FinanceData): Promise<number> {
  const settings = await alertSettings(q);
  if (!settings.enabled) return 0;
  data ??= await loadAll(q);
  const { signals } = await currentSignals(q, data);
  const day = tradingDay();
  const raise: { key: string; kind: string; title: string; ticker?: string; note: string }[] = [];
  // Price movement on held positions at the owner's threshold (separate from the 3% "big move" insight).
  for (const p of positions(data.holdings, data.accounts)) {
    if (p.previousValue <= 0 || p.quantity <= 0) continue;
    const change = (p.todayChange / p.previousValue) * 100;
    if (Math.abs(change) >= settings.movementThresholdPercent) raise.push({ key: `move-${p.ticker}-${day}`, kind: 'move', ticker: p.ticker, title: `${p.ticker} ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}% today`, note: `${p.name} · position ${p.marketValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}` });
  }
  const want = (k: string) => k === 'buy' || (k === 'risk' && settings.allocationAlerts) || (k === 'review' && settings.reviewAlerts) || (k === 'event' && settings.earningsAlerts) || (k === 'data' && settings.staleDataAlerts);
  for (const s of signals) if (want(s.kind) && !s.id.startsWith('data-qty') && !s.id.startsWith('data-basis')) raise.push({ key: `${s.id}-${day}`, kind: s.kind, ticker: s.ticker, title: s.title, note: s.next });
  // Scheduled decisions that came due.
  for (const d of data.decisions) if (d.status === 'scheduled' && d.scheduledFor && Date.parse(d.scheduledFor) <= Date.now()) raise.push({ key: `decision-${d.id}`, kind: 'decision', ticker: d.ticker, title: `Scheduled decision due: ${d.type.toUpperCase()} ${d.ticker}`, note: d.notes || '' });
  let raised = 0;
  const fresh: typeof raise = [];
  for (const a of raise) if (await claimAlert(q, a.key, a.kind, a.title, a.ticker)) { fresh.push(a); raised++; }
  if (fresh.length) await updateState((st) => { for (const a of fresh.slice(0, 15)) createReminder(st, { title: `💹 ${a.title}`.slice(0, 200), at: new Date().toISOString(), note: `${a.note}\n/finance`.slice(0, 1000) }); });
  return raised;
}

/** Connection failure alert (E*TRADE / Plaid), once per provider per day. */
export async function connectionAlert(q: Q, provider: string, message: string) {
  const settings = await alertSettings(q);
  if (!settings.enabled || !settings.connectionAlerts) return;
  if (await claimAlert(q, `conn-${provider}-${tradingDay()}`, 'connection', `${provider} connection failed`))
    await updateState((st) => { createReminder(st, { title: `💹 ${provider} connection needs attention`, at: new Date().toISOString(), note: `${message}\nFinance → Settings` }); });
}

/** Scheduler hook: refresh during market hours (every call) and once a day otherwise. */
export async function financeTick() {
  const q = await db().catch(() => null);
  if (!q) return;
  const last = await getSetting<{ refreshedAt?: string }>(q, 'lastRefresh', {});
  const age = last.refreshedAt ? Date.now() - Date.parse(last.refreshedAt) : Infinity;
  if (marketOpen() ? age > 10 * 60_000 : age > 12 * 3_600_000) await refreshPrices(q);
}
export { bucketOf, propertyMetrics };
