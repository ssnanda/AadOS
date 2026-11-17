import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoCategories, bucketOf, buildSignals, costBasisValue, holdingsCsv, isMuted, mutedUntil, parseHoldingsCsv, periodChange, positions, propertyMetrics, rangeStart, summarize, tradingDay, unitCost, type Account, type Holding, type Property } from '../src/lib/finance/model.ts';
import { toDate } from '../src/lib/finance/ajadvisor-import.ts';

const acct = (id: string, extra: Partial<Account> = {}): Account => ({ id, name: id, type: 'Regular Brokerage', owner: 'Sandip', brokerage: null, source: 'manual', etradeAccountIdKey: null, plaidAccountId: null, plaidItemId: null, notes: null, lastSyncedAt: null, ...extra });
const hold = (x: Partial<Holding> & { ticker: string }): Holding => ({ id: x.ticker, accountId: 'a', name: x.ticker, quantity: 10, costBasis: 100, currentPrice: 110, previousClose: 100, priceSource: 'yahoo', priceAt: new Date().toISOString(), source: 'manual', notes: null, categories: [], ...x });
const prop = (x: Partial<Property>): Property => ({ id: 'p', location: 'x', name: null, units: 1, cost: null, owner: null, yearAcquired: null, marketValue: null, mortgageBalance: null, mortgage: null, mortgagePayment: null, currentRent: null, normalizedRent: null, interestOverall: null, interestProperty: null, insurance: null, hoa: null, realEstateTax: null, otherExpenses: null, income: null, zestimate: null, zestimateUpdatedAt: null, notes: null, ...x });

test('cost basis: per-share normally, position total when the import stored a total (AJAdvisor rule)', () => {
  assert.equal(costBasisValue({ quantity: 10, costBasis: 100, currentPrice: 110 }), 1000);
  assert.equal(costBasisValue({ quantity: 100, costBasis: 5000, currentPrice: 60 }), 5000); // 100 × 5000 would be absurd
  assert.equal(unitCost({ quantity: 100, costBasis: 5000, currentPrice: 60 }), 50);
});

test('buckets and auto categories', () => {
  assert.equal(bucketOf({ ticker: 'CASH', name: 'Cash', categories: [] }), 'cash');
  assert.equal(bucketOf({ ticker: 'FAGIX', name: 'x', categories: ['Mutual Funds'] }), 'funds');
  assert.deepEqual(autoCategories({ ticker: 'TSLA', name: 'Tesla' }), ['EVs']);
  assert.ok(autoCategories({ ticker: 'META', name: 'Meta' }).includes('Technology'));
});

test('summary: net worth = investments + cash + real-estate equity; missing prices reported, not guessed', () => {
  const s = summarize([hold({ ticker: 'AAA' }), hold({ ticker: 'CASH', quantity: 500, costBasis: 1, currentPrice: 1, previousClose: 1 }), hold({ ticker: 'NOPX', currentPrice: null, previousClose: null })], [acct('a')], [prop({ marketValue: 300_000, mortgageBalance: 100_000 })]);
  assert.equal(s.investments, 1100); assert.equal(s.cash, 500); assert.equal(s.realEstateEquity, 200_000); assert.equal(s.netWorth, 1100 + 500 + 200_000);
  assert.equal(s.dayChange, 100); assert.deepEqual(s.missingPrices.map((m) => m.ticker), ['NOPX']);
});

test('property metrics: Zestimate fallback, cash flow from stored income else rent − costs', () => {
  assert.equal(propertyMetrics(prop({ zestimate: 250_000 })).valueSource, 'Zestimate');
  assert.equal(propertyMetrics(prop({ income: 1625.75 })).cashFlow, 1625.75);
  assert.equal(propertyMetrics(prop({ currentRent: 2000, insurance: 50, hoa: 20, realEstateTax: 180, mortgagePayment: 1000 })).cashFlow, 750);
});

test('positions merge a ticker across accounts; signals fire with AJAdvisor thresholds', () => {
  const hs = [hold({ id: '1', ticker: 'BIG', accountId: 'a', quantity: 100, costBasis: 10, currentPrice: 20, previousClose: 19 }), hold({ id: '2', ticker: 'BIG', accountId: 'b', quantity: 100, costBasis: 10, currentPrice: 20, previousClose: 19 }), hold({ id: '3', ticker: 'DIP', accountId: 'a', quantity: 10, costBasis: 100, currentPrice: 70, previousClose: 70 })];
  const p = positions(hs, [acct('a'), acct('b')]);
  assert.equal(p.find((x) => x.ticker === 'BIG')!.quantity, 200);
  const sig = buildSignals({ positions: p, watchlist: [{ id: 'w', ticker: 'WAT', name: '', targetPrice: 50, dipPercent: 5, thesis: 'cheap', currentPrice: 49, previousClose: 50, priceAt: null }], accounts: [], totalMarketValue: 4700, totalCash: 0, discountThreshold: 20, earnings: {}, missingPrices: [], sessionLabel: 'today', plans: [] });
  const ids = sig.map((x) => x.id);
  assert.ok(ids.includes('move-BIG')); assert.ok(ids.includes('trim-BIG')); assert.ok(ids.includes('risk-BIG')); assert.ok(ids.includes('buy-basis-DIP')); assert.ok(ids.includes('buy-target-WAT'));
});

test('history ranges, period change, trading day, muting', () => {
  assert.equal(rangeStart('1M', '2026-01-01', '2026-11-17'), '2026-10-18');
  assert.equal(rangeStart('ALL', '2026-08-01', '2026-11-17'), '2026-08-01');
  assert.deepEqual(periodChange([{ date: '2026-11-01', value: 100 }, { date: '2026-11-17', value: 110 }], '2026-11-01').percent, 10);
  assert.equal(tradingDay(new Date('2026-11-22T15:00:00Z')), '2026-11-20'); // Sunday → Friday
  assert.equal(isMuted({ mutedUntil: mutedUntil('1d'), unmutedAt: null }), true);
  assert.equal(isMuted({ mutedUntil: null, unmutedAt: new Date().toISOString() }), false);
});

test('CSV round trip in the AJAdvisor column format', () => {
  const csv = holdingsCsv([hold({ ticker: 'AAA', name: 'Alpha, Inc', categories: ['Technology'] })], [acct('a', { name: 'Brokerage 1' })]);
  const { rows, errors } = parseHoldingsCsv(csv);
  assert.deepEqual(errors, []); assert.equal(rows[0].name, 'Alpha, Inc'); assert.equal(rows[0].account, 'Brokerage 1'); assert.equal(rows[0].unitCost, 100); assert.deepEqual(rows[0].categories, ['Technology']);
  assert.ok(parseHoldingsCsv('Ticker\nX').errors.length);
});

test('AJAdvisor timestamps (epoch ms or ISO) are preserved', () => {
  assert.equal(toDate(1783438673486)!.toISOString(), new Date(1783438673486).toISOString());
  assert.equal(toDate('2026-07-01T00:00:00.000Z')!.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(toDate(null), null);
});
