# Development handoff

## Calendar (read-only) - session 4
- **Consent flow:** Settings -> Emails -> account row -> "Enable calendar" re-authorizes with the extra scope (Google `calendar.readonly` via incremental auth + PKCE + `login_hint`; Zoho `ZohoCalendar.calendar.READ,ZohoCalendar.event.READ`). `account.calendar` is true only when the provider's token response actually lists the scope. A plain Gmail reconnect keeps the grant (`include_granted_scopes`); a Zoho reconnect re-requests calendar scopes if any Zoho account has them.
- **Sync** (`lib/server/calendar-sync.ts`): scheduler (every 15 min, skips paused accounts, off the state lock via the detached path) + "Calendar sync" per account + "Sync calendars" on /calendar. Google: calendarList + events.list with `syncToken` (410 -> full resync), deletions applied. Zoho: calendars + 30-day `range` windows (-7d..+90d), full replace per calendar. Per-account errors are shown, never thrown; data is kept on failure. "Clear calendar" forgets an account's calendar data locally.
- **Tested with mocks only** (65 Node tests incl. calendar sync/merge/prune/410 fallback/concurrent-merge). The consent redirect was verified on the running stack (scopes, PKCE, login_hint). **No live Google/Zoho calendar call has happened yet** - needs the owner to click "Enable calendar" and approve. Zoho Calendar endpoint and field names follow its v1 docs but are unverified live.
- Calendar events live in the state document (`events`, `calendars`, `calendarSync`), so they are in PostgreSQL when `AADOS_STORAGE=postgres`. Not mirrored to relational tables yet.

## PostgreSQL is primary (local Docker stack) - session 4 (v0.1.27)
`bin/dev-local.sh rebuild` now starts `db` (postgres:16, volume `aados_aados-pgdata`, no published port), `api` and `web`.
- **API** runs Ecto migrations automatically on start (`AadOS.Api.Migrator`, after the Repo, before Oban/endpoint). The API image now ships `priv/` (it did not before, so migrations could never have run in a release). Oban tables are created by migration `20261117000002`.
- **Web** with `AADOS_STORAGE=postgres` (compose default) stores state in `app_state` (jsonb, one row, `SELECT ... FOR UPDATE` transactions). Provider tokens and OAuth client secrets are **not** in that document; they are AES-256-GCM ciphertext in `mail_credentials` (`vault.ts`, same wire format as the Elixir vault, tested both ways). Default when `AADOS_STORAGE` is unset is still the encrypted file, so OpenShift/production is unchanged.
- **First start auto-migration** (`importLegacyFile`): only when the DB has no state and `state.enc` exists: copy to `state.enc.pre-postgres-<ts>` (0600, same volume), import in one transaction, read back and compare canonical JSON with the source (any mismatch rolls back and the app refuses to start on Postgres), then log counts. `state.enc` is never modified or deleted. Real run on this Mac: 2 accounts, 4324 messages, 5 views imported; original sha256 unchanged; extra host backup at `~/aados-backups/`.
- **Rollback:** set `AADOS_STORAGE=file` (compose: `AADOS_STORAGE=file ./bin/dev-local.sh rebuild`). state.enc is a point-in-time snapshot from before the import; anything done since lives only in Postgres.
- **Relational mirror** (`mail_messages`, search index, `/internal/v1/*`) is rebuilt from `app_state` by `POST /internal/v1/mirror/refresh` (web calls it at start-up). Authoritative data is `app_state` + `mail_credentials`.
- Secrets (`POSTGRES_PASSWORD`, `AADOS_CREDENTIAL_ENCRYPTION_KEY`, `AADOS_INTERNAL_API_TOKEN`) are generated into the `aados-local-config` volume by `dev-local.sh`. **Losing the credential key makes stored tokens unreadable** (reconnect accounts); losing `AADOS_SESSION_SECRET` no longer matters once state is in Postgres, but keep it for rollback to the file.
- Verified locally (Docker): Node 58 tests incl. 6 real-Postgres tests (import integrity/idempotence, encryption at rest, 25 concurrent writers, rollback, per-account re-encryption, disconnect deletes tokens); Elixir 22 tests incl. real DB; full stack up, all pages 200 from Postgres, form write persisted across a web restart, real read-only sync of both mailboxes (added 1, 0 failed).

## Verification state (session 3, branch `feat/db-tasks-calendar`)
Local: `npm ci`-compatible lockfile committed; `npm run check` 0 errors; `npm test` 48/48; `npm run build` OK.
CI (GitHub Actions, Postgres 16 service): web, api (compile `--warnings-as-errors`, unit + **real-database** tests), scripts.
Not verified: UI in a browser, live Gmail/Zoho/Google Calendar/Zoho Calendar calls (no credentials), Gmail history sync against a real mailbox.
Elixir/Postgres are not installed on the dev Mac (`brew install` was blocked by the permission classifier), so Elixir changes are verified only by CI.

## Local workflow (no GitHub Actions needed)
- `bin/dev-local.sh rebuild` builds/starts the stack and **never touches git** (it used to auto-run `bump.sh` on a dirty tree: interactive prompt, commit, version bump, push).
- `bin/dev-local.sh test` runs `npm ci`, `npm run check`, `npm test`, then the Elixir unit + Postgres integration tests in Docker (`apitest` + throwaway in-memory `testdb`, compose profile `test`). Same checks as CI.
- `bin/dev-local.sh bump` (or `bin/bump.sh`) is the only path that commits/pushes; The commit always carries `[skip ci]` (no Actions run) unless `AADOS_RUN_CI=1`. The release tag is created and pushed by the script itself. CI otherwise runs only on pushes/PRs to `main` without that marker and on manual dispatch.
- Not yet run on this machine: Docker commands were blocked by the permission classifier during development; `bin/dev-local.sh test` is syntax- and compose-validated only.

## Architecture
- SvelteKit app still owns mail logic; authoritative state is the AES-256-GCM file `state.enc` (key derived from `AADOS_SESSION_SECRET`; rotating it makes the file unreadable).
- Phoenix API + PostgreSQL is a **mirror** (nothing reads from it for user data yet). Legacy state stays authoritative until the owner switches over.
- Pure, test-covered modules: `inbox`, `categories`, `dates`, `tasks`, `retry`, `oauth-state`, `sync-merge`, `security-store`, `gmail-history`, `db-compare`, `calendar/{model,google,zoho}`.

## Credential encryption design (`AadOS.Api.Vault`)
AES-256-GCM, fresh 96-bit IV per value, scope (`account:<id>`, `app:gmail`, `app:zoho`) bound as AAD so ciphertext moved between rows fails. Key: `AADOS_CREDENTIAL_ENCRYPTION_KEY` (base64 of 32 bytes: `openssl rand -base64 32`), independent of the session secret. `AADOS_CREDENTIAL_KEY_VERSION` (default 1) labels it; for rotation set the new key + new version and keep the old one as `AADOS_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` / `AADOS_CREDENTIAL_KEY_VERSION_PREVIOUS`, then call `AadOS.Api.Mail.Credentials.rotate/0`. Nothing is generated or stored by the app; the OpenShift manifest references optional secret keys `credential-encryption-key` and `internal-api-token` in `aados-api-secrets` (create them yourself; absent keys don't break rollout).

## Database schema (migrations, additive only)
- `20261116000001`: `mail_accounts`, `mail_messages` (unique `account_id, provider_message_id`; generated tsvector + GIN), `mail_message_views`, `mail_sync_checkpoints`.
- `20261116000002`: `mail_credentials` (ciphertext only), `mail_tasks`.

## Internal API (`/internal/v1`, bearer `AADOS_INTERNAL_API_TOKEN`, >= 32 chars, fails closed; 503 while DB disabled)
`GET /summary`, `GET /accounts` (no tokens), `GET /messages?account=&q=&unread=&category=&limit=&offset=` (full-text, max 200). Never returns credentials (tested).

## Feature flags
- `AADOS_ENABLE_DATABASE=true` (API): starts Repo + Oban. Default false.
- `AADOS_DB_READ=off|compare` (web): `compare` shows legacy-vs-database count differences under Settings -> General; legacy remains authoritative. There is deliberately no `on` yet (see below). Needs `AADOS_API_URL` and `AADOS_INTERNAL_API_TOKEN` on the web pod.

## Migration procedure (nothing destroys state.enc)
1. `cd apps/web && npm run state:backup` (verified 0600 copy; prints counts only).
2. `node scripts/state-tool.mjs export /safe/export.json --with-credentials` (adds tokens + OAuth app secrets; 0600; refuses to overwrite).
3. API host with `AADOS_ENABLE_DATABASE=true`, `DATABASE_URL`, `AADOS_CREDENTIAL_ENCRYPTION_KEY`: `mix ecto.migrate && mix aados.import_state /safe/export.json` (idempotent; tokens encrypted by the Vault before storage).
4. Move `/safe/export.json` to the Trash. Set `AADOS_DB_READ=compare` and check Settings -> General; `npm run state:verify` gives the legacy counts.
5. Rollback: `mix ecto.rollback --all` (or drop the `mail_*` tables); state.enc was never modified.

## Completed this session
Tasks (edit, priority, today/overdue/upcoming/no-date/done filters, sort), daily dashboard overview, detached syncs (network syncs run on a snapshot and merge in a short locked update: `sync-merge.ts`), parallel OAuth flows (per-attempt state, Gmail PKCE verifier per flow), persistent login rate limit and server-side session revocation ("Sign out everywhere", `security.json`), scheduled/bulk sync skips paused accounts (explicit per-account sync does not), Gmail history-API incremental sync with 404 fallback and per-label checkpoints, Calendar domain (recurrence incl. DST/EXDATE/overrides, Google + Zoho mappers, read-only agenda page), vault + internal API + Postgres integration tests in CI, deterministic installs (`npm ci`, committed lockfile).

## Not done
1. **DB read path (`on`)**: needs sync ingestion to write to Postgres first (categories/needs-reply are computed in TypeScript, so DB search can't match inbox filters yet). Next: Phoenix ingestion endpoint or move sync into the API, then flip reads.
2. **Oban durable sync jobs / `mail_sync_checkpoints` usage**: sync still runs in the web process (scheduler + per-page checkpoints in state.enc). Provider logic lives in TypeScript; porting to Elixir was deliberately not started.
3. **Zoho incremental sync**: no verified provider cursor; still the known-page walk. Don't invent one.
4. **Calendar live sync**: adapters are mock-tested only. Needs owner re-consent (`calendar.readonly` for Google, `ZohoCalendar.calendar.READ`/`ZohoCalendar.event.READ` for Zoho) and a connect flow + scheduler; Zoho endpoint/field names are unverified. State fields `calendars`, `events`, `calendarSync` exist.
5. Mocked OAuth-callback and token-refresh integration tests for the SvelteKit routes (needs a `$env` test harness).
6. AJMCP (AI) and RustFS integrations: no endpoints/credentials supplied.

## Known issues
- `updateState` still serialises writers; only sync network I/O moved off the lock. OAuth callbacks and per-page full sync still run inside the lock.
- Sessions are stateless apart from the `validAfter` cut-off; whole state file is decrypted per request.
- Gmail history checkpoint is set after a possibly truncated first scan (older mail is picked up by "Sync all").
