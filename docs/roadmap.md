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
- [ ] Owner identity/session authentication and CSRF-safe OAuth state/PKCE
- [x] Read-only Zoho OAuth, personal-folder discovery and encrypted token storage
- [x] Folder-driven pipelines with Shop, Health and generic parsers
- [x] Manual and hourly incremental Zoho folder synchronization
- [x] Gmail `gmail.readonly`, user-label discovery and folder-driven synchronization
- [ ] Microsoft Graph `Mail.Read` grant
- [ ] Encrypted tokens in Postgres, per-account access isolation, revocation
- [ ] CloudNativePG deployment and Ecto migrations, Row-Level Security
- [ ] Oban incremental sync, dedupe, cursor/checkpoint and retry safety
- [ ] Unified inbox, search, sender/account/thread grouping and pagination
- [ ] Show unread, actionable, and account connection errors accurately

## M2 — AI email triage
- [ ] Newsletter/promotion/receipt/bill/appointment/travel classification beyond initial Shop and Health rules
- [ ] Clear explanations, confidence, importance and action needed
- [ ] Draft response suggestions with human review (no automatic sending)

## M3 — Operational hardening and mobile
- [ ] Owner-controlled workflows for any mail modifications
- [ ] SwiftUI iOS app, signed IPA and release workflow
- [ ] Backup/restore, monitoring, OpenShift GitOps and staged promotion

Keep scope small: deliver useful inbox access before extending to household tasks, calendars, finance, health, files or smart-home integrations.
