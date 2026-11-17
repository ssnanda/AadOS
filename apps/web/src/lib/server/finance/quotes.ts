// Market data from Yahoo Finance's public chart endpoints (delayed quotes; no key), ported from AJAdvisor quotes.ts
// and earnings.ts. Failures never break a page: callers keep the last stored price and flag it as stale.
export type Quote = { price: number; previousClose: number | null; time: string | null; source: 'yahoo' };
const UA = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Current price + the previous SESSION's close (not chartPreviousClose, which on a 5d range is a week old). */
export async function fetchQuotes(tickers: string[]): Promise<Map<string, Quote>> {
  const symbols = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter((t) => t && t !== 'CASH'))];
  const out = new Map<string, Quote>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, symbols.length) }, async () => {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      try {
        const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
        url.searchParams.set('range', '5d'); url.searchParams.set('interval', '1d');
        const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue;
        const r = (await res.json())?.chart?.result?.[0];
        const meta = r?.meta || {}, ts: unknown[] = r?.timestamp || [], closes: unknown[] = r?.indicators?.quote?.[0]?.close || [];
        const bars = ts.map((t, i) => ({ t: num(t), c: num(closes[i]) })).filter((b): b is { t: number; c: number } => b.t !== null && b.c !== null);
        const last = bars[bars.length - 1];
        const price = num(meta.regularMarketPrice) ?? last?.c ?? null;
        if (price === null) continue;
        const off = num(meta.gmtoffset) ?? 0, dayOf = (s: number) => Math.floor((s + off) / 86_400), mt = num(meta.regularMarketTime);
        let prev: number | null = null;
        if (last) { if (mt !== null && dayOf(mt) > dayOf(last.t)) prev = last.c; else if (bars.length >= 2) prev = bars[bars.length - 2].c; }
        prev ??= num(meta.previousClose);
        out.set(typeof meta.symbol === 'string' ? meta.symbol.toUpperCase() : symbol, { price, previousClose: prev, time: mt ? new Date(mt * 1000).toISOString() : new Date().toISOString(), source: 'yahoo' });
      } catch { /* one ticker failing never blocks the rest */ }
    }
  }));
  return out;
}

/** Daily closes for a chart (range: 1mo, 3mo, 6mo, 1y, 5y, max). */
export async function fetchHistory(ticker: string, range = '1y'): Promise<{ date: string; close: number }[]> {
  try {
    const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.toUpperCase())}`);
    url.searchParams.set('range', range); url.searchParams.set('interval', range === '5y' || range === 'max' ? '1wk' : '1d');
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const r = (await res.json())?.chart?.result?.[0];
    const ts: unknown[] = r?.timestamp || [], closes: unknown[] = r?.indicators?.quote?.[0]?.close || [];
    return ts.map((t, i) => ({ t: num(t), c: num(closes[i]) })).filter((b): b is { t: number; c: number } => b.t !== null && b.c !== null).map((b) => ({ date: new Date(b.t * 1000).toISOString().slice(0, 10), close: b.c }));
  } catch { return []; }
}

// Earnings: quoteSummary needs a cookie + crumb pair (cached 30 min), like AJAdvisor.
let crumb: { cookie: string; crumb: string; at: number } | null = null;
async function getCrumb() {
  if (crumb && Date.now() - crumb.at < 1_800_000) return crumb;
  try {
    const c = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    const cookie = c.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ');
    if (!cookie) return null;
    const r = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie }, signal: AbortSignal.timeout(8000) });
    const value = (await r.text()).trim();
    if (!r.ok || !value || value.includes('<')) return null;
    crumb = { cookie, crumb: value, at: Date.now() };
    return crumb;
  } catch { return null; }
}
/** Next earnings date (YYYY-MM-DD) per ticker; at most `max` lookups per call (the rest keep their cached value). */
export async function fetchEarnings(tickers: string[], max = 12): Promise<Record<string, string | null>> {
  const auth = await getCrumb();
  const out: Record<string, string | null> = {};
  if (!auth) return out;
  for (const t of tickers.slice(0, max)) {
    try {
      const url = new URL(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(t)}`);
      url.searchParams.set('modules', 'calendarEvents'); url.searchParams.set('crumb', auth.crumb);
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: auth.cookie }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const dates = (await res.json())?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate;
      out[t] = Array.isArray(dates) && typeof dates[0]?.fmt === 'string' ? dates[0].fmt : null;
    } catch { /* keep cached */ }
  }
  return out;
}
