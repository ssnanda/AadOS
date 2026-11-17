// AJAdvisor → AadOS Finance migration. Shared by the CLI (scripts/finance-migrate.ts) and Finance → Settings → Import.
// - Reads AJAdvisor's SQLite (Prisma schema) READ-ONLY; the original file is never modified.
// - Dry run reports counts, what would be inserted vs already present, and invalid/unmatched records.
// - Apply runs in ONE transaction, keeps AJAdvisor ids and original timestamps, and never overwrites a record that already
//   exists in AadOS (ON CONFLICT DO NOTHING) — repeatable without duplicates; AadOS-side edits are preserved.
// - Not migrated by design: users/sessions/auth, and provider credentials (E*TRADE tokens, Plaid access tokens) —
//   reconnect those in Finance → Settings.
// - Verification compares record counts and money totals between AJAdvisor and AadOS.
// No $lib / framework imports so the CLI can load it directly.
import { costBasisValue, marketValue, propertyMetrics, type Property } from './model.ts';

export type Sqlite = { prepare(sql: string): { all(...p: unknown[]): any[] } };
export type Pg = { query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };

const TABLES = ['Account', 'AccountType', 'AccountOwner', 'Brokerage', 'Category', 'Holding', 'HoldingCategory', 'HoldingSnapshot', 'AccountSnapshot', 'PortfolioSnapshot', 'InvestmentPlan', 'Decision', 'MutedSignal', 'RealEstateProperty'] as const;
type Table = (typeof TABLES)[number];
const DEST: Record<Table, string> = { Account: 'fin_accounts', AccountType: 'fin_account_types', AccountOwner: 'fin_owners', Brokerage: 'fin_brokerages', Category: 'fin_categories', Holding: 'fin_holdings', HoldingCategory: 'fin_holding_categories', HoldingSnapshot: 'fin_holding_snapshots', AccountSnapshot: 'fin_account_snapshots', PortfolioSnapshot: 'fin_portfolio_snapshots', InvestmentPlan: 'fin_plans', Decision: 'fin_decisions', MutedSignal: 'fin_muted_signals', RealEstateProperty: 'fin_properties' };

/** Prisma/SQLite dates are epoch ms integers (or ISO strings). */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : NaN;
  const d = Number.isFinite(n) ? new Date(n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
const day = (v: unknown) => toDate(v)?.toISOString().slice(0, 10) ?? null;
const ts = (v: unknown) => toDate(v)?.toISOString() ?? new Date().toISOString();
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export type Report = {
  mode: 'dry-run' | 'apply'; at: string; source: Record<string, number>; existing: Record<string, number>; inserted: Record<string, number>;
  invalid: { table: string; id: string; reason: string }[]; notMigrated: string[];
  totals: { ajadvisor: Totals; aados: Totals | null; matches: boolean | null; differences: string[] };
};
type Totals = { holdings: number; marketValue: number; costBasis: number; properties: number; realEstateValue: number; mortgage: number; latestSnapshotTotal: number | null };
const round2 = (n: number) => Math.round(n * 100) / 100;

function read(db: Sqlite) {
  const all: Record<string, any[]> = {};
  const has = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  for (const t of TABLES) all[t] = has.has(t) ? db.prepare(`SELECT * FROM "${t}"`).all() : [];
  const settings = has.has('AppSetting') ? Object.fromEntries(db.prepare('SELECT key, value FROM AppSetting').all().map((r) => [r.key, r.value])) : {};
  let watchlist: any[] = [];
  try { watchlist = JSON.parse(settings['market.watchlist'] || '[]'); } catch { watchlist = []; }
  return { all, settings, watchlist: Array.isArray(watchlist) ? watchlist : [] };
}

function validate(all: Record<string, any[]>) {
  const invalid: Report['invalid'] = [];
  const accountIds = new Set(all.Account.map((a) => a.id)), holdingIds = new Set(all.Holding.map((h) => h.id)), categoryIds = new Set(all.Category.map((c) => c.id));
  for (const a of all.Account) if (!a.name) invalid.push({ table: 'Account', id: a.id, reason: 'missing name' });
  for (const h of all.Holding) {
    if (!accountIds.has(h.accountId)) invalid.push({ table: 'Holding', id: h.id, reason: `account ${h.accountId} not found` });
    else if (!h.ticker || num(h.quantity) === null) invalid.push({ table: 'Holding', id: h.id, reason: 'missing ticker or quantity' });
  }
  for (const hc of all.HoldingCategory) if (!holdingIds.has(hc.holdingId) || !categoryIds.has(hc.categoryId)) invalid.push({ table: 'HoldingCategory', id: `${hc.holdingId}/${hc.categoryId}`, reason: 'holding or category not found' });
  for (const p of all.RealEstateProperty) if (!p.location) invalid.push({ table: 'RealEstateProperty', id: p.id, reason: 'missing location' });
  for (const d of all.Decision) if (!['buy', 'add', 'hold', 'trim', 'sell', 'avoid', 'research'].includes(String(d.type).toLowerCase())) invalid.push({ table: 'Decision', id: d.id, reason: `unknown type ${d.type}` });
  return invalid;
}

function ajTotals(all: Record<string, any[]>, valid: (t: string, id: string) => boolean): Totals {
  const hs = all.Holding.filter((h) => valid('Holding', h.id)).map((h) => ({ quantity: Number(h.quantity), costBasis: Number(h.costBasis), currentPrice: num(h.currentPrice) }));
  const props = all.RealEstateProperty.filter((p) => valid('RealEstateProperty', p.id)).map((p) => ({ marketValue: num(p.marketValue), zestimate: num(p.zestimate), mortgageBalance: num(p.mortgageBalance) }) as Property);
  const latest = [...all.PortfolioSnapshot].sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))[0];
  return { holdings: hs.length, marketValue: round2(hs.reduce((t, h) => t + (marketValue(h) ?? 0), 0)), costBasis: round2(hs.reduce((t, h) => t + costBasisValue(h), 0)), properties: props.length, realEstateValue: round2(props.reduce((t, p) => t + propertyMetrics(p).value, 0)), mortgage: round2(props.reduce((t, p) => t + (p.mortgageBalance ?? 0), 0)), latestSnapshotTotal: latest ? round2(Number(latest.totalMarketValue)) : null };
}

async function aadosTotals(pg: Pg, ids: { holdings: string[]; properties: string[]; latestDate: string | null }): Promise<Totals> {
  const h = (await pg.query('SELECT quantity, cost_basis, current_price FROM fin_holdings WHERE id = ANY($1::text[])', [ids.holdings])).rows.map((r) => ({ quantity: Number(r.quantity), costBasis: Number(r.cost_basis), currentPrice: r.current_price === null ? null : Number(r.current_price) }));
  const p = (await pg.query('SELECT market_value, zestimate, mortgage_balance FROM fin_properties WHERE id = ANY($1::text[])', [ids.properties])).rows.map((r) => ({ marketValue: r.market_value === null ? null : Number(r.market_value), zestimate: r.zestimate === null ? null : Number(r.zestimate), mortgageBalance: r.mortgage_balance === null ? null : Number(r.mortgage_balance) }) as Property);
  const snap = ids.latestDate ? (await pg.query('SELECT total_market_value FROM fin_portfolio_snapshots WHERE date = $1', [ids.latestDate])).rows[0] : null;
  return { holdings: h.length, marketValue: round2(h.reduce((t, x) => t + (marketValue(x) ?? 0), 0)), costBasis: round2(h.reduce((t, x) => t + costBasisValue(x), 0)), properties: p.length, realEstateValue: round2(p.reduce((t, x) => t + propertyMetrics(x).value, 0)), mortgage: round2(p.reduce((t, x) => t + (x.mortgageBalance ?? 0), 0)), latestSnapshotTotal: snap ? round2(Number(snap.total_market_value)) : null };
}

/** Dry run (default) or apply. For apply, pass a pg client already inside BEGIN — the caller commits or rolls back. */
export async function migrateAjadvisor(db: Sqlite, pg: Pg, mode: 'dry-run' | 'apply'): Promise<Report> {
  const { all, settings, watchlist } = read(db);
  const invalid = validate(all);
  const bad = new Set(invalid.map((i) => `${i.table}:${i.id}`));
  const valid = (t: string, id: string) => !bad.has(`${t}:${id}`);
  const source: Record<string, number> = {}, existing: Record<string, number> = {}, inserted: Record<string, number> = {};
  for (const t of TABLES) source[t] = all[t].length;
  source.Watchlist = watchlist.length;
  // Already present in AadOS (by id, or by name for lookups) — these are skipped, never overwritten.
  for (const t of TABLES) {
    if (t === 'HoldingCategory') continue;
    const ids = all[t].map((r) => r.id).filter(Boolean);
    existing[t] = ids.length ? Number((await pg.query(`SELECT count(*) c FROM ${DEST[t]} WHERE id = ANY($1::text[])`, [ids])).rows[0].c) : 0;
  }
  const report: Report = { mode, at: new Date().toISOString(), source, existing, inserted, invalid, notMigrated: ['User / AuthAccount / Session (AadOS has its own login)', 'PlaidItem access tokens and E*TRADE tokens (reconnect in Finance → Settings)', 'Earnings cache and last-refresh status (rebuilt on the first refresh)'], totals: { ajadvisor: ajTotals(all, valid), aados: null, matches: null, differences: [] } };
  if (mode === 'dry-run') return report;

  const ins = async (table: string, key: string, sql: string, params: unknown[]) => { const r = await pg.query(sql, params); inserted[key] = (inserted[key] || 0) + (r.rowCount || 0); };
  for (const [t, dest] of [['AccountType', 'fin_account_types'], ['AccountOwner', 'fin_owners'], ['Brokerage', 'fin_brokerages'], ['Category', 'fin_categories']] as const)
    for (const r of all[t]) await ins(dest, t, `INSERT INTO ${dest} (id, name, inserted_at, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [r.id, r.name, ts(r.createdAt), ts(r.updatedAt)]);
  for (const a of all.Account.filter((x) => valid('Account', x.id)))
    await ins('fin_accounts', 'Account', `INSERT INTO fin_accounts (id, name, type, owner, brokerage, source, etrade_account_id_key, plaid_account_id, plaid_item_id, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [a.id, a.name, a.type || 'Regular Brokerage', a.owner, a.brokerage, a.etradeAccountIdKey ? 'etrade' : a.plaidAccountId ? 'plaid' : 'ajadvisor', a.etradeAccountIdKey, a.plaidAccountId, a.plaidItemId, ts(a.createdAt), ts(a.updatedAt)]);
  for (const h of all.Holding.filter((x) => valid('Holding', x.id)))
    await ins('fin_holdings', 'Holding', `INSERT INTO fin_holdings (id, account_id, ticker, name, quantity, cost_basis, current_price, previous_close, price_source, price_at, source, notes, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ajadvisor',$11,$12,$13) ON CONFLICT DO NOTHING`,
      [h.id, h.accountId, String(h.ticker).toUpperCase(), h.name || h.ticker, Number(h.quantity), Number(h.costBasis || 0), num(h.currentPrice), num(h.previousClose), num(h.currentPrice) != null ? 'ajadvisor' : null, num(h.currentPrice) != null ? ts(h.updatedAt) : null, h.notes, ts(h.createdAt), ts(h.updatedAt)]);
  // Category links: AJAdvisor category id → the AadOS category with that name (an existing one keeps its own id).
  const catName = new Map(all.Category.map((c) => [c.id, c.name]));
  for (const hc of all.HoldingCategory.filter((x) => valid('HoldingCategory', `${x.holdingId}/${x.categoryId}`)))
    await ins('fin_holding_categories', 'HoldingCategory', `INSERT INTO fin_holding_categories (holding_id, category_id) SELECT $1, id FROM fin_categories WHERE name = $2 AND EXISTS (SELECT 1 FROM fin_holdings WHERE id = $1) ON CONFLICT DO NOTHING`, [hc.holdingId, catName.get(hc.categoryId)]);
  for (const s of all.HoldingSnapshot)
    await ins('fin_holding_snapshots', 'HoldingSnapshot', `INSERT INTO fin_holding_snapshots (id, date, holding_id, account_id, ticker, name, quantity, price, market_value, cost_basis, day_change, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [s.id, day(s.date), s.holdingId, s.accountId, s.ticker, s.name, Number(s.quantity), num(s.price), num(s.marketValue), Number(s.costBasis), num(s.dayChange), ts(s.createdAt), ts(s.updatedAt)]);
  for (const s of all.AccountSnapshot)
    await ins('fin_account_snapshots', 'AccountSnapshot', `INSERT INTO fin_account_snapshots (id, date, account_id, name, type, market_value, cost_basis, cash, day_change, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [s.id, day(s.date), s.accountId, s.name, s.type, Number(s.marketValue), Number(s.costBasis), Number(s.cash), Number(s.dayChange), ts(s.createdAt), ts(s.updatedAt)]);
  for (const s of all.PortfolioSnapshot) {
    let bench = {}; try { bench = JSON.parse(s.benchmarks || '{}'); } catch { /* keep {} */ }
    await ins('fin_portfolio_snapshots', 'PortfolioSnapshot', `INSERT INTO fin_portfolio_snapshots (id, date, total_market_value, total_cost_basis, total_cash, day_change, stocks_value, funds_value, cash_value, real_estate_value, benchmarks, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [s.id, day(s.date), Number(s.totalMarketValue), Number(s.totalCostBasis), Number(s.totalCash), Number(s.dayChange), Number(s.stocksValue), Number(s.fundsValue), Number(s.cashValue), Number(s.realEstateValue), JSON.stringify(bench), ts(s.createdAt), ts(s.updatedAt)]);
  }
  for (const p of all.InvestmentPlan)
    await ins('fin_plans', 'InvestmentPlan', `INSERT INTO fin_plans (id, ticker, name, purpose, strategy, target_allocation_percent, max_allocation_percent, buy_range_low, buy_range_high, trim_range_low, trim_range_high, thesis, exit_conditions, next_review_date, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING`,
      [p.id, String(p.ticker).toUpperCase(), p.name, p.purpose, p.strategy, num(p.targetAllocationPercent), num(p.maxAllocationPercent), num(p.buyRangeLow), num(p.buyRangeHigh), num(p.trimRangeLow), num(p.trimRangeHigh), p.thesis, p.exitConditions, day(p.nextReviewDate), ts(p.createdAt), ts(p.updatedAt)]);
  for (const d of all.Decision.filter((x) => valid('Decision', x.id))) {
    const status = ['open', 'completed', 'dismissed', 'scheduled'].includes(String(d.status)) ? d.status : 'open';
    await ins('fin_decisions', 'Decision', `INSERT INTO fin_decisions (id, ticker, name, type, notes, status, scheduled_for, decided_at, resolved_at, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [d.id, String(d.ticker).toUpperCase(), d.name, String(d.type).toLowerCase(), d.notes, status, toDate(d.scheduledFor)?.toISOString() ?? null, ts(d.decidedAt), toDate(d.resolvedAt)?.toISOString() ?? null, ts(d.createdAt), ts(d.updatedAt)]);
  }
  for (const m of all.MutedSignal)
    await ins('fin_muted_signals', 'MutedSignal', `INSERT INTO fin_muted_signals (id, signal_id, signal_title, signal_kind, ticker, muted_at, muted_until, unmuted_at, inserted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [m.id, m.signalId, m.signalTitle, m.signalKind, m.ticker, ts(m.mutedAt), toDate(m.mutedUntil)?.toISOString() ?? null, toDate(m.unmutedAt)?.toISOString() ?? null, ts(m.createdAt)]);
  for (const p of all.RealEstateProperty.filter((x) => valid('RealEstateProperty', x.id))) {
    await ins('fin_properties', 'RealEstateProperty', `INSERT INTO fin_properties (id, location, units, cost, owner, year_acquired, market_value, mortgage_balance, mortgage, mortgage_payment, current_rent, normalized_rent, interest_overall, interest_property, insurance, hoa, real_estate_tax, income, zestimate, zestimate_updated_at, notes, source, inserted_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'ajadvisor',$22,$23) ON CONFLICT DO NOTHING`,
      [p.id, p.location, Number(p.units || 1), num(p.cost), p.owner, p.yearAcquired, num(p.marketValue), num(p.mortgageBalance), p.mortgage, num(p.mortgagePayment), num(p.currentRent), num(p.normalizedRent), num(p.interestOverall), num(p.interestProperty), num(p.insurance), num(p.hoa), num(p.realEstateTax), num(p.income), num(p.zestimate), toDate(p.zestimateUpdatedAt)?.toISOString() ?? null, p.notes, ts(p.createdAt), ts(p.updatedAt)]);
    // Starting point of the valuation history: the value as of AJAdvisor's last update.
    if (num(p.marketValue) != null || num(p.mortgageBalance) != null) await pg.query(`INSERT INTO fin_property_valuations (property_id, date, market_value, mortgage_balance, source, inserted_at) SELECT $1, $2, $3, $4, 'ajadvisor', now() WHERE EXISTS (SELECT 1 FROM fin_properties WHERE id = $1) ON CONFLICT DO NOTHING`, [p.id, day(p.updatedAt), num(p.marketValue), num(p.mortgageBalance)]);
  }
  for (const w of watchlist) if (w?.ticker)
    await ins('fin_watchlist', 'Watchlist', `INSERT INTO fin_watchlist (id, ticker, name, target_price, dip_percent, thesis, inserted_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now(), now()) ON CONFLICT DO NOTHING`, [`aj-${String(w.ticker).toUpperCase()}`, String(w.ticker).toUpperCase(), w.name || '', num(w.targetPrice), num(w.dipPercent) ?? 5, w.thesis || '']);
  // Alert thresholds (only if AadOS has none yet).
  const mv = num(settings['notification.movementThresholdPercent']), cb = num(settings['notification.costBasisDiscountPercent']);
  if (mv != null || cb != null) await pg.query(`INSERT INTO fin_settings (key, value, updated_at) VALUES ('alerts', $1, now()) ON CONFLICT DO NOTHING`, [JSON.stringify({ ...(mv != null ? { movementThresholdPercent: mv } : {}), ...(cb != null ? { costBasisDiscountPercent: cb } : {}) })]);

  // Verification: the same totals computed from what is now in AadOS for the migrated ids.
  const latest = [...all.PortfolioSnapshot].sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))[0];
  const aados = await aadosTotals(pg, { holdings: all.Holding.filter((h) => valid('Holding', h.id)).map((h) => h.id), properties: all.RealEstateProperty.filter((p) => valid('RealEstateProperty', p.id)).map((p) => p.id), latestDate: latest ? day(latest.date) : null });
  const aj = report.totals.ajadvisor, diffs: string[] = [];
  for (const k of Object.keys(aj) as (keyof Totals)[]) if (aj[k] !== aados[k] && !(aj[k] != null && aados[k] != null && Math.abs(Number(aj[k]) - Number(aados[k])) < 0.01)) diffs.push(`${k}: AJAdvisor ${aj[k]} vs AadOS ${aados[k]}${existing.Holding || existing.RealEstateProperty ? ' (records that already existed in AadOS were kept as they are)' : ''}`);
  report.totals = { ajadvisor: aj, aados, matches: diffs.length === 0, differences: diffs };
  await pg.query('INSERT INTO fin_import_runs (source, mode, summary, inserted_at) VALUES ($1, $2, $3, now())', ['ajadvisor', mode, JSON.stringify(report)]);
  return report;
}
