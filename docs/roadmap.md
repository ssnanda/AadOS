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
22. [x] Zoho shared mailboxes with the same right-side “More from sender” experience as regular email and saved views (owner browser verification pending)

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
71. [ ] Zoho reply "Invalid Input": action sent as "Reply" → now "reply"; Zoho errors show errorCode/moreInfo. Untested (no test send by agent).
72. [x] Email Reply menu: residential reply loads “Schedule Your Showing – Text Us Directly” from the live Zoho Templates folder and composes from/Cc `leads@intlord.com`. Awaiting owner verification; no message sent by agent.
73. [x] AAD action report: AJMCP reviews every PDF attachment in the view (plus email body and bounded non-PDF attachments); cached reviews versioned for refresh. Awaiting owner verification.
74. [x] Dashboard receives only open AAD actions; dates, updates, and FYIs remain in the full AAD report. Awaiting owner verification.
75. [x] Emails header: account and unread-folder pills collapse by default behind an Accounts toggle on desktop and mobile. Message sender/subject/preview typography enlarged for scanning. Awaiting owner verification.
76. [x] API OpenShift build: Hex/Rebar/dependency downloads use a 180-second Hex timeout, lower concurrency, and three bounded attempts. Awaiting owner deployment verification after build 56 timed out.
77. [x] AAD intelligence page: legacy AAD view auto-upgrades from generic to digest; report requires priority, owner, category, direct link and operational details; action overview is primary and source emails collapse as evidence. Awaiting owner verification.
78. [x] AAD report cleanup: remove legacy folder/parser header, move a large green Review now button left, and suppress stale AI-setting errors once current settings satisfy the review gate. Awaiting owner verification.
79. [x] Email action parity: Delete/Unread advance with hover/focus “& close” alternatives; custom views default to Unread and use the full sequential reader; shared mailboxes add advancing preview, reply, find, sender filtering, Asana and navigation. Awaiting owner verification.

### Native mobile app — Flutter, iOS + Android, Email first (2026-11-23) — see docs/mobile.md
80. [x] Server: bearer-token auth (same signed session token), 401 JSON for app/API calls — untested
81. [x] Server: `/api/mobile/login` (shared lockout via `lib/server/login.ts`), `/api/mobile/me` — untested
82. [x] Server: `/api/mobile/emails` + `/api/mobile/emails/mark`; list/mark logic shared with `/emails` via `lib/server/email-list.ts` — `npm run check` 0 errors; owner to verify the web Emails page is unchanged
83. [x] `apps/mobile` Flutter project (iOS + Android), bundle id `com.aadnanda.aadosapp` — owner: `flutter pub get && flutter analyze` (never compiled yet)
84. [x] Sign-in, Keychain/Keystore token, server address, auto sign-out on 401
85. [x] Inbox: view chips + counts, folder/views/categories drawer, search, pull to refresh, 2-min live sync + on resume, infinite scroll, cached first page
86. [x] Swipe read/unread and delete; long-press multi-select bulk actions
87. [x] Reader: HTML (JS off, CSP), swipe between emails, Delete/Unread advance, “& close” variants, next prefetched
88. [x] Reply / Reply all / Forward / Residential template; AI draft & polish; Send
89. [x] More from sender (sender/domain, per-row + bulk), details, unsubscribe, find (highlight)
90. [x] AI insight card, Summarize, Suggest follow-up; Important / Follow-up / Needs action / Reviewed
91. [x] More tab: other sections (Calendar, Tasks, Finance, …) in a signed-in web view; settings; sign out; version; dark mode
92. [ ] Owner: build + run the Flutter app on iPhone and Android; report issues
93. [x] `bin/build-ipa.sh` builds the Flutter iOS app and packages its unsigned Runner.app for AltStore — awaiting owner verification
94. [ ] Native next: shared mailboxes, Email → Asana, attachments, then Calendar/Tasks
95. [x] Mobile Mail: hide accounts and folders with zero unread messages — awaiting owner verification
96. [x] Mobile Mail: remove the top smart-view chips until replacement navigation is specified — awaiting owner verification
97. [x] Mobile Mail: detect event-like email details and add an editable event to Apple Calendar through EventKit — awaiting owner verification
98. [x] Mobile Mail: mark one or many messages as Pending action, show the persistent label, and clear it from the reader — awaiting owner verification
99. [x] Saved email value: automatic Coupon detection requires expiry language + a concrete parsed date; Gift Card is manual with no expiry — awaiting owner verification
100. [x] Conditional Coupon/Gift Card tiles appear only in the Shopping view on web and Flutter; each hides independently when empty — awaiting owner verification

### Native app tabs (2026-11-24) — see docs/mobile.md
101. [x] App icon badge = unread mail (iOS native channel, badge-only permission; Android via app_badge_plus) — updates only while the app runs (no push). Awaiting owner verification
102. [x] AadOS “a” app icon for iOS and Android (from the retired SwiftUI shell artwork) — awaiting owner verification
103. [x] Native Calendar tab: Month / Week / Day / List, swipe between periods, event details, create/edit/delete on editable calendars, calendar filter — awaiting owner verification
104. [x] Native Conference Room tab (inside Calendar): free/busy now, day timeline, 14-day list, pick room calendar, Book — awaiting owner verification
105. [x] Native Asana tab: Due / Incoming / To do / Doing / Upcoming / No date / All, swipe complete / next stage, task detail (notes, due, subtasks, comments, timer), new task, AI plan/summary — awaiting owner verification
106. [x] Messages: native client over BlueBubbles (iOS does not let third-party apps read or send iMessage/SMS); folders, unread, thread, photos, canned replies, AI suggest/summary, SMS threads — awaiting owner verification
107. [x] Native Shared mailboxes: boxes with unread counts, Unread/All list, swipe read/trash, reader with Delete/Unread advance, reply from the box — awaiting owner verification
108. [x] Native Finance: Overview (net worth, chart, allocation, alerts), Positions, Accounts, Watchlist, Real estate, Insights (mute); price refresh. Editing holdings/accounts/connections stays on the web — awaiting owner verification
109. [x] Server: JSON `GET /calendar/data`, `/room/data` (+POST pick), `/asana/data`, `/finance/data`, `/messages/data` reuse each page's load; session 401s carry `x-aados-signin` so Asana/BlueBubbles 401s no longer sign the app out — `npm run check` not run by agent

### Inbox property tiles (2026-11-24)

110. [x] Inbox view **Leads**: listing-site prospects (Zillow/Trulia/HotPads relays, Apartments.com, Rent.com, Zumper, Realtor, Redfin, TurboTenant, ShowMojo …) and Rentec applications, any age — awaiting owner verification
111. [x] Inbox view **Scanned Docs**: subject "Scan from …" or sender sandip.smtp@itspector.com — awaiting owner verification
112. [x] Inbox view **Rent Payments**: money received via Cash App (cash@square.com "sent you $" / "You accepted $"), Zelle, Venmo "paid you", PayPal, Rentec EasyPay — awaiting owner verification
113. [x] Needs attention / People / Bills & renewals / Bulk removed from the inbox tabs (web) and app Dashboard tiles; `?view=` links still work — awaiting owner verification
114. [x] Mobile app: native Settings (all web tabs) via `/settings/app`; Gmail/Zoho reconnect in the in-app browser with auto-return — awaiting owner verification


### Email reader, speed and body search (2026-11-27)

115. [x] Preview: "Delete & close" / "Unread & close" always visible (no hover); full action row (incl. Reply, Rules, Find, More from sender, ↑ ↓) repeated below the body — awaiting owner verification
116. [x] Images: frame allows http: images, no referrer; Gmail cid: inline images embedded; next email's images warmed — Zoho cid: images not handled yet — awaiting owner verification
117. [x] Background read-only prefetch of every unread email body (all accounts) after each sync; nothing marked read — awaiting owner verification
118. [x] Emails page shows one search bar (global top search hidden there) — awaiting owner verification
119. [x] Body full-text search: PostgreSQL `mail_bodies` (API migration 20261127000001) filled in the background (300/run, text only, read-only); Emails search and /search match body text — awaiting migration + owner verification
120. [ ] Zoho inline (cid:) images
121. [ ] Image proxy (fetch remote images server-side so senders never see the browser; makes wider image prefetch safe)
122. [x] Settings → Rules: one page for Suggestions, AadOS rules, native Gmail filters (list/create/delete), Zoho (link to Zoho filters; not readable via API), built-in AadOS rules (read-only), activity log — awaiting owner verification
123. [x] Rule suggestions from stored mail (bulk senders piling up unread); owner picks action, where it lives (Gmail filter · AadOS this account · AadOS all accounts) and Auto vs Ask first; Hide — awaiting owner verification
124. [x] AadOS rule engine: Auto acts only on mail received after the rule exists (runs after live sync adds mail); Ask first waits for Apply/Skip; existing mail only via Apply now; delete = mailbox Trash; logged — awaiting owner verification
125. [x] Rules links: sidebar (under Emails), Emails header, reader "☰ Rules" (Zoho → prefilled AadOS rule; Gmail panel → All rules) — awaiting owner verification
126. [ ] AI-evaluated rule suggestions (beyond the bulk-sender heuristic)
127. [ ] Gmail native Delete/Important via filters (TRASH / IMPORTANT labels) — not offered until verified against the Gmail API
128. [x] AadOS rules: up to 3 conditions (From/Subject/To contains) with all/any; actions Mark read · Delete (Trash) · Important · Follow-up · Pending action · Reviewed; rules never act on the same email twice; reader ☰ Rules prefills sender + subject — awaiting owner verification
129. [x] Zoho native filters: not possible — Zoho Mail REST API has no filter endpoints (checked 2026-11-27); Zoho users use AadOS rules or Zoho Mail → Settings → Filters
130. [x] Undo: delete (Gmail untrash; Zoho move back to its folder), mark read (incl. by opening), mark unread; rule actions too; last 20 changes kept (server `mail-undo.ts`, `/api/mobile/emails/undo`, `/emails/undo`) — Zoho restore by message id unverified — awaiting owner verification
131. [x] Web: ↶ Undo in the Emails header and ⌘/Ctrl+Z — awaiting owner verification
132. [x] Phone: shake to undo (sensors_plus, deliberate two-swing shake, foreground only) → confirm dialog → result snackbar — needs `flutter pub get` + app build — awaiting owner verification
133. [x] Phone: Settings → Rules (opens the web Rules page in the signed-in web view) — awaiting owner verification
134. [x] Fix: Settings → Rules 500 when a Gmail filter has no action/criteria (forward-only/legacy filters) — awaiting deploy
135. [x] Rule conditions: Body field (search index; new mail read from the mailbox when a rule needs it) and "matches pattern" (case-insensitive regex) — web form + engine — awaiting owner verification
136. [x] Create rule from emails: `/api/mobile/rules` draft (common sender/domain/name, shared recipients, subject exact/prefix/pattern from similar subjects; body text for one email), preview count, create at AadOS (account/all) or Gmail filter; Zoho listed disabled (no API) — awaiting owner verification
137. [x] Phone: "Create rule…" in the reader menu and the selection menu → rule screen (tick/edit conditions, pick a phrase from the body, all/any, action, where it lives, Ask/Auto, apply to existing, Check matches) — needs app build — awaiting owner verification
138. [x] Rule builder (web, `RuleBuilder.svelte`): create from the reader (☰ Rules, Gmail + Zoho), from selected emails (☰ Create rule), or blank (Settings → Rules → + New rule); edit any AadOS rule (Edit · Dry run) — awaiting owner verification
139. [x] Dry run: matches in all stored mail, last 7 days first, then 30/90/365/All ("Look further back" when none); per email "would change" / "already done"; web builder + phone rule screen — awaiting owner verification
140. [x] Phone: Settings → Rules (web view) gets Edit · Dry run; Gmail filter rows no longer wrap "Delete" letter by letter — awaiting owner verification
141. [x] Phone inbox header: **R** button (left of search) opens Settings → Rules — needs app build — awaiting owner verification
142. [x] Phone More: web links removed; Settings pages listed directly in More with Rules, Shared mailboxes, Messages, Finance; ordered by how often each is opened on this phone (starts Rules first); reconnect warning on Emails & Calendar; old Settings screen moved to Trash — needs app build — awaiting owner verification
143. [x] Web: Settings tabs and the header ⚙ Settings menu list the most-opened pages first (per browser; starts Rules first); Emails header Rules button is now **R** — awaiting owner verification
144. [x] Web: ⚙ Settings back in the header (between Purge and Sign out), opening on hover/focus (click = Settings home; most-opened first); sidebar Settings group removed; header ⚙ Settings dropdown removed; duplicate Rules link under Emails removed — awaiting owner verification
145. [x] Phone More: RECENT section (last 3 opened, newest first) above ALL · MOST USED FIRST — needs app build — awaiting owner verification
146. [x] Coupons: expiry optional ("no expiry"; sorted last); phone reader ⋯ and selection ⋮ menus get Save as coupon (No expiry / Pick date) and Save as gift card — needs app build — awaiting owner verification
147. [x] Smart rules: action "Save as coupon" + "Keep only the newest N matching emails" (older → Trash, logged, undoable); runs when new matching mail arrives (Auto) and on Apply now / apply-to-existing; dry run marks "→ Trash (older)"; builder suggests coupon + keep 2 for promotional emails (web + phone) — awaiting owner verification
148. [x] Inbox tab rules on Settings → Rules: Leads / Scanned Docs / Rent Payments show their built-in detection (switch off), owner include/exclude conditions (contains or pattern), Edit · Dry run (why each email is in the tab), Open tab; used by tab lists and counts on web, phone and dashboard — awaiting owner verification
149. [x] Phone badges: Mail tab = shared mailboxes unread on the left (blue) and all unread mail on the right (red), growing outward so they never overlap; home-screen icon = both added; shared count refreshed every 5 min and on resume — needs app build — awaiting owner verification
150. [x] Web browser tab title: "(all unread mail · shared) Page" — same numbers as the phone badges; shared refreshed every 5 min — awaiting owner verification
151. [x] iPhone mail widgets (WidgetKit): Small / Medium / Large (full screen = Large + Medium); sections counts (mail · shared), latest unread, 7-day received chart, per account, Leads/Scans/Rent, rules today; server `/api/mobile/widget`; app pushes data via app group `group.com.aadnanda.aados`; More → Widgets to pick/reorder sections and email count — needs owner Xcode step (Widget Extension target `AadOSWidget` + App Group on Runner and widget), then widget code moved in from `ios/AadOSWidget-src/` — untested
152. [ ] Widget taps: deep links (aados://email/<key>, aados://mail) open the app today; routing to the exact email not wired yet
