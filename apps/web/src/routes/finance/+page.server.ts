import type { PageServerLoad } from './$types';
import { hasDatabase, readState } from '$lib/server/aados-store';
import { alertSettings, db, getSetting, loadAll, portfolioSeries, recentAlerts } from '$lib/server/finance/db';
import { currentSignals, type RefreshResult } from '$lib/server/finance/refresh';
import { etradeConfig } from '$lib/server/finance/etrade';
import { plaidConfig } from '$lib/server/finance/plaid';
import { positions, propertyMetrics } from '$lib/finance/model';

// Finance & Investments: everything for the tabs in one load (records are small: accounts, holdings, properties, history).
export const load: PageServerLoad = async ({ locals }) => {
  if (!hasDatabase()) return { available: false as const };
  try {
    const q = await db();
    const data = await loadAll(q);
    const [{ signals, mutedCount, summary, earnings }, series, lastRefresh, alerts, recent, imports] = await Promise.all([
      currentSignals(q, data), portfolioSeries(q), getSetting<RefreshResult | null>(q, 'lastRefresh', null), alertSettings(q), recentAlerts(q),
      q.query("SELECT mode, summary, inserted_at FROM fin_import_runs ORDER BY inserted_at DESC LIMIT 3").then((r) => r.rows.map((x) => ({ mode: x.mode, at: x.inserted_at, matches: x.summary?.totals?.matches ?? null })))
    ]);
    const st = await readState(), e = etradeConfig(st.integrations.etrade), p = plaidConfig(st.integrations.plaid);
    return {
      available: true as const, owner: Boolean(locals.user?.owner), ...data, summary, signals, mutedCount, earnings, series, lastRefresh, alerts, recentAlerts: recent, imports,
      positions: positions(data.holdings, data.accounts), propertyMetrics: Object.fromEntries(data.properties.map((x) => [x.id, propertyMetrics(x)])),
      etrade: { configured: Boolean(e.key && e.secret), fromEnv: e.fromEnv, sandbox: e.sandbox, connected: Boolean(st.integrations.etrade.accessToken), connectedAt: st.integrations.etrade.connectedAt, pending: Boolean(st.integrations.etrade.requestToken), lastError: st.integrations.etrade.lastError, lastSyncedAt: st.integrations.etrade.lastSyncedAt },
      plaid: { configured: Boolean(p.clientId && p.secret), fromEnv: p.fromEnv, env: p.env, redirectUri: p.redirectUri, items: st.integrations.plaid.items.map((i) => ({ id: i.id, institutionName: i.institutionName, status: i.status, lastError: i.lastError, lastSyncedAt: i.lastSyncedAt, lastSyncSummary: i.lastSyncSummary })) },
      aiShare: Boolean(st.ai.share.finance)
    };
  } catch (e) {
    return { available: false as const, error: e instanceof Error ? e.message : 'Finance is unavailable.' };
  }
};
