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
8. [x] Preview: one action row (Delete, Mark read/unread, Keep unread ↓, Reply, Rules, Find, More from sender, ↑ ↓)
9. [x] "More from sender" as a right-side column with per-row and bulk read/delete
10. [x] Narrower list while previewing; bigger ✉/🗑 row icons

### Toolbox features chosen for AadOS (2026-11-17)
11. [ ] AI triage bar (Urgent / Delete / Mark read suggestions, review, apply, Re-run)
12. [ ] Auto-read senders
13. [ ] Auto-delete senders
14. [ ] Block sender
15. [ ] Spam / Not spam
16. [ ] Conversation mode + delete whole conversation
17. [ ] Group by sender + delete group
18. [ ] Day headers + Newest/Oldest sort
19. [ ] Canned replies
20. [ ] Send-as + signatures
21. [x] Email → Asana task: preview button, AI draft (title/due/project/notes), attachments, marks email read
22. [ ] Zoho shared mailboxes

### Asana module (live from Asana, token encrypted; nothing mirrored)
23. [x] Connect with personal access token; Refresh; Disconnect
24. [x] My Tasks: Incoming/Overdue/Today (+Upcoming/No date with Show all), complete with Undo, Acknowledge (+all), due badges, Add/Edit time, next-7-days + Next month reschedule chips with day load, repeat chip editor, bulk actions
25. [x] Board: My Tasks sections as columns, drag & drop (Done completes), Start / Start timer / Done, collapsible columns
26. [x] Calendar: month grid, drag to reschedule
27. [x] People & Teams: everyone in my teams with overdue/today/upcoming/no-date counts and task lists
28. [x] Recurring: repeating tasks with editable rule
29. [x] New Task (name, description, project, due day/time, repeat)
30. [x] Timers: Start/Stop, work note, time logged to the task as a comment
31. [x] AI: Plan my day, Summarize view, Help me do this
32. [x] Show all; "Dashboard due tasks only" (home dashboard Asana card)

### Phase 5 — Finance & Investments (AJAdvisor port) — see docs/finance.md
39. [x] PostgreSQL `fin_*` schema (Ecto migration), NUMERIC money, ids preserved, source tracking
40. [x] Finance model ported (cost-basis rules, buckets, auto categories, insights engine, real estate, CSV, ranges) + tests
41. [x] Prices (Yahoo, previous-session close), earnings, stale/missing flags, benchmarks, daily snapshots
42. [x] Dashboard: net worth, investments, cash, RE equity, gains, allocation (type/owner/category/asset class), history chart + ranges, period changes
43. [x] Accounts & holdings CRUD, owners/types/brokerages/categories, CSV import/export
44. [x] Watchlist, investment plans, decision journal (open/scheduled/completed/dismissed), insights + muting
45. [x] Real estate: properties, equity, cash flow, valuation history
46. [x] E*TRADE OAuth 1.0a read-only sync (sandbox/production) — needs owner keys to verify live
47. [x] Plaid Link, items, reconnect, unlink, duplicate protection — needs owner keys to verify live
48. [x] Finance alerts through AadOS notifications on the existing scheduler, configurable
49. [x] AI assistant finance facts behind explicit consent
50. [x] AJAdvisor migration: dry run, idempotent apply, rollback, reconciliation report (dry run verified on real data; apply pending deploy)
51. [x] Navigation, Finance permission, iOS via WebView shell, docs

### Email views — remove, weekly review, tutoring trends (2026-11-18)
52. [x] Settings → Views: Remove a view (clears its stored copies, remembered deletions and review results; mailbox untouched) — awaiting owner test
53. [x] "Weekly review (AI)" view type with editable focus (default: Aad, 5th grade; ignore elementary/high school/other classes) — per-email AI review incl. PDF/DOCX attachments, cached, deterministic merge — awaiting owner test
54. [x] Review items on the Dashboard attention list (open actions + dates in next 14 days); done / dismiss / + Task — awaiting owner test
55. [x] Mathnasium "Session Summary" emails → structured sessions + trend tab inside the review view (weekly chart, mastered / needs practice, AI note) — awaiting owner test
56. [ ] Unit tests for ai/weekly-digest.ts and ai/session-tracker.ts
57. [ ] Decide: mark Mathnasium reports read in the mailbox after extraction (owner question)
58. [x] Email Reply menu: "✦ Reply using AI" / "Reply All using AI" always listed; disabled with the exact reason + Settings link when AI isn't ready — awaiting owner test
59. [ ] Owner: create a dedicated AadOS site + assistant in AJMCP, paste URL + site token in Settings → AI, Test connection
60. [x] AI errors show AJMCP's HTTP status + error code / network code (e.g. "AJMCP is unavailable (HTTP 502 · no_provider)") — awaiting owner test
61. [x] Compose: "Draft with AI" polishes the owner's typed text instead of replacing it ("Polish with AI") — awaiting owner test
62. [x] Triage "Run now" message names the real blocker (gateway vs. PostgreSQL storage) — awaiting owner test
63. [x] Production PostgreSQL: `aados-db` (PG16, 5 Gi) + api migrations + web `AADOS_STORAGE=postgres`; secret keys postgres-password / credential-encryption-key / internal-api-token added by hand — `bin/oc-deploy.sh` should create them on fresh namespaces (owner edit)
64. [x] AJMCP via in-cluster Service (http://ajmcp-server.ajmcp.svc) instead of the public host — public route timed out from pods
65. [ ] Messages: Send follows SMS after a failed iMessage (iMessage/SMS chip per chat); Retry as SMS shows progress, falls back to /chat/new service SMS, rechecks delivery. Untested — owner to verify.
66. [ ] Messages: spam senders whose stop reply was delivered move from Spam to Spam reports (state.messageSpamDone); Spam keeps only unhandled senders (may hold genuine messages); Not spam works from both. Untested.
67. [ ] Messages: right-click a conversation → Move to Spam reports / back to Spam / Not spam / Move to Spam (op spam.done). Untested.
68. [ ] Messages SMS on macOS 26: AppleScript into the merged chat sends iMessage. sendSms now uses the BlueBubbles Private API when on, else /chat/new service SMS, then SMS;-; id; warns when SMS was not forced; Settings → Messages → Test shows Private API status. Untested.
69. [ ] Messages: senders reported to 7726 go to Spam reports at send time; existing reports backfilled from the numbers you texted 7726. Untested.
70. [ ] Messages folders match the Mac: Messages · Unknown Senders (BlueBubbles isFiltered) · Spam · Spam reports, + Unread only. Loads 1000 chats (BB lastmessage sort is not newest-first; 150 dropped known senders → "Needs you 0"). Badge = known-sender unread. Untested.
