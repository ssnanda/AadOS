// Finance persistence (PostgreSQL tables from the API migration 20261119000001_finance). Money/quantities are NUMERIC
// in the database; they are converted to numbers only for display and calculation. Every write stamps its own
// timestamps (Ecto timestamps have no database default).
import { randomBytes } from 'node:crypto';
import { database } from '../aados-store';
import type { Account, Decision, Holding, Plan, Property, WatchItem } from '$lib/finance/model';

export type Q = { query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export const db = (): Promise<Q> => database();
export const newId = () => `f${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);

export const toAccount = (r: any): Account => ({ id: r.id, name: r.name, type: r.type, owner: r.owner, brokerage: r.brokerage, source: r.source, etradeAccountIdKey: r.etrade_account_id_key, plaidAccountId: r.plaid_account_id, plaidItemId: r.plaid_item_id, notes: r.notes, lastSyncedAt: iso(r.last_synced_at) });
export const toHolding = (r: any): Holding => ({ id: r.id, accountId: r.account_id, ticker: r.ticker, name: r.name, quantity: Number(r.quantity), costBasis: Number(r.cost_basis), currentPrice: n(r.current_price), previousClose: n(r.previous_close), priceSource: r.price_source, priceAt: iso(r.price_at), source: r.source, notes: r.notes, categories: r.categories || [] });
export const toProperty = (r: any): Property => ({ id: r.id, location: r.location, name: r.name, units: Number(r.units), cost: n(r.cost), owner: r.owner, yearAcquired: r.year_acquired, marketValue: n(r.market_value), mortgageBalance: n(r.mortgage_balance), mortgage: r.mortgage, mortgagePayment: n(r.mortgage_payment), currentRent: n(r.current_rent), normalizedRent: n(r.normalized_rent), interestOverall: n(r.interest_overall), interestProperty: n(r.interest_property), insurance: n(r.insurance), hoa: n(r.hoa), realEstateTax: n(r.real_estate_tax), otherExpenses: n(r.other_expenses), income: n(r.income), zestimate: n(r.zestimate), zestimateUpdatedAt: iso(r.zestimate_updated_at), notes: r.notes });
export const toWatch = (r: any): WatchItem => ({ id: r.id, ticker: r.ticker, name: r.name, targetPrice: n(r.target_price), dipPercent: Number(r.dip_percent), thesis: r.thesis, currentPrice: n(r.current_price), previousClose: n(r.previous_close), priceAt: iso(r.price_at) });
export const toPlan = (r: any): Plan => ({ id: r.id, ticker: r.ticker, name: r.name, purpose: r.purpose, strategy: r.strategy, targetAllocationPercent: n(r.target_allocation_percent), maxAllocationPercent: n(r.max_allocation_percent), buyRangeLow: n(r.buy_range_low), buyRangeHigh: n(r.buy_range_high), trimRangeLow: n(r.trim_range_low), trimRangeHigh: n(r.trim_range_high), thesis: r.thesis, exitConditions: r.exit_conditions, notes: r.notes, nextReviewDate: day(r.next_review_date) });
export const toDecision = (r: any): Decision => ({ id: r.id, ticker: r.ticker, name: r.name, type: r.type, notes: r.notes, status: r.status, scheduledFor: iso(r.scheduled_for), decidedAt: iso(r.decided_at)!, resolvedAt: iso(r.resolved_at) });

const HOLDINGS_SQL = `SELECT h.*, COALESCE(array_agg(c.name ORDER BY c.name) FILTER (WHERE c.name IS NOT NULL), '{}') AS categories
  FROM fin_holdings h LEFT JOIN fin_holding_categories hc ON hc.holding_id = h.id LEFT JOIN fin_categories c ON c.id = hc.category_id GROUP BY h.id`;

/** Everything the Finance pages need in one round of queries. */
export async function loadAll(q: Q) {
  const [accounts, holdings, properties, watch, plans, decisions, muted, cats, types, owners, brokerages] = await Promise.all([
    q.query('SELECT * FROM fin_accounts ORDER BY name'), q.query(`${HOLDINGS_SQL} ORDER BY h.ticker`), q.query('SELECT * FROM fin_properties ORDER BY location'),
    q.query('SELECT * FROM fin_watchlist ORDER BY ticker'), q.query('SELECT * FROM fin_plans ORDER BY ticker'), q.query('SELECT * FROM fin_decisions ORDER BY decided_at DESC LIMIT 500'),
    q.query('SELECT * FROM fin_muted_signals ORDER BY muted_at DESC LIMIT 200'), q.query('SELECT name FROM fin_categories ORDER BY name'),
    q.query('SELECT name FROM fin_account_types ORDER BY name'), q.query('SELECT name FROM fin_owners ORDER BY name'), q.query('SELECT name FROM fin_brokerages ORDER BY name')
  ]);
  return {
    accounts: accounts.rows.map(toAccount), holdings: holdings.rows.map(toHolding), properties: properties.rows.map(toProperty), watchlist: watch.rows.map(toWatch),
    plans: plans.rows.map(toPlan), decisions: decisions.rows.map(toDecision),
    muted: muted.rows.map((r) => ({ id: r.id, signalId: r.signal_id, title: r.signal_title, kind: r.signal_kind, ticker: r.ticker, mutedAt: iso(r.muted_at)!, mutedUntil: iso(r.muted_until), unmutedAt: iso(r.unmuted_at) })),
    categories: cats.rows.map((r) => r.name as string), accountTypes: types.rows.map((r) => r.name as string), owners: owners.rows.map((r) => r.name as string), brokerages: brokerages.rows.map((r) => r.name as string)
  };
}
export type FinanceData = Awaited<ReturnType<typeof loadAll>>;

// ---------- settings ----------
export async function getSetting<T>(q: Q, key: string, fallback: T): Promise<T> {
  const r = await q.query('SELECT value FROM fin_settings WHERE key = $1', [key]);
  return r.rows[0] ? (r.rows[0].value as T) : fallback;
}
export async function setSetting(q: Q, key: string, value: unknown) {
  await q.query('INSERT INTO fin_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, JSON.stringify(value)]);
}
export type AlertSettings = { movementThresholdPercent: number; costBasisDiscountPercent: number; allocationAlerts: boolean; earningsAlerts: boolean; reviewAlerts: boolean; staleDataAlerts: boolean; connectionAlerts: boolean; enabled: boolean };
export const DEFAULT_ALERTS: AlertSettings = { movementThresholdPercent: 3, costBasisDiscountPercent: 20, allocationAlerts: true, earningsAlerts: true, reviewAlerts: true, staleDataAlerts: true, connectionAlerts: true, enabled: true };
export const alertSettings = async (q: Q) => ({ ...DEFAULT_ALERTS, ...(await getSetting<Partial<AlertSettings>>(q, 'alerts', {})) });

// ---------- lookups (types / owners / brokerages / categories) ----------
const LOOKUP = { type: 'fin_account_types', owner: 'fin_owners', brokerage: 'fin_brokerages', category: 'fin_categories' } as const;
export type LookupKind = keyof typeof LOOKUP;
export async function ensureLookup(q: Q, kind: LookupKind, name: string): Promise<string | null> {
  const v = name.trim(); if (!v) return null;
  const r = await q.query(`INSERT INTO ${LOOKUP[kind]} (id, name, inserted_at, updated_at) VALUES ($1, $2, now(), now()) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [newId(), v]);
  return r.rows[0].id;
}
export async function renameLookup(q: Q, kind: LookupKind, from: string, to: string) {
  await q.query(`UPDATE ${LOOKUP[kind]} SET name = $2, updated_at = now() WHERE name = $1`, [from, to.trim()]);
  if (kind === 'type') await q.query('UPDATE fin_accounts SET type = $2 WHERE type = $1', [from, to.trim()]);
  if (kind === 'owner') await q.query('UPDATE fin_accounts SET owner = $2 WHERE owner = $1', [from, to.trim()]);
  if (kind === 'brokerage') await q.query('UPDATE fin_accounts SET brokerage = $2 WHERE brokerage = $1', [from, to.trim()]);
}
export async function deleteLookup(q: Q, kind: LookupKind, name: string) { await q.query(`DELETE FROM ${LOOKUP[kind]} WHERE name = $1`, [name]); }

// ---------- accounts & holdings ----------
export async function saveAccount(q: Q, a: Partial<Account> & { name: string }): Promise<string> {
  const id = a.id || newId();
  await Promise.all([a.type ? ensureLookup(q, 'type', a.type) : null, a.owner ? ensureLookup(q, 'owner', a.owner) : null, a.brokerage ? ensureLookup(q, 'brokerage', a.brokerage) : null]);
  await q.query(`INSERT INTO fin_accounts (id, name, type, owner, brokerage, source, etrade_account_id_key, plaid_account_id, plaid_item_id, notes, inserted_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, owner = EXCLUDED.owner, brokerage = EXCLUDED.brokerage, notes = EXCLUDED.notes, updated_at = now()`,
    [id, a.name.trim(), a.type || 'Regular Brokerage', a.owner || null, a.brokerage || null, a.source || 'manual', a.etradeAccountIdKey || null, a.plaidAccountId || null, a.plaidItemId || null, a.notes || null]);
  return id;
}
export async function deleteAccount(q: Q, id: string) { await q.query('DELETE FROM fin_accounts WHERE id = $1', [id]); }

export async function setHoldingCategories(q: Q, holdingId: string, names: string[]) {
  await q.query('DELETE FROM fin_holding_categories WHERE holding_id = $1', [holdingId]);
  for (const name of [...new Set(names.map((s) => s.trim()).filter(Boolean))]) {
    const cid = await ensureLookup(q, 'category', name);
    if (cid) await q.query('INSERT INTO fin_holding_categories (holding_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [holdingId, cid]);
  }
}
export async function saveHolding(q: Q, h: Partial<Holding> & { accountId: string; ticker: string }, categories?: string[]): Promise<string> {
  const id = h.id || newId();
  await q.query(`INSERT INTO fin_holdings (id, account_id, ticker, name, quantity, cost_basis, current_price, previous_close, price_source, price_at, source, notes, inserted_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
    ON CONFLICT (id) DO UPDATE SET account_id = EXCLUDED.account_id, ticker = EXCLUDED.ticker, name = EXCLUDED.name, quantity = EXCLUDED.quantity, cost_basis = EXCLUDED.cost_basis,
      current_price = COALESCE(EXCLUDED.current_price, fin_holdings.current_price), previous_close = COALESCE(EXCLUDED.previous_close, fin_holdings.previous_close),
      price_source = COALESCE(EXCLUDED.price_source, fin_holdings.price_source), price_at = COALESCE(EXCLUDED.price_at, fin_holdings.price_at), notes = EXCLUDED.notes, updated_at = now()`,
    [id, h.accountId, h.ticker.trim().toUpperCase(), (h.name || h.ticker).trim(), h.quantity ?? 0, h.costBasis ?? 0, h.currentPrice ?? null, h.previousClose ?? null, h.priceSource ?? (h.currentPrice != null ? 'manual' : null), h.currentPrice != null ? (h.priceAt || new Date().toISOString()) : null, h.source || 'manual', h.notes || null]);
  if (categories) await setHoldingCategories(q, id, categories);
  return id;
}
export async function deleteHolding(q: Q, id: string) { await q.query('DELETE FROM fin_holdings WHERE id = $1', [id]); }

// ---------- watchlist / plans / decisions / muting ----------
export async function saveWatch(q: Q, w: Partial<WatchItem> & { ticker: string }) {
  await q.query(`INSERT INTO fin_watchlist (id, ticker, name, target_price, dip_percent, thesis, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now(), now())
    ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name, target_price = EXCLUDED.target_price, dip_percent = EXCLUDED.dip_percent, thesis = EXCLUDED.thesis, updated_at = now()`,
    [w.id || newId(), w.ticker.trim().toUpperCase(), w.name || '', w.targetPrice ?? null, w.dipPercent ?? 5, w.thesis || '']);
}
export async function deleteWatch(q: Q, ticker: string) { await q.query('DELETE FROM fin_watchlist WHERE ticker = $1', [ticker]); }
export async function savePlan(q: Q, p: Partial<Plan> & { ticker: string }) {
  await q.query(`INSERT INTO fin_plans (id, ticker, name, purpose, strategy, target_allocation_percent, max_allocation_percent, buy_range_low, buy_range_high, trim_range_low, trim_range_high, thesis, exit_conditions, notes, next_review_date, inserted_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now())
    ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name, purpose = EXCLUDED.purpose, strategy = EXCLUDED.strategy, target_allocation_percent = EXCLUDED.target_allocation_percent, max_allocation_percent = EXCLUDED.max_allocation_percent,
      buy_range_low = EXCLUDED.buy_range_low, buy_range_high = EXCLUDED.buy_range_high, trim_range_low = EXCLUDED.trim_range_low, trim_range_high = EXCLUDED.trim_range_high, thesis = EXCLUDED.thesis, exit_conditions = EXCLUDED.exit_conditions, notes = EXCLUDED.notes, next_review_date = EXCLUDED.next_review_date, updated_at = now()`,
    [p.id || newId(), p.ticker.trim().toUpperCase(), p.name ?? null, p.purpose ?? null, p.strategy ?? null, p.targetAllocationPercent ?? null, p.maxAllocationPercent ?? null, p.buyRangeLow ?? null, p.buyRangeHigh ?? null, p.trimRangeLow ?? null, p.trimRangeHigh ?? null, p.thesis ?? null, p.exitConditions ?? null, p.notes ?? null, p.nextReviewDate || null]);
}
export async function deletePlan(q: Q, ticker: string) { await q.query('DELETE FROM fin_plans WHERE ticker = $1', [ticker]); }
export async function saveDecision(q: Q, d: Partial<Decision> & { ticker: string; type: Decision['type'] }) {
  const id = d.id || newId();
  await q.query(`INSERT INTO fin_decisions (id, ticker, name, type, notes, status, scheduled_for, decided_at, resolved_at, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()),$9, now(), now())
    ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, notes = EXCLUDED.notes, status = EXCLUDED.status, scheduled_for = EXCLUDED.scheduled_for, resolved_at = EXCLUDED.resolved_at, updated_at = now()`,
    [id, d.ticker.trim().toUpperCase(), d.name ?? null, d.type, d.notes ?? null, d.status || (d.scheduledFor ? 'scheduled' : 'open'), d.scheduledFor || null, d.decidedAt || null, d.status === 'completed' || d.status === 'dismissed' ? (d.resolvedAt || new Date().toISOString()) : null]);
  return id;
}
export async function deleteDecision(q: Q, id: string) { await q.query('DELETE FROM fin_decisions WHERE id = $1', [id]); }
export async function muteSignal(q: Q, s: { signalId: string; title: string; kind: string; ticker?: string; until: string | null }) {
  await q.query('INSERT INTO fin_muted_signals (id, signal_id, signal_title, signal_kind, ticker, muted_at, muted_until, inserted_at) VALUES ($1,$2,$3,$4,$5, now(), $6, now())', [newId(), s.signalId, s.title.slice(0, 250), s.kind, s.ticker || null, s.until]);
}
export async function unmuteSignal(q: Q, id: string) { await q.query('UPDATE fin_muted_signals SET unmuted_at = now() WHERE id = $1', [id]); }

// ---------- real estate ----------
const PROP_COLS = ['location', 'name', 'units', 'cost', 'owner', 'year_acquired', 'market_value', 'mortgage_balance', 'mortgage', 'mortgage_payment', 'current_rent', 'normalized_rent', 'interest_overall', 'interest_property', 'insurance', 'hoa', 'real_estate_tax', 'other_expenses', 'income', 'zestimate', 'notes'] as const;
const propVal = (p: Partial<Property>): unknown[] => [p.location, p.name ?? null, p.units ?? 1, p.cost ?? null, p.owner ?? null, p.yearAcquired ?? null, p.marketValue ?? null, p.mortgageBalance ?? null, p.mortgage ?? null, p.mortgagePayment ?? null, p.currentRent ?? null, p.normalizedRent ?? null, p.interestOverall ?? null, p.interestProperty ?? null, p.insurance ?? null, p.hoa ?? null, p.realEstateTax ?? null, p.otherExpenses ?? null, p.income ?? null, p.zestimate ?? null, p.notes ?? null];
export async function saveProperty(q: Q, p: Partial<Property> & { location: string }): Promise<string> {
  const id = p.id || newId();
  const ph = PROP_COLS.map((_, i) => `$${i + 2}`).join(',');
  await q.query(`INSERT INTO fin_properties (id, ${PROP_COLS.join(',')}, inserted_at, updated_at) VALUES ($1, ${ph}, now(), now())
    ON CONFLICT (id) DO UPDATE SET ${PROP_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()`, [id, ...propVal(p)]);
  // Valuation history: one row per day the value or mortgage was recorded.
  if (p.marketValue != null || p.mortgageBalance != null) await q.query(`INSERT INTO fin_property_valuations (property_id, date, market_value, mortgage_balance, source, inserted_at) VALUES ($1, CURRENT_DATE, $2, $3, 'manual', now())
    ON CONFLICT (property_id, date) DO UPDATE SET market_value = EXCLUDED.market_value, mortgage_balance = EXCLUDED.mortgage_balance`, [id, p.marketValue ?? null, p.mortgageBalance ?? null]);
  return id;
}
export async function deleteProperty(q: Q, id: string) { await q.query('DELETE FROM fin_properties WHERE id = $1', [id]); }
export async function propertyHistory(q: Q, id: string) {
  return (await q.query('SELECT date, market_value, mortgage_balance FROM fin_property_valuations WHERE property_id = $1 ORDER BY date', [id])).rows.map((r) => ({ date: day(r.date)!, marketValue: n(r.market_value), mortgageBalance: n(r.mortgage_balance) }));
}

// ---------- history ----------
export async function portfolioSeries(q: Q) {
  return (await q.query('SELECT * FROM fin_portfolio_snapshots ORDER BY date')).rows.map((r) => ({ date: day(r.date)!, total: Number(r.total_market_value), cost: Number(r.total_cost_basis), cash: Number(r.total_cash), dayChange: Number(r.day_change), stocks: Number(r.stocks_value), funds: Number(r.funds_value), realEstate: Number(r.real_estate_value), realEstateEquity: n(r.real_estate_equity), benchmarks: r.benchmarks || {} }));
}
export async function accountSeries(q: Q, accountId: string) {
  return (await q.query('SELECT date, market_value, cash, cost_basis, day_change FROM fin_account_snapshots WHERE account_id = $1 ORDER BY date', [accountId])).rows.map((r) => ({ date: day(r.date)!, value: Number(r.market_value) + Number(r.cash), cost: Number(r.cost_basis), dayChange: Number(r.day_change) }));
}
export async function holdingSeries(q: Q, ticker: string) {
  return (await q.query('SELECT date, SUM(market_value) mv, SUM(cost_basis) cb, AVG(price) price FROM fin_holding_snapshots WHERE ticker = $1 GROUP BY date ORDER BY date', [ticker])).rows.map((r) => ({ date: day(r.date)!, value: Number(r.mv || 0), cost: Number(r.cb || 0), price: n(r.price) }));
}

/** Alerts raised in the last `hours` (newest first) — shown on the Finance page and the Dashboard. */
export async function recentAlerts(q: Q, hours = 24 * 7, limit = 30): Promise<{ key: string; kind: string; ticker: string; title: string; at: string }[]> {
  const r = await q.query("SELECT key, kind, ticker, title, inserted_at FROM fin_alerts WHERE inserted_at > now() - ($1::int * interval '1 hour') ORDER BY inserted_at DESC LIMIT $2", [hours, limit]);
  return r.rows.map((x) => ({ key: String(x.key), kind: String(x.kind), ticker: String(x.ticker || ''), title: String(x.title), at: new Date(x.inserted_at).toISOString() }));
}
/** Record that an alert was raised; false if it was already raised (same key). */
export async function claimAlert(q: Q, key: string, kind: string, title: string, ticker?: string): Promise<boolean> {
  const r = await q.query('INSERT INTO fin_alerts (key, kind, ticker, title, inserted_at) VALUES ($1,$2,$3,$4, now()) ON CONFLICT (key) DO NOTHING', [key, kind, ticker || null, title]);
  return (r.rowCount || 0) > 0;
}
