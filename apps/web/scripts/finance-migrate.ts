#!/usr/bin/env node
// AJAdvisor → AadOS Finance migration (CLI). Node 22.18+/24 runs this TypeScript directly.
//
//   AADOS_DATABASE_URL=postgres://… node scripts/finance-migrate.ts --db ~/Projects/ajadvisor/data/dev.db            # dry run (default)
//   AADOS_DATABASE_URL=postgres://… node scripts/finance-migrate.ts --db … --apply                                    # migrate (one transaction)
//   AADOS_DATABASE_URL=postgres://… node scripts/finance-migrate.ts --db … --rollback                                 # remove what came from that file
//
// The SQLite file is opened read-only and never modified. Re-running --apply never duplicates (existing records are
// kept as they are). On OpenShift, reach PostgreSQL with `oc port-forward` or use Finance → Settings → Import instead.
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { migrateAjadvisor } from '../src/lib/finance/ajadvisor-import.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const file = arg('--db'), url = process.env.AADOS_DATABASE_URL;
const mode = process.argv.includes('--rollback') ? 'rollback' : process.argv.includes('--apply') ? 'apply' : 'dry-run';
if (!file || !url) { console.error('Usage: AADOS_DATABASE_URL=… node scripts/finance-migrate.ts --db /path/to/ajadvisor/dev.db [--apply | --rollback]'); process.exit(2); }

const sqlite = new DatabaseSync(file, { readOnly: true });
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (mode === 'rollback') {
    // Deletes only rows whose ids came from this AJAdvisor file (holdings/categories links cascade with their parents).
    const ids = (t: string) => sqlite.prepare(`SELECT id FROM "${t}"`).all().map((r: any) => r.id);
    await client.query('BEGIN');
    for (const [t, dest] of [['HoldingSnapshot', 'fin_holding_snapshots'], ['AccountSnapshot', 'fin_account_snapshots'], ['PortfolioSnapshot', 'fin_portfolio_snapshots'], ['Holding', 'fin_holdings'], ['Account', 'fin_accounts'], ['RealEstateProperty', 'fin_properties'], ['InvestmentPlan', 'fin_plans'], ['Decision', 'fin_decisions'], ['MutedSignal', 'fin_muted_signals']]) {
      const r = await client.query(`DELETE FROM ${dest} WHERE id = ANY($1::text[])`, [ids(t)]);
      console.log(`${dest}: removed ${r.rowCount}`);
    }
    await client.query("DELETE FROM fin_watchlist WHERE id LIKE 'aj-%'");
    await client.query('COMMIT');
  } else if (mode === 'apply') {
    await client.query('BEGIN');
    try { const report = await migrateAjadvisor(sqlite, client, 'apply'); await client.query('COMMIT'); console.log(JSON.stringify(report, null, 2)); if (!report.totals.matches) process.exitCode = 1; }
    catch (e) { await client.query('ROLLBACK'); throw e; }
  } else {
    console.log(JSON.stringify(await migrateAjadvisor(sqlite, client, 'dry-run'), null, 2));
  }
} finally { await client.end(); sqlite.close(); }
