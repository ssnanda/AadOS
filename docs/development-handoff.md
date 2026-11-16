# Development handoff

## Status (v0.1.26 candidate, session 2)
Verified locally: `npm run check` (0 errors), `npm test` (19/19), `npm run build`. CI on branch run 43949265259: web, api (compile --warnings-as-errors + mix test), scripts all green.
Not verified: the Svelte UI in a browser (no live Gmail/Zoho credentials here), the Postgres importer against a real database (only its pure mapping is tested), a live OAuth/PKCE round trip.

## Architecture
- SvelteKit app owns all mail logic; state is one AES-256-GCM file `state.enc` (key = sha256 of `AADOS_SESSION_SECRET`, so **rotating that secret makes the file unreadable** — back it up first).
- Phoenix API (`apps/api`) is still a stub for email; Postgres/Oban only start when `AADOS_ENABLE_DATABASE=true`.
- Per-account hidden Inbox feeds (`Pipeline.system`) + user views feed one deduplicated unified inbox (`lib/server/inbox.ts`, key `accountId:messageId`).
- Pure, test-covered modules (no framework imports): `inbox.ts`, `categories.ts`, `dates.ts`, `retry.ts`, `oauth-state.ts`.

## Completed
- Unified inbox, filters, search, pagination, dedupe, categories, Needs Reply, local follow-ups/importance (session 1).
- Gmail PKCE (S256), shared retry/backoff (`retry.ts`) for Gmail and Zoho, Zoho 401 refresh-and-retry, reconnect messages for dead refresh tokens (shown in Settings with a Reconnect button), Gmail system labels (Inbox, Starred, Important, Sent, categories) selectable.
- Due-date extraction, per-account Sync / Auto on-off / Clear data, last sync + error per account.
- Local Tasks page (`/tasks`): tasks with due dates, email follow-ups -> tasks. Stored in `state.tasks`.
- DB foundation (additive): migration `20261116000001_create_mail_tables.exs` (mail_accounts, mail_messages with unique `(account_id, provider_message_id)` + GIN full-text, mail_message_views, mail_sync_checkpoints), `AadOS.Api.Mail.Importer`, `mix aados.import_state`.

## Database migration path (nothing is switched over yet)
1. Backup: `cd apps/web && npm run state:backup` (copies state.enc, 0600, verifies it decrypts, prints counts only).
2. Export without tokens: `node scripts/state-tool.mjs export /safe/path/export.json` (refuses to overwrite).
3. On the API host with `AADOS_ENABLE_DATABASE=true`, `DATABASE_URL`: `mix ecto.migrate && mix aados.import_state /safe/path/export.json` (idempotent; reports counts).
4. Compare: `npm run state:verify` (accounts/messages) vs the importer's counts (messages are deduplicated, so DB count <= file count).
5. Rollback: `DROP TABLE mail_message_views, mail_sync_checkpoints, mail_messages, mail_accounts;` (or `mix ecto.rollback`). state.enc is never modified by any of this. OAuth tokens are NOT in the DB.

## Not done / next
1. Credential vault: store provider tokens encrypted in Postgres (separate key from the session secret) — required before the file can be retired.
2. Read path: Phoenix endpoints (authenticated with a shared service secret) for messages/search; switch web inbox reads behind a flag; dual-read comparison.
3. Oban jobs for sync + checkpoints (`mail_sync_checkpoints` exists but is unused); Gmail history-API incremental sync; Zoho timestamp-incremental sync.
4. DB-backed importer test (needs a Postgres service in CI) and a mocked-provider integration harness (OAuth callback, refresh, concurrent `updateState`).
5. Calendars (Google / Zoho): need `calendar.readonly` / `ZohoCalendar.*.READ` scopes added, which means re-consent — needs the owner's approval. Not started.
6. Daily Dashboard: tasks + follow-ups + due soon are available; no dedicated page yet.
7. AJMCP (AI) and RustFS: no endpoints/credentials provided; not integrated.

## Known issues / audit gaps
- OAuth state is one slot per provider (parallel connect flows overwrite each other); Zoho has no PKCE support in this flow.
- Sessions are stateless (no server-side revocation); login rate limit is in-memory.
- Every request decrypts the whole state file; `updateState` holds the global queue during network syncs (writes wait).
- Scheduled sync skips paused accounts; manual sync does not.
