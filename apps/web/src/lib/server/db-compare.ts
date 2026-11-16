// Dual-read comparison between the legacy encrypted state and the PostgreSQL mirror. Pure, unit-tested.
export type Counts = { accounts: number; messages: number; unread: number; tasks: number; perAccount: Record<string, number> };
export type Comparison = { match: boolean; differences: string[] };

export function compareCounts(legacy: Counts, db: Counts): Comparison {
  const differences: string[] = [];
  for (const key of ['accounts', 'messages', 'unread', 'tasks'] as const) if (legacy[key] !== db[key]) differences.push(`${key}: legacy ${legacy[key]} vs database ${db[key]}`);
  for (const id of new Set([...Object.keys(legacy.perAccount), ...Object.keys(db.perAccount)])) {
    const a = legacy.perAccount[id] || 0, b = db.perAccount[id] || 0;
    if (a !== b) differences.push(`account ${id}: legacy ${a} vs database ${b}`);
  }
  return { match: differences.length === 0, differences };
}

/** Feature flag: `off` (default; legacy only) or `compare` (legacy stays authoritative; database is only compared). */
export const dbReadMode = (value: string | undefined): 'off' | 'compare' => (value === 'compare' ? 'compare' : 'off');

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** Summary from the internal API; throws a short, token-free message on failure. */
export async function fetchDbCounts(fetchImpl: Fetch, baseUrl: string, token: string): Promise<Counts> {
  if (!baseUrl || !token) throw new Error('AADOS_API_URL and AADOS_INTERNAL_API_TOKEN must be set');
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/internal/v1/summary`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  if (res.status === 503) throw new Error('Database is disabled on the API');
  if (res.status === 401) throw new Error('API rejected the service token');
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const body = await res.json();
  return { accounts: Number(body.accounts) || 0, messages: Number(body.messages) || 0, unread: Number(body.unread) || 0, tasks: Number(body.tasks) || 0, perAccount: body.per_account && typeof body.per_account === 'object' ? body.per_account : {} };
}
