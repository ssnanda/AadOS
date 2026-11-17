// E*TRADE (read-only): OAuth 1.0a out-of-band flow, account discovery, positions → holdings. Ported from AJAdvisor
// etrade.ts / etradeActions.ts. Never places orders. Keys and tokens live in the encrypted credential vault
// (state.integrations.etrade); env ETRADE_API_KEY / ETRADE_SECRET / ETRADE_SANDBOX override Settings.
import { createHmac, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { readState, updateState, type EtradeConfig } from '../aados-store';
import { autoCategories } from '$lib/finance/model';
import { ensureLookup, saveAccount, saveHolding, type Q } from './db';

type Token = { token: string; secret: string };
export type EtradeAccount = { accountId: string; accountIdKey: string; accountName: string; accountDesc: string; accountType: string; institutionType: string; accountStatus: string };
export type EtradePosition = { ticker: string; name: string; quantity: number; pricePaid: number | null; lastTrade: number | null; previousClose: number | null };

export function etradeConfig(c: EtradeConfig) {
  const sandbox = env.ETRADE_SANDBOX ? env.ETRADE_SANDBOX === 'true' : c.sandbox;
  return { sandbox, key: env.ETRADE_API_KEY || c.consumerKey, secret: env.ETRADE_SECRET || c.consumerSecret, fromEnv: Boolean(env.ETRADE_API_KEY), host: sandbox ? 'https://apisb.etrade.com' : 'https://api.etrade.com' };
}
const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a HMAC-SHA1 Authorization header (query params are part of the signature base). */
export function oauthHeader(method: string, url: URL, consumer: { key: string; secret: string }, token: Token | null, extra: Record<string, string> = {}, nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000).toString()): string {
  const params: Record<string, string> = { oauth_consumer_key: consumer.key, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: timestamp, ...(token ? { oauth_token: token.token } : {}), ...extra };
  const pairs = [...url.searchParams.entries(), ...Object.entries(params)].map(([k, v]) => [enc(k), enc(v)] as const).sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const base = [method.toUpperCase(), enc(`${url.origin}${url.pathname}`), enc(pairs.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const signature = createHmac('sha1', `${enc(consumer.secret)}&${enc(token?.secret ?? '')}`).update(base).digest('base64');
  return `OAuth ${Object.entries({ ...params, oauth_signature: signature }).map(([k, v]) => `${k}="${enc(v)}"`).join(', ')}`;
}

async function call(path: string, token: Token | null, extra: Record<string, string> = {}, query: Record<string, string> = {}) {
  const c = etradeConfig((await readState()).integrations.etrade);
  if (!c.key || !c.secret) throw new Error('E*TRADE consumer key and secret are not set (Finance → Settings).');
  const url = new URL(path, c.host);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: oauthHeader('GET', url, c, token, extra), Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    if (res.status === 401) throw new Error('E*TRADE rejected the request (401). Tokens expire at midnight US Eastern — reconnect E*TRADE.');
    throw new Error(`E*TRADE request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}
const parseToken = (body: string): Token => { const p = new URLSearchParams(body); const token = p.get('oauth_token'), secret = p.get('oauth_token_secret'); if (!token || !secret) throw new Error(`Unexpected E*TRADE token response: ${body.slice(0, 160)}`); return { token, secret }; };

/** Step 1: request token + the E*TRADE page where the owner approves and gets a verification code. */
export async function startConnect(): Promise<string> {
  const token = parseToken(await (await call('/oauth/request_token', null, { oauth_callback: 'oob' })).text());
  await updateState((s) => { s.integrations.etrade.requestToken = token.token; s.integrations.etrade.requestSecret = token.secret; s.integrations.etrade.lastError = ''; });
  const c = etradeConfig((await readState()).integrations.etrade);
  return `https://us.etrade.com/e/t/etws/authorize?key=${encodeURIComponent(c.key)}&token=${encodeURIComponent(token.token)}`;
}
/** Step 2: exchange the verification code for access tokens. */
export async function completeConnect(verifier: string) {
  const e = (await readState()).integrations.etrade;
  if (!e.requestToken) throw new Error('Start the E*TRADE connection first.');
  const access = parseToken(await (await call('/oauth/access_token', { token: e.requestToken, secret: e.requestSecret }, { oauth_verifier: verifier.trim() })).text());
  await updateState((s) => { Object.assign(s.integrations.etrade, { accessToken: access.token, accessSecret: access.secret, requestToken: '', requestSecret: '', connectedAt: new Date().toISOString(), lastError: '' }); });
}
export async function disconnect() { await updateState((s) => { Object.assign(s.integrations.etrade, { accessToken: '', accessSecret: '', requestToken: '', requestSecret: '', connectedAt: '', lastError: '' }); }); }
async function access(): Promise<Token> { const e = (await readState()).integrations.etrade; if (!e.accessToken) throw new Error('E*TRADE is not connected.'); return { token: e.accessToken, secret: e.accessSecret }; }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export async function listAccounts(): Promise<EtradeAccount[]> {
  const data = await (await call('/v1/accounts/list.json', await access())).json();
  return (data?.AccountListResponse?.Accounts?.Account || []).map((a: any) => ({ accountId: String(a.accountId ?? ''), accountIdKey: String(a.accountIdKey ?? ''), accountName: String(a.accountName ?? ''), accountDesc: String(a.accountDesc ?? ''), accountType: String(a.accountType ?? ''), institutionType: String(a.institutionType ?? ''), accountStatus: String(a.accountStatus ?? '') })).filter((a: EtradeAccount) => a.accountIdKey);
}
export async function portfolio(accountIdKey: string): Promise<EtradePosition[]> {
  const tok = await access(), out: EtradePosition[] = [];
  let path: string | null = `/v1/accounts/${encodeURIComponent(accountIdKey)}/portfolio.json`, query: Record<string, string> = { count: '200' };
  for (let page = 0; path && page < 25; page++) {
    const data: any = await (await call(path, tok, {}, query)).json();
    path = null; query = {};
    for (const p of data?.PortfolioResponse?.AccountPortfolio || []) {
      for (const x of p.Position || []) { const ticker = String(x.Product?.symbol ?? '').trim().toUpperCase(), quantity = num(x.quantity); if (ticker && quantity !== null) out.push({ ticker, name: String(x.symbolDescription ?? '').trim() || ticker, quantity, pricePaid: num(x.pricePaid), lastTrade: num(x.Quick?.lastTrade), previousClose: num(x.Quick?.previousClose) }); }
      if (p.nextPageUrl) { const u = new URL(String(p.nextPageUrl)); path = u.pathname; query = Object.fromEntries(u.searchParams); }
    }
  }
  return out;
}
/** Cash balance (net cash) of an account, when E*TRADE reports it. */
export async function cashBalance(accountIdKey: string, institutionType = 'BROKERAGE'): Promise<number | null> {
  try {
    const data: any = await (await call(`/v1/accounts/${encodeURIComponent(accountIdKey)}/balance.json`, await access(), {}, { instType: institutionType || 'BROKERAGE', realTimeNAV: 'true' })).json();
    const b = data?.BalanceResponse;
    return num(b?.Computed?.cashAvailableForInvestment) ?? num(b?.Computed?.netCash) ?? num(b?.Cash?.moneyMktBalance);
  } catch { return null; }
}

/** Import (or re-sync) one E*TRADE account into Finance: positions become provider-sourced holdings. Manual holdings are
 *  never touched; provider holdings that disappeared (sold) are removed — their snapshots/history stay. */
export async function syncAccount(q: Q, a: EtradeAccount): Promise<{ accountId: string; updated: number; added: number; removed: number }> {
  const existing = (await q.query('SELECT id FROM fin_accounts WHERE etrade_account_id_key = $1', [a.accountIdKey])).rows[0];
  await ensureLookup(q, 'brokerage', 'E*TRADE');
  const accountId = existing?.id || await saveAccount(q, { name: a.accountDesc || a.accountName || `E*TRADE ${a.accountId}`, type: a.accountType || 'Regular Brokerage', brokerage: 'E*TRADE', source: 'etrade', etradeAccountIdKey: a.accountIdKey });
  const [positions, cash] = await Promise.all([portfolio(a.accountIdKey), cashBalance(a.accountIdKey, a.institutionType)]);
  const current = (await q.query("SELECT id, ticker, source FROM fin_holdings WHERE account_id = $1", [accountId])).rows;
  const byTicker = new Map(current.map((h) => [String(h.ticker).toUpperCase(), h]));
  let updated = 0, added = 0, removed = 0;
  const seen = new Set<string>();
  const all = cash != null ? [...positions, { ticker: 'CASH', name: 'Cash', quantity: cash, pricePaid: 1, lastTrade: 1, previousClose: 1 }] : positions;
  for (const p of all) {
    seen.add(p.ticker);
    const h = byTicker.get(p.ticker);
    const fields = { accountId, ticker: p.ticker, name: p.name, quantity: p.quantity, costBasis: p.pricePaid ?? p.lastTrade ?? 0, currentPrice: p.lastTrade, previousClose: p.previousClose, priceSource: 'etrade', source: 'etrade' };
    if (h) { updated++; await saveHolding(q, { ...fields, id: h.id }); }
    else { added++; await saveHolding(q, fields, autoCategories(p)); }
  }
  for (const h of current) if (h.source === 'etrade' && !seen.has(String(h.ticker).toUpperCase())) { removed++; await q.query('DELETE FROM fin_holdings WHERE id = $1', [h.id]); }
  await q.query('UPDATE fin_accounts SET last_synced_at = now() WHERE id = $1', [accountId]);
  return { accountId, updated, added, removed };
}
/** Re-sync every linked E*TRADE account. Errors are recorded on the connection (shown in Settings, alerted). */
export async function syncAll(q: Q) {
  const keys = (await q.query('SELECT etrade_account_id_key k FROM fin_accounts WHERE etrade_account_id_key IS NOT NULL')).rows.map((r) => r.k as string);
  if (!keys.length) return { accounts: 0 };
  const accounts = (await listAccounts()).filter((a) => keys.includes(a.accountIdKey));
  for (const a of accounts) await syncAccount(q, a);
  await updateState((s) => { s.integrations.etrade.lastSyncedAt = new Date().toISOString(); s.integrations.etrade.lastError = ''; });
  return { accounts: accounts.length };
}
