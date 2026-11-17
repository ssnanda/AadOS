import { json } from '@sveltejs/kit';
import { readState, updateState } from '$lib/server/aados-store';
import * as F from '$lib/server/finance/db';
import { refreshPrices, connectionAlert } from '$lib/server/finance/refresh';
import { fetchHistory } from '$lib/server/finance/quotes';
import * as etrade from '$lib/server/finance/etrade';
import * as plaid from '$lib/server/finance/plaid';
import { autoCategories, mutedUntil, parseHoldingsCsv, DECISION_TYPES, type MuteDuration } from '$lib/finance/model';

// Every Finance action. Read-only toward brokerages (no orders). Provider setup is owner-only; secrets never leave the server.
const s = (v: unknown, max = 2000) => String(v ?? '').trim().slice(0, max);
const n = (v: unknown) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const OWNER_ONLY = /^(etrade|plaid)\./;

export const POST = async ({ request, locals }) => {
  const b = await request.json().catch(() => ({}));
  const op = s(b.op, 40);
  if (OWNER_ONLY.test(op) && !locals.user?.owner) return json({ error: 'Only the owner can manage financial connections.' }, { status: 403 });
  try {
    const q = await F.db();
    switch (op) {
      case 'refresh': return json(await refreshPrices(q));
      // ---- accounts / holdings / lookups ----
      case 'account.save': { if (!s(b.name)) throw new Error('Name the account.'); return json({ id: await F.saveAccount(q, { id: s(b.id, 60) || undefined, name: s(b.name, 200), type: s(b.type, 80) || 'Regular Brokerage', owner: s(b.owner, 80) || null, brokerage: s(b.brokerage, 80) || null, notes: s(b.notes) || null }) }); }
      case 'account.delete': await F.deleteAccount(q, s(b.id, 60)); return json({ ok: true });
      case 'holding.save': {
        const ticker = s(b.ticker, 30).toUpperCase(), quantity = n(b.quantity);
        if (!ticker || quantity === null || !s(b.accountId, 60)) throw new Error('Account, ticker and quantity are required.');
        const cats = Array.isArray(b.categories) ? b.categories.map((c: unknown) => s(c, 80)) : undefined;
        return json({ id: await F.saveHolding(q, { id: s(b.id, 60) || undefined, accountId: s(b.accountId, 60), ticker, name: s(b.name, 200) || ticker, quantity, costBasis: n(b.costBasis) ?? 0, currentPrice: n(b.currentPrice), priceSource: n(b.currentPrice) != null ? 'manual' : undefined, notes: s(b.notes) || null }, cats ?? (s(b.id) ? undefined : autoCategories({ ticker, name: s(b.name) }))) });
      }
      case 'holding.delete': await F.deleteHolding(q, s(b.id, 60)); return json({ ok: true });
      case 'lookup.add': await F.ensureLookup(q, b.kind, s(b.name, 80)); return json({ ok: true });
      case 'lookup.rename': await F.renameLookup(q, b.kind, s(b.from, 80), s(b.to, 80)); return json({ ok: true });
      case 'lookup.delete': await F.deleteLookup(q, b.kind, s(b.name, 80)); return json({ ok: true });
      case 'csv.import': {
        // Same columns as the export (and AJAdvisor's). Accounts are matched by name (created if new); holdings by account+ticker.
        const { rows, errors } = parseHoldingsCsv(String(b.text || '').slice(0, 2_000_000));
        if (b.dryRun) return json({ rows: rows.length, errors });
        const accts = new Map((await q.query('SELECT id, name FROM fin_accounts')).rows.map((r) => [String(r.name).toLowerCase(), r.id as string]));
        let added = 0, updated = 0;
        for (const r of rows) {
          let accountId = accts.get(r.account.toLowerCase());
          if (!accountId) { accountId = await F.saveAccount(q, { name: r.account, type: r.accountType, owner: r.owner || null, brokerage: r.brokerage || null }); accts.set(r.account.toLowerCase(), accountId); }
          const hit = (await q.query('SELECT id FROM fin_holdings WHERE account_id = $1 AND upper(ticker) = $2 LIMIT 1', [accountId, r.ticker])).rows[0];
          await F.saveHolding(q, { id: hit?.id, accountId, ticker: r.ticker, name: r.name, quantity: r.quantity, costBasis: r.unitCost, currentPrice: r.currentPrice, notes: r.notes || null }, r.categories.length ? r.categories : autoCategories(r));
          if (hit) updated++; else added++;
        }
        return json({ added, updated, errors });
      }
      // ---- watchlist / plans / decisions / insights ----
      case 'watch.save': if (!s(b.ticker)) throw new Error('Ticker required.'); await F.saveWatch(q, { ticker: s(b.ticker, 30), name: s(b.name, 200), targetPrice: n(b.targetPrice), dipPercent: n(b.dipPercent) ?? 5, thesis: s(b.thesis, 5000) }); return json({ ok: true });
      case 'watch.delete': await F.deleteWatch(q, s(b.ticker, 30)); return json({ ok: true });
      case 'plan.save': if (!s(b.ticker)) throw new Error('Ticker required.'); await F.savePlan(q, { ticker: s(b.ticker, 30), name: s(b.name, 200) || null, purpose: s(b.purpose, 5000) || null, strategy: s(b.strategy, 5000) || null, targetAllocationPercent: n(b.targetAllocationPercent), maxAllocationPercent: n(b.maxAllocationPercent), buyRangeLow: n(b.buyRangeLow), buyRangeHigh: n(b.buyRangeHigh), trimRangeLow: n(b.trimRangeLow), trimRangeHigh: n(b.trimRangeHigh), thesis: s(b.thesis, 10_000) || null, exitConditions: s(b.exitConditions, 5000) || null, notes: s(b.notes, 10_000) || null, nextReviewDate: /^\d{4}-\d{2}-\d{2}$/.test(s(b.nextReviewDate)) ? s(b.nextReviewDate) : null }); return json({ ok: true });
      case 'plan.delete': await F.deletePlan(q, s(b.ticker, 30)); return json({ ok: true });
      case 'decision.save': {
        const type = s(b.type, 20).toLowerCase() as (typeof DECISION_TYPES)[number];
        if (!DECISION_TYPES.includes(type) || !s(b.ticker)) throw new Error('Ticker and a decision type are required.');
        return json({ id: await F.saveDecision(q, { id: s(b.id, 60) || undefined, ticker: s(b.ticker, 30), name: s(b.name, 200) || null, type, notes: s(b.notes, 10_000) || null, status: ['open', 'scheduled', 'completed', 'dismissed'].includes(s(b.status)) ? (s(b.status) as any) : undefined, scheduledFor: s(b.scheduledFor) ? new Date(s(b.scheduledFor)).toISOString() : null }) });
      }
      case 'decision.delete': await F.deleteDecision(q, s(b.id, 60)); return json({ ok: true });
      case 'signal.mute': await F.muteSignal(q, { signalId: s(b.signalId, 120), title: s(b.title, 250), kind: s(b.kind, 20), ticker: s(b.ticker, 30) || undefined, until: mutedUntil((s(b.duration, 10) || '1w') as MuteDuration) }); return json({ ok: true });
      case 'signal.unmute': await F.unmuteSignal(q, s(b.id, 60)); return json({ ok: true });
      // ---- real estate ----
      case 'property.save': {
        if (!s(b.location)) throw new Error('Address required.');
        const f = (k: string) => n(b[k]);
        return json({ id: await F.saveProperty(q, { id: s(b.id, 60) || undefined, location: s(b.location, 300), name: s(b.name, 200) || null, units: n(b.units) ?? 1, cost: f('cost'), owner: s(b.owner, 80) || null, yearAcquired: n(b.yearAcquired), marketValue: f('marketValue'), mortgageBalance: f('mortgageBalance'), mortgage: s(b.mortgage, 120) || null, mortgagePayment: f('mortgagePayment'), currentRent: f('currentRent'), normalizedRent: f('normalizedRent'), interestOverall: f('interestOverall'), interestProperty: f('interestProperty'), insurance: f('insurance'), hoa: f('hoa'), realEstateTax: f('realEstateTax'), otherExpenses: f('otherExpenses'), income: f('income'), zestimate: f('zestimate'), notes: s(b.notes, 5000) || null }) });
      }
      case 'property.delete': await F.deleteProperty(q, s(b.id, 60)); return json({ ok: true });
      case 'property.history': return json({ history: await F.propertyHistory(q, s(b.id, 60)) });
      // ---- history & charts ----
      case 'history.account': return json({ series: await F.accountSeries(q, s(b.id, 60)) });
      case 'history.holding': return json({ series: await F.holdingSeries(q, s(b.ticker, 30)), prices: await fetchHistory(s(b.ticker, 30), s(b.range, 5) || '1y') });
      case 'alerts.save': { const cur = await F.alertSettings(q); await F.setSetting(q, 'alerts', { ...cur, enabled: b.enabled !== false, movementThresholdPercent: n(b.movementThresholdPercent) ?? cur.movementThresholdPercent, costBasisDiscountPercent: n(b.costBasisDiscountPercent) ?? cur.costBasisDiscountPercent, allocationAlerts: b.allocationAlerts !== false, earningsAlerts: b.earningsAlerts !== false, reviewAlerts: b.reviewAlerts !== false, staleDataAlerts: b.staleDataAlerts !== false, connectionAlerts: b.connectionAlerts !== false }); return json({ ok: true }); }
      // ---- E*TRADE ----
      case 'etrade.config': await updateState((st) => { const e = st.integrations.etrade; e.sandbox = b.sandbox === true; if (s(b.consumerKey)) e.consumerKey = s(b.consumerKey, 200); if (s(b.consumerSecret)) e.consumerSecret = s(b.consumerSecret, 200); }); return json({ ok: true });
      case 'etrade.start': return json({ url: await etrade.startConnect() });
      case 'etrade.complete': await etrade.completeConnect(s(b.verifier, 50)); return json({ ok: true });
      case 'etrade.accounts': return json({ accounts: await etrade.listAccounts() });
      case 'etrade.import': { const a = (await etrade.listAccounts()).find((x) => x.accountIdKey === s(b.accountIdKey, 100)); if (!a) throw new Error('E*TRADE account not found.'); return json(await etrade.syncAccount(q, a)); }
      case 'etrade.sync': try { return json(await etrade.syncAll(q)); } catch (e) { const m = e instanceof Error ? e.message : 'sync failed'; await updateState((st) => { st.integrations.etrade.lastError = m; }); await connectionAlert(q, 'E*TRADE', m); throw e; }
      case 'etrade.unlink': await q.query("UPDATE fin_accounts SET etrade_account_id_key = NULL, source = 'manual', updated_at = now() WHERE id = $1", [s(b.id, 60)]); return json({ ok: true });
      case 'etrade.disconnect': await etrade.disconnect(); return json({ ok: true });
      // ---- Plaid ----
      case 'plaid.config': await updateState((st) => { const p = st.integrations.plaid; p.env = b.env === 'production' ? 'production' : 'sandbox'; if (s(b.clientId)) p.clientId = s(b.clientId, 200); if (s(b.secret)) p.secret = s(b.secret, 200); p.redirectUri = s(b.redirectUri, 300); }); return json({ ok: true });
      case 'plaid.linkToken': return json({ linkToken: await plaid.linkToken(s(b.itemId, 40) || undefined) });
      case 'plaid.exchange': return json({ itemId: await plaid.exchange(s(b.publicToken, 300), s(b.institutionId, 80), s(b.institutionName, 120)) });
      case 'plaid.accounts': { const item = (await readState()).integrations.plaid.items.find((i) => i.id === s(b.itemId, 40)); if (!item) throw new Error('Connection not found.'); const linked = new Map((await q.query('SELECT id, plaid_account_id FROM fin_accounts WHERE plaid_item_id = $1', [item.itemId])).rows.map((r) => [r.plaid_account_id, r.id])); return json({ accounts: (await plaid.accounts(item)).map((a) => ({ ...a, display: plaid.displayName(a), linkedTo: linked.get(a.accountId) || '' })) }); }
      case 'plaid.link': { const st = await readState(); const item = st.integrations.plaid.items.find((i) => i.id === s(b.itemId, 40)); if (!item) throw new Error('Connection not found.'); const a = (await plaid.accounts(item)).find((x) => x.accountId === s(b.plaidAccountId, 100)); if (!a) throw new Error('Plaid account not found.'); return json({ id: await plaid.linkAccount(q, item, a, s(b.existingId, 60)) }); }
      case 'plaid.sync': try { return json({ summary: await plaid.syncItem(q, s(b.itemId, 40)) }); } catch (e) { await connectionAlert(q, 'Plaid', e instanceof Error ? e.message : 'sync failed'); throw e; }
      case 'plaid.remove': await plaid.removeItem(q, s(b.itemId, 40)); return json({ ok: true });
    }
    return json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Finance request failed.' }, { status: 400 });
  }
};
