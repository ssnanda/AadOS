import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { readState } from '$lib/server/aados-store';
import { buildRows } from '$lib/server/inbox';
import { compareCounts, dbReadMode, fetchDbCounts, type Comparison } from '$lib/server/db-compare';

// Legacy state stays authoritative. In `compare` mode we also read the PostgreSQL mirror and report differences.
export const load: PageServerLoad = async () => {
  const mode = dbReadMode(env.AADOS_DB_READ);
  if (mode === 'off') return { db: { mode, error: '', comparison: null as Comparison | null } };
  try {
    const state = await readState();
    const rows = buildRows({ pipelines: state.pipelines, accounts: state.accounts, items: state.items });
    const perAccount: Record<string, number> = {};
    for (const r of rows) perAccount[r.accountId] = (perAccount[r.accountId] || 0) + 1;
    const legacy = { accounts: state.accounts.length, messages: rows.length, unread: rows.filter((r) => r.unread).length, tasks: state.tasks.length, perAccount };
    const db = await fetchDbCounts(fetch, env.AADOS_API_URL || '', env.AADOS_INTERNAL_API_TOKEN || '');
    return { db: { mode, error: '', comparison: compareCounts(legacy, db) } };
  } catch (cause) {
    return { db: { mode, error: cause instanceof Error ? cause.message : 'Comparison failed', comparison: null as Comparison | null } };
  }
};
