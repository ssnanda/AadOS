// Plaid (investments, read-only), ported from AJAdvisor plaid.ts / plaidMapping.ts / plaidSync.ts. Items and their
// access tokens live in the encrypted credential vault (state.integrations.plaid); env PLAID_CLIENT_ID / PLAID_SECRET /
// PLAID_ENV override Settings. Duplicate protection: a Finance account already synced from E*TRADE takes its holdings
// from E*TRADE only, so the same positions are never counted twice.
import { randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { readState, updateState, type PlaidConfig, type PlaidItem } from '../aados-store';
import { autoCategories } from '$lib/finance/model';
import { ensureLookup, saveAccount, saveHolding, type Q } from './db';

export class PlaidError extends Error { constructor(message: string, public code = '') { super(message); } get needsReauth() { return ['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'INVALID_ACCESS_TOKEN'].includes(this.code); } }
export function plaidConfig(c: PlaidConfig) {
  const envName = (env.PLAID_ENV || c.env) === 'production' ? 'production' : 'sandbox';
  return { env: envName, clientId: env.PLAID_CLIENT_ID || c.clientId, secret: env.PLAID_SECRET || c.secret, redirectUri: env.PLAID_REDIRECT_URI || c.redirectUri, fromEnv: Boolean(env.PLAID_CLIENT_ID), host: envName === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com' };
}
async function post<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const c = plaidConfig((await readState()).integrations.plaid);
  if (!c.clientId || !c.secret) throw new PlaidError('Plaid client id and secret are not set (Finance → Settings).');
  let res: Response;
  try { res = await fetch(`${c.host}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'PLAID-CLIENT-ID': c.clientId, 'PLAID-SECRET': c.secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); }
  catch (e) { throw new PlaidError(`Could not reach Plaid: ${e instanceof Error ? e.message : 'network error'}`, 'NETWORK_ERROR'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PlaidError(String(data.display_message || data.error_message || `Plaid request failed (${res.status}).`), String(data.error_code || `HTTP_${res.status}`));
  return data as T;
}

/** Link token for a new connection, or for update mode (reconnect) when `itemId` is given. */
export async function linkToken(itemId?: string): Promise<string> {
  const s = await readState(), c = plaidConfig(s.integrations.plaid);
  const item = itemId ? s.integrations.plaid.items.find((i) => i.id === itemId) : undefined;
  const data = await post<{ link_token?: string }>('/link/token/create', { client_name: 'AadOS', language: 'en', country_codes: ['US'], user: { client_user_id: 'aados-owner' }, ...(item ? { access_token: item.accessToken } : { products: ['investments'] }), ...(c.redirectUri ? { redirect_uri: c.redirectUri } : {}) });
  if (!data.link_token) throw new PlaidError('Plaid did not return a link token.');
  return data.link_token;
}
export async function exchange(publicToken: string, institutionId: string, institutionName: string): Promise<string> {
  const data = await post<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: publicToken });
  let id = '';
  await updateState((s) => {
    const items = s.integrations.plaid.items, hit = items.find((i) => i.itemId === data.item_id);
    if (hit) { Object.assign(hit, { accessToken: data.access_token, status: 'ok', lastError: '' }); id = hit.id; return; }
    id = randomBytes(8).toString('hex');
    items.push({ id, itemId: data.item_id, accessToken: data.access_token, institutionId, institutionName: institutionName || 'Institution', status: 'ok', lastError: '', lastSyncedAt: '', lastSyncSummary: '' });
  });
  return id;
}
export async function removeItem(q: Q, id: string) {
  const item = (await readState()).integrations.plaid.items.find((i) => i.id === id);
  if (!item) return;
  await post('/item/remove', { access_token: item.accessToken }).catch(() => undefined);
  // Accounts stay (history kept) but are unlinked and become manual.
  await q.query("UPDATE fin_accounts SET plaid_account_id = NULL, plaid_item_id = NULL, source = CASE WHEN source = 'plaid' THEN 'manual' ELSE source END, updated_at = now() WHERE plaid_item_id = $1", [item.itemId]);
  await updateState((s) => { s.integrations.plaid.items = s.integrations.plaid.items.filter((i) => i.id !== id); });
}

export type PlaidAccount = { accountId: string; name: string; officialName: string | null; mask: string | null; type: string; subtype: string | null; balance: number | null };
export async function accounts(item: PlaidItem): Promise<PlaidAccount[]> {
  const data = await post<{ accounts: any[] }>('/accounts/get', { access_token: item.accessToken });
  return (data.accounts || []).map((a) => ({ accountId: a.account_id, name: a.name, officialName: a.official_name ?? null, mask: a.mask ?? null, type: a.type, subtype: a.subtype ?? null, balance: a.balances?.current ?? null }));
}
export function mapType(subtype: string | null): string {
  const s = (subtype || '').toLowerCase();
  if (['401k', 'roth 401k', '403b', 'roth 403b', '457b', 'roth 457b'].includes(s)) return '401(k)';
  if (['ira', 'sep ira', 'simple ira', 'rollover'].includes(s)) return 'Traditional IRA';
  if (s === 'roth') return 'Roth IRA';
  if (s === 'hsa') return 'HSA';
  if (s === '529') return '529';
  if (s === 'utma' || s === 'ugma') return 'UTMA';
  if (['brokerage', 'non-taxable brokerage account', 'cash management'].includes(s)) return 'Regular Brokerage';
  return 'Other';
}
export const displayName = (a: PlaidAccount) => { const base = a.officialName || a.name || 'Plaid account'; return a.mask && !base.includes(a.mask) ? `${base} ••${a.mask}` : base; };

type Pos = { ticker: string; name: string; quantity: number; unitCost: number | null; price: number | null };
/** Holdings per Plaid account: securities resolved to tickers (else CUSIP/ISIN), same-ticker lots merged, non-USD skipped. */
export function mapHoldings(holdings: any[], securities: any[]): Map<string, Pos[]> {
  const sec = new Map(securities.map((s) => [s.security_id, s]));
  const acc = new Map<string, Map<string, Pos & { costTotal: number | null }>>();
  for (const h of holdings) {
    const s = sec.get(h.security_id);
    if (!s || (h.iso_currency_code && h.iso_currency_code !== 'USD') || !h.quantity) continue;
    const ticker = s.type === 'cash' ? 'CASH' : String(s.ticker_symbol || s.cusip || s.isin || s.sedol || s.security_id).toUpperCase();
    const per = acc.get(h.account_id) || new Map(); acc.set(h.account_id, per);
    const cur = per.get(ticker);
    if (cur) { cur.quantity += h.quantity; cur.costTotal = cur.costTotal !== null && h.cost_basis != null ? cur.costTotal + h.cost_basis : null; cur.price = h.institution_price ?? cur.price; continue; }
    per.set(ticker, { ticker, name: ticker === 'CASH' ? 'Cash' : s.name || ticker, quantity: h.quantity, price: ticker === 'CASH' ? 1 : h.institution_price ?? null, unitCost: null, costTotal: h.cost_basis ?? null });
  }
  const out = new Map<string, Pos[]>();
  for (const [id, per] of acc) out.set(id, [...per.values()].map(({ costTotal, ...p }) => ({ ...p, unitCost: p.ticker === 'CASH' ? 1 : costTotal !== null && p.quantity ? costTotal / p.quantity : null })));
  return out;
}

/** Link a Plaid account to a Finance account (existing, or a new one). Refuses to link one Finance account twice. */
export async function linkAccount(q: Q, item: PlaidItem, a: PlaidAccount, existingId: string): Promise<string> {
  if (existingId) {
    const row = (await q.query('SELECT plaid_account_id FROM fin_accounts WHERE id = $1', [existingId])).rows[0];
    if (!row) throw new PlaidError('Finance account not found.');
    if (row.plaid_account_id && row.plaid_account_id !== a.accountId) throw new PlaidError('That Finance account is already linked to another Plaid account.');
    await q.query('UPDATE fin_accounts SET plaid_account_id = $2, plaid_item_id = $3, updated_at = now() WHERE id = $1', [existingId, a.accountId, item.itemId]);
    return existingId;
  }
  await ensureLookup(q, 'brokerage', item.institutionName);
  return saveAccount(q, { name: displayName(a), type: mapType(a.subtype), brokerage: item.institutionName, source: 'plaid', plaidAccountId: a.accountId, plaidItemId: item.itemId });
}

/** Sync holdings for every linked account of an item. Provider data refreshes quantities/prices/cost; manual holdings
 *  and history are preserved; accounts also synced from E*TRADE are skipped (no double counting). */
export async function syncItem(q: Q, itemId: string): Promise<string> {
  const item = (await readState()).integrations.plaid.items.find((i) => i.id === itemId);
  if (!item) throw new PlaidError('Plaid item not found.');
  try {
    const data = await post<{ holdings: any[]; securities: any[] }>('/investments/holdings/get', { access_token: item.accessToken });
    const byAccount = mapHoldings(data.holdings || [], data.securities || []);
    const linked = (await q.query('SELECT id, plaid_account_id, etrade_account_id_key FROM fin_accounts WHERE plaid_item_id = $1', [item.itemId])).rows;
    let updated = 0, added = 0, skipped = 0;
    for (const acct of linked) {
      if (acct.etrade_account_id_key) { skipped++; continue; }
      const current = (await q.query('SELECT id, ticker, name, source FROM fin_holdings WHERE account_id = $1', [acct.id])).rows;
      const byTicker = new Map(current.map((h) => [String(h.ticker).toUpperCase(), h]));
      const seen = new Set<string>();
      for (const p of byAccount.get(acct.plaid_account_id) || []) {
        seen.add(p.ticker);
        const h = byTicker.get(p.ticker);
        const fields = { accountId: acct.id, ticker: p.ticker, name: p.name, quantity: p.quantity, costBasis: p.unitCost ?? p.price ?? 0, currentPrice: p.price, previousClose: h ? undefined : p.price, priceSource: 'plaid', source: 'plaid' };
        if (h) { updated++; await saveHolding(q, { ...fields, id: h.id, previousClose: null }); } else { added++; await saveHolding(q, fields, autoCategories(p)); }
      }
      for (const h of current) if (h.source === 'plaid' && !seen.has(String(h.ticker).toUpperCase())) await q.query('DELETE FROM fin_holdings WHERE id = $1', [h.id]);
      await q.query('UPDATE fin_accounts SET last_synced_at = now() WHERE id = $1', [acct.id]);
    }
    const summary = `${updated} updated, ${added} added${skipped ? `, ${skipped} skipped (synced from E*TRADE)` : ''}`;
    await updateState((s) => { const it = s.integrations.plaid.items.find((i) => i.id === itemId); if (it) Object.assign(it, { status: 'ok', lastError: '', lastSyncedAt: new Date().toISOString(), lastSyncSummary: summary }); });
    return summary;
  } catch (e) {
    const err = e instanceof PlaidError ? e : new PlaidError(e instanceof Error ? e.message : 'Plaid sync failed');
    await updateState((s) => { const it = s.integrations.plaid.items.find((i) => i.id === itemId); if (it) Object.assign(it, { status: err.needsReauth ? 'login_required' : 'ok', lastError: err.message }); });
    throw err;
  }
}
