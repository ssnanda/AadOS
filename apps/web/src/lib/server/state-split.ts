// Split application state into a database document (no secrets) and per-scope credentials, and back.
// Scopes: `account:<id>` (tokens), `app:zoho` / `app:gmail` (OAuth client secrets + pending flows). Pure; unit-tested.
import type { AadOSState } from './aados-store';

export type Credentials = Record<string, Record<string, unknown>>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function splitState(state: AadOSState): { doc: Record<string, unknown>; credentials: Credentials } {
  const doc = clone(state) as unknown as Record<string, any>;
  const credentials: Credentials = {};
  for (const account of doc.accounts as Record<string, any>[]) {
    credentials[`account:${account.id}`] = { accessToken: account.accessToken || '', refreshToken: account.refreshToken || '', expiresAt: account.expiresAt || 0 };
    account.accessToken = ''; account.refreshToken = ''; account.expiresAt = 0;
  }
  credentials['app:zoho'] = doc.zoho; credentials['app:gmail'] = doc.gmail;
  doc.zoho = {}; doc.gmail = {};
  return { doc, credentials };
}

export function assembleState(doc: Record<string, any>, credentials: Credentials): Record<string, any> {
  const state = clone(doc);
  for (const account of state.accounts || []) {
    const c = credentials[`account:${account.id}`];
    if (c) { account.accessToken = c.accessToken ?? ''; account.refreshToken = c.refreshToken ?? ''; account.expiresAt = c.expiresAt ?? 0; }
  }
  state.zoho = clone(credentials['app:zoho'] || {});
  state.gmail = clone(credentials['app:gmail'] || {});
  return state;
}

/** Key-order independent JSON, for integrity comparison of a state before and after a round trip. */
export function canonical(value: unknown): string {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}

export const countsOf = (s: { accounts?: unknown[]; items?: unknown[]; tasks?: unknown[]; pipelines?: unknown[]; dismissed?: unknown[] }) =>
  ({ accounts: s.accounts?.length || 0, messages: s.items?.length || 0, tasks: s.tasks?.length || 0, views: s.pipelines?.length || 0, dismissed: s.dismissed?.length || 0 });
