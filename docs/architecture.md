# AadOS architecture

AadOS is an independent, self-hosted **personal** operating system (not Family OS, AJMCP or AJ Core). Source of truth: `ssnanda/AadOS` on `main`. Supported accounts: Gmail, Zoho Mail, Google Calendar, Zoho Calendar. No Microsoft integrations.

| Layer | Implementation |
| --- | --- |
| Web | SvelteKit 2 / Svelte 5 / TypeScript (adapter-node). Owns mail/calendar sync, AI orchestration and documents. |
| API | Elixir/Phoenix: runs all Ecto migrations at start-up, credential vault, token-authenticated `/internal/v1` read API. |
| Data | PostgreSQL 16 (primary in local Docker, `AADOS_STORAGE=postgres`): `app_state` (jsonb document, secrets removed), `mail_credentials` (AES-256-GCM), relational AI/document tables, mail mirror. OpenShift still defaults to the encrypted file until migrated. |
| AI | The owner's existing **AJMCP** gateway (`/v1/chat`, `/v1/capabilities`) with AadOS's own site token. AadOS does retrieval; AJMCP does provider/model routing. No gateway, MCP server or model runs inside AadOS. |
| Files | The owner's existing **RustFS** (S3 API) — one private bucket, keys under `aados/`; metadata + extracted text in PostgreSQL. |
| Jobs | In-process, idempotent schedulers in the web app (mail sync, calendar sync, reminders, AI triage, document extraction); all state durable in PostgreSQL. Oban is migrated and running in the API but not yet used (provider code lives in TypeScript). |
| Operations | Local: `bin/dev-local.sh` (Docker Compose). Release: `bin/bump.sh`. Deploy: `bin/oc-deploy.sh` (OpenShift, manual approval). |

## AI data flow (privacy)
1. Nothing is sent to AJMCP until Settings → AI → *Enable AI*. Background triage is a separate opt-in.
2. A question is answered by **deterministic retrieval in AadOS** (inbox rows, calendar occurrences, tasks, reminders, document full-text search), limited by the per-type sharing switches.
3. At most 12 sources / ~3.6 KB of excerpts go to AJMCP in one user turn (AJMCP limits: 20 messages × 6000 chars, 32 KB), wrapped in an *untrusted SOURCES* block. Event descriptions, tokens and full mailboxes are never sent; full email bodies only if *Send full email text* is on.
4. Replies keep only citations to real source IDs; sources link back to the original record. AI output is labelled and never sends email, edits documents or changes provider data.
5. AJMCP may forward to an external provider and keeps a bounded in-memory transcript visible to its admin (cleared on restart).

## Trust model
Single owner password gate; server-side session revocation; persistent login rate limit. Every AI, document and notification route is behind the session check in `hooks.server.ts`. AJMCP and RustFS credentials exist only in server env (never sent to the browser or logged). Provider mailboxes and calendars are read-only.
