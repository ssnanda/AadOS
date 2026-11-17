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
- [x] Make account inboxes and saved views first-class on the Emails page (owner browser verification pending)
- [x] Unread-first inbox, bulk local actions, and full-screen sequential email reader (owner browser verification pending)
- [ ] Show actionable and account connection errors accurately

## M2 — AI email triage
- [ ] Newsletter/promotion/receipt/bill/appointment/travel classification beyond initial Shop and Health rules
- [ ] Clear explanations, confidence, importance and action needed
- [ ] Draft response suggestions with human review (no automatic sending)

## M3 — Operational hardening and mobile
- [ ] Owner-controlled workflows for any mail modifications
- [x] Initial SwiftUI iOS workspace app and Xcode project (owner build verification pending)
- [x] Unsigned IPA packaging, local AltStore manifest, and IPA-only rolling GitHub release aligned with ajopsios (owner verification pending)
- [ ] App Store signing and release workflow
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

## Mail speed — live sync like a mail client (in progress)

1. [x] Auto sync of the open folder/inbox: on open, on folder change, every 2 min while visible (`/sync/live`); newest page only
2. [x] Phone deletes/moves leave AadOS (Gmail history removals + newest-page check, Gmail and Zoho)
3. [x] No sync buttons; Purge is separate and purge-only (open folders refill themselves)
4. [x] 15-min scheduler syncs calendars only (no background walk of every view)
5. [x] Preview: mailbox call outside the state lock; body cache; next email prefetched
6. [x] Delete: row disappears at once; 1 read + 1 write; parallel provider calls
7. [ ] One row per email in PostgreSQL instead of the single `app_state` blob (needs migration + backup; owner approval)
