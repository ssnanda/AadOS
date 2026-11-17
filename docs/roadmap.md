# AadOS — email-first delivery roadmap

## M0 — Initial GitHub bootstrap (v0.1.0)
- [x] Separate AadOS monorepo, API, and web app skeleton
- [x] Email overview endpoint that does not fabricate messages
- [x] Dashboard showing account connection state and basic inbox layout
- [x] Safe Git workflows and OpenShift/iOS entrypoint scripts
- [x] OpenShift deployment with HTTPS route for `os.aadnanda.com` and baseline CI
- [x] Password-protected owner login with explicit credential reset
- [ ] Install dependencies and run full build on a connected runner

## M1 — Secure personal mail connections
- [x] Owner identity/session authentication and CSRF-safe OAuth state (Gmail PKCE done; Zoho PKCE unsupported)
- [x] Read-only Zoho OAuth, personal-folder discovery and encrypted token storage
- [x] Folder-driven pipelines with Shop, Health and generic parsers
- [x] Manual and hourly incremental Zoho folder synchronization
- [x] Gmail `gmail.readonly`, user-label discovery and folder-driven synchronization
- [ ] Encrypted tokens in Postgres, per-account access isolation, revocation
- [ ] CloudNativePG deployment and Ecto migrations, Row-Level Security
- [ ] Oban incremental sync, dedupe, cursor/checkpoint and retry safety
- [x] Unified inbox, search, sender/account/thread grouping and pagination (unverified build, see development-handoff.md)
- [x] Show unread dashboard counts accurately
- [ ] Show actionable and account connection errors accurately

## M2 — AI email triage
- [ ] Newsletter/promotion/receipt/bill/appointment/travel classification beyond initial Shop and Health rules
- [ ] Clear explanations, confidence, importance and action needed
- [ ] Draft response suggestions with human review (no automatic sending)

## M3 — Operational hardening and mobile
- [ ] Owner-controlled workflows for any mail modifications
- [ ] SwiftUI iOS app, signed IPA and release workflow
- [ ] Backup/restore, monitoring, OpenShift GitOps and staged promotion

Keep scope small: deliver useful inbox access before extending to household tasks, calendars, finance, health, files or smart-home integrations.

## Phase 2 — Calendar, Tasks & Reminders (v0.1.29 – v0.1.30)
- [x] Google + Zoho Calendar (read-only): consent flow, discovery, per-calendar enable, incremental sync, recurrence/DST, attendees, meeting links (mock-tested; live verification pending owner consent)
- [x] Calendar UI: month / week / day / agenda, filters, colours, event panel
- [x] Tasks: notes, due time, tags, search, email/event links, duplicate prevention
- [x] Reminders: durable server-side scheduling, snooze/dismiss/done, notification center, history
- [x] Dashboard: today, next appointment, 7-day schedule, reminders, quick actions
- [x] PostgreSQL primary storage (local Docker), vault-encrypted credentials
- [ ] Live Google/Zoho calendar verification and browser review
- [ ] Relational tables + Oban jobs for calendar/tasks/reminders

## Phase 3 — AI, documents and notifications (v0.1.32)
- [x] AJMCP client (auth, limits, timeouts, bounded retries, error classes, capabilities) + Settings → AI (privacy controls, test connection, status)
- [x] AI Assistant: persistent conversations (PostgreSQL), search/rename/delete, cancel/retry, grounded answers with source links
- [x] Permission-aware retrieval (email, calendar, tasks, reminders, documents) with prompt-injection defences
- [x] Email insights (summary, category, importance, reply, deadlines/payments/renewals/appointments, suggested task) with fingerprint caching and opt-in background triage
- [x] AI reply drafts (generate/shorten/formal/friendly/regenerate, edit, save, copy) — never sent
- [x] AI daily briefing on the dashboard (cached, owner-triggered, conflicts detection)
- [x] RustFS adapter + Settings → Storage; Documents module (upload with progress, folders, filters, rename, delete, authenticated download)
- [x] Text extraction (TXT, DOCX, native PDF) + PostgreSQL full-text search; document questions/compare with citations
- [x] Save selected Gmail/Zoho attachments to Documents (deduplicated)
- [x] Browser notifications for due reminders (opt-in, deduplicated)
- [ ] Live AJMCP tenant for AadOS (owner creates the site/token) and live RustFS bucket/credentials
- [ ] OCR for scanned PDFs/images; Web Push (VAPID) while the browser is closed
- [ ] Move sync/triage/extraction to Oban; normalise calendar/tasks/reminders into relational tables
