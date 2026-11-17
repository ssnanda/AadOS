// Finance facts for the AI assistant. Only used when the owner ticked "Finance" in Settings → AI (explicit consent).
// Every number is calculated from AadOS records here (not by the model) and labelled as such, so answers can separate
// facts from the model's analysis. Read-only: nothing here can trade or change accounts.
import type { Source } from '../ai/context';
import { hasDatabase } from '../aados-store';
import { db, loadAll, portfolioSeries } from './db';
import { currentSignals } from './refresh';
import { periodChange, positions, rangeStart } from '$lib/finance/model';

const FINANCE = /\b(net ?worth|portfolio|invest|stocks?|shares?|holdings?|positions?|ticker|etf|funds?|dividend|earnings|market|allocation|cash|brokerage|retirement|ira|401k|real ?estate|propert(y|ies)|rent(al)?|mortgage|equity|watchlist|target price|decisions?|plans?|gain|loss|perform|technology|tech)\b/i;
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export async function financeSources(question: string): Promise<Source[]> {
  if (!hasDatabase() || !FINANCE.test(question)) return [];
  try {
    const q = await db(), data = await loadAll(q);
    if (!data.accounts.length && !data.properties.length) return [];
    const [{ summary: s, signals }, series] = await Promise.all([currentSignals(q, data), portfolioSeries(q)]);
    const pos = positions(data.holdings, data.accounts);
    const gainPct = (p: (typeof pos)[number]) => (p.costBasis > 0 ? ((p.marketValue - p.costBasis) / p.costBasis) * 100 : 0);
    const ranked = pos.filter((p) => p.costBasis > 0 && p.marketValue > 0).sort((a, b) => gainPct(b) - gainPct(a));
    const totals = series.map((p) => ({ date: p.date, value: p.total }));
    const month = totals.length ? periodChange(totals, rangeStart('1M', totals[0].date)) : null;
    const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${usd(v)} (${s.investments ? ((v / s.investments) * 100).toFixed(1) : 0}%)`);
    const now = new Date().toISOString().slice(0, 10), src = (id: string, title: string, excerpt: string): Source => ({ id, kind: 'finance', ref: id, title, date: now, href: '/finance', excerpt: `[AadOS finance records — calculated, not estimated]\n${excerpt}`, meta: 'Finance' });
    const out: Source[] = [
      src('fin-summary', 'Net worth & totals', `Net worth ${usd(s.netWorth)} = investments ${usd(s.investments)} + cash ${usd(s.cash)} + real-estate equity ${usd(s.realEstateEquity)}. Invested cost ${usd(s.costBasis)}; unrealized gain ${usd(s.gain)}. Today's change ${usd(s.dayChange)}.${month && month.percent != null ? ` Past month: ${usd(month.change)} (${month.percent.toFixed(2)}%).` : ''}${s.missingPrices.length ? ` ${s.missingPrices.length} holdings have no price and are excluded.` : ''}`),
      src('fin-allocation', 'Allocation', `By category: ${cats.join('; ')}. By asset class: stocks ${usd(s.buckets.stocks)}, funds ${usd(s.buckets.funds)}, cash ${usd(s.buckets.cash)}. By owner: ${Object.entries(s.byOwner).map(([k, v]) => `${k} ${usd(v)}`).join('; ')}.`),
      src('fin-performers', 'Best & worst holdings', `Best (gain on cost): ${ranked.slice(0, 5).map((p) => `${p.ticker} ${gainPct(p).toFixed(1)}% (${usd(p.marketValue)})`).join(', ')}. Worst: ${ranked.slice(-5).reverse().map((p) => `${p.ticker} ${gainPct(p).toFixed(1)}% (${usd(p.marketValue)})`).join(', ')}. Largest: ${pos.slice(0, 5).map((p) => `${p.ticker} ${usd(p.marketValue)}`).join(', ')}.`),
      src('fin-realestate', 'Real estate', `${data.properties.length} properties, value ${usd(s.realEstateValue)}, mortgage ${usd(s.realEstateMortgage)}, equity ${usd(s.realEstateEquity)}, monthly rental cash flow ${usd(s.monthlyRentalCashFlow)}.`),
      src('fin-decisions', 'Plans, decisions & watchlist', `Open/scheduled decisions: ${data.decisions.filter((d) => d.status === 'open' || d.status === 'scheduled').map((d) => `${d.type.toUpperCase()} ${d.ticker}${d.notes ? ` (${d.notes.slice(0, 80)})` : ''}`).join('; ') || 'none'}. Watchlist at/below target: ${data.watchlist.filter((w) => w.targetPrice != null && w.currentPrice != null && w.currentPrice <= w.targetPrice).map((w) => `${w.ticker} at ${w.currentPrice} (target ${w.targetPrice})`).join(', ') || 'none'}. Top insights: ${signals.slice(0, 5).map((x) => x.title).join('; ') || 'none'}.`)
    ];
    return out;
  } catch { return []; }
}
