# Finance & Investments (Phase 5)

AadOS-native port of AJAdvisor. AJAdvisor is no longer needed once the migration below is verified.

## Architecture
- **Storage:** PostgreSQL tables `fin_*` (Ecto migration `apps/api/priv/repo/migrations/20261119000001_finance.exs`). Money, prices and quantities are `NUMERIC`. AJAdvisor ids are kept. `source` = `manual` | `etrade` | `plaid` | `ajadvisor`.
- **Secrets:** E*TRADE consumer keys/tokens and Plaid client secret/access tokens live in the encrypted credential vault (`state.integrations.etrade` / `.plaid`). Env overrides: `ETRADE_API_KEY`, `ETRADE_SECRET`, `ETRADE_SANDBOX`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_REDIRECT_URI`. Never returned to the browser.
- **Web:** `/finance` (tabs: Overview, Accounts, Positions, Watchlist, Plans & decisions, Insights, History, Real estate, Settings), JSON API `/finance/api`, import upload `/finance/import`.
- **Logic:** `src/lib/finance/model.ts` (cost-basis rules, buckets, auto categories, insights engine with AJAdvisor thresholds, real estate metrics, CSV, history ranges) — unit tested in `tests/finance-model.test.ts`.
- **Prices:** Yahoo chart API (delayed, no key) + earnings dates; stale (> 26 h) and missing prices are flagged and excluded from totals rather than guessed.
- **Scheduler:** the existing 15-minute pass (`pipeline-scheduler.ts`) runs `financeTick()`: refresh every pass during US market hours (9:30–16:30 ET), otherwise every 12 h. Each refresh writes the day's holding/account/portfolio snapshots (upsert) and evaluates alerts.
- **Alerts:** raised as AadOS reminders (notification bell), once per condition per trading day (`fin_alerts`), configurable in Finance → Settings; single insights can be muted.
- **AI:** finance facts reach the assistant only when Settings → AI → **Finance** is ticked (off by default). Numbers are computed by AadOS and labelled as records; the assistant cannot trade or change accounts.
- **iOS:** the app is a WebView shell, so Finance is available there through the responsive web UI.
- **Permissions:** Family members need the **Finance** permission; connections and import are owner-only.

## Connections (read-only, no order placement)
- **E*TRADE:** Finance → Settings → keys (sandbox/production) → Connect → approve on E*TRADE → paste the verification code → Accounts → Import. Tokens expire at midnight ET; reconnect when a sync reports 401.
- **Plaid:** Finance → Settings → client id/secret/environment → Connect an institution (Plaid Link) → Accounts → link each to a new or existing Finance account → Sync. Accounts already synced from E*TRADE keep E*TRADE as their holdings source (no double counting). Unlinking keeps accounts and history as manual records.

## Migrating from AJAdvisor
The original SQLite file is opened **read-only** and never modified. Re-running never duplicates; records already in AadOS are kept as they are. Logins and provider tokens are not migrated.

UI: Finance → Settings → Import from AJAdvisor → choose `ajadvisor/data/dev.db` → **Dry run** → **Migrate**.

CLI (local, Node 22.18+ / 24):
```sh
cd apps/web
AADOS_DATABASE_URL=postgres://… node scripts/finance-migrate.ts --db ~/Projects/ajadvisor/data/dev.db            # dry run
AADOS_DATABASE_URL=postgres://… node scripts/finance-migrate.ts --db ~/Projects/ajadvisor/data/dev.db --apply    # migrate
AADOS_DATABASE_URL=postgres://… node scripts/finance-migrate.ts --db ~/Projects/ajadvisor/data/dev.db --rollback # undo
```
Backup first (`pg_dump` of the AadOS database). Apply runs in one transaction and records a report in `fin_import_runs`; the migration is complete only when the report says **Reconciled** (record counts and money totals match).

Dry run against the owner's file (2026-11-17, read-only): 21 accounts, 73 holdings, 94 category links, 795 holding / 231 account / 11 portfolio snapshots, 43 properties, 0 plans/decisions/watchlist; 0 invalid records; holdings $3,198,284.80 + real estate $15,131,000 = latest AJAdvisor snapshot $18,329,284.80.

## Differences from AJAdvisor
- Net worth uses real-estate **equity** (value − mortgage); history totals keep AJAdvisor's gross definition so old and new snapshots compare, and the equity is stored alongside.
- E*TRADE/Plaid sync removes provider holdings that disappeared (sold); manual holdings are never touched. AJAdvisor left them.
- Email alerts (AJAdvisor SMTP) are replaced by AadOS notifications; Excel real-estate import is replaced by manual entry/CSV for holdings.
