# AadOS mobile app (iOS + Android)

Flutter app in `apps/mobile`. Bottom tabs: **Dashboard · Mail · Calendar (+ Conference Room) · Asana · More**. Native in More: **Messages, Finance, Shared mailboxes, Settings** (owner). Contacts, Documents, Assistant and Briefing still open the signed-in web page. This is the app packaged by `bin/build-ipa.sh`; the SwiftUI web shell in `ios/` is legacy source.

| | |
| --- | --- |
| Bundle id / applicationId | `com.aadnanda.aados` (replaces the legacy web-shell install) |
| Default server | `https://os.aadnanda.com` (changeable on the sign-in screen) |
| Min OS | iOS 15, Android `flutter.minSdkVersion` |
| Version | Root `VERSION` and Git commit count when built by `bin/build-ipa.sh` |

## How it talks to AadOS

The app signs in with the AadOS username/password and receives the same signed session token the web uses as its cookie. It sends it as `Authorization: Bearer <token>`. Gmail/Zoho tokens and the AJMCP key never leave the server.

- Token: iOS Keychain / Android Keystore (`flutter_secure_storage`). 30-day expiry like the web session; "Sign out everywhere" on the web ends it too. A 401 returns the app to sign-in.
- Plain HTTP only for `localhost`, `127.0.0.1`, `10.0.2.2` (Android emulator → Mac). Everything else must be HTTPS (ATS + Android network security config).
- Web sections get the token as the `aados_session` cookie in the web view.

### Server endpoints

New (`apps/web/src/routes/api/mobile/`):

| Endpoint | Purpose |
| --- | --- |
| `POST /api/mobile/login` `{username,password}` | → `{token, user}`. Same lockout as `/login` (`lib/server/login.ts`). Public. |
| `GET /api/mobile/me` | Who is signed in + server version. 401 = sign in again. |
| `GET /api/mobile/emails?view&account&folder&q&category&sender&thread&pipeline&page&pageSize` | The `/emails` list as JSON + `folders` for the drawer. |
| `POST /api/mobile/emails/mark` `{op, keys[]}` | Same ops as the `/emails?/mark` form action. |

Section data (each `GET` returns the web page's own `load` as JSON, same permission checks):

| Endpoint | Used by |
| --- | --- |
| `GET /calendar/data?view&date&off`, `POST /calendar/live`, `POST /calendar/events` | Calendar tab |
| `GET /room/data`, `POST /room/data {id}` (pick room calendar) | Conference Room |
| `GET /asana/data`, `POST /asana/api` | Asana tab |
| `GET /finance/data`, `POST /finance/api` | Finance |
| `GET /messages/data`, `POST /messages/api`, `GET /messages/attachment/{guid}` | Messages |
| `POST /emails/shared/api` | Shared mailboxes |
| `GET /settings/app?page=general\|emails\|views\|family\|messages\|ai\|storage`, `POST /settings/app {page, action, fields}`, `GET /settings/app?oauth=<state>` | Settings (owner only) |

A 401 signs the app out only when it is AadOS's own session (`x-aados-signin: 1`); Asana and BlueBubbles answer 401 for their own tokens.

Reused as-is with the bearer token: `POST /sync/live`, `GET /pipelines/{id}/message/{mid}` (`?prefetch=1`), `POST /emails/tools` (details, prepare, prepareResidential, send, related), `POST /emails/ai` (state, summarize, followup, draft).

The list and mark logic moved from `routes/emails/+page.server.ts` into `lib/server/email-list.ts`, so the web page and the app run the same code. `hooks.server.ts` accepts the bearer header and answers 401 JSON (not a login redirect) for `/api/*` and bearer requests. Family members get the same permission checks (`/api/mobile/emails` maps to the Emails section).

## Settings

All web Settings tabs are native (More → Settings): Emails & Calendar, Email views, General, Family, Messages, AI, Storage. `/settings/app` runs each web page's own `load` and form `actions` unchanged (fields become the form data), so validation and messages match the web.

- **Reconnect / connect Gmail or Zoho**: Google refuses OAuth inside an embedded web view, so the consent page opens in the in-app browser (SFSafariViewController / Custom Tab). The server remembers app-started flows (in memory, `lib/server/oauth-mobile.ts`); the callback then shows a "return to the app" page instead of redirecting to `/settings`, and the app polls `?oauth=<state>` to close the Safari view (iOS) and refresh. On Android the user closes the tab.
- **Password change** returns the re-issued session token, so the phone stays signed in while other devices are signed out.
- **Sign out everywhere** revokes all sessions, this phone included.

## Email features

| Web | App |
| --- | --- |
| Unread / Recent / Needs attention / People / Bills / Bulk / All tabs with counts | The temporary top view chips are removed; Mail opens directly to unread messages |
| Account pills, unread folders, saved views, categories | Drawer: All inboxes, only accounts and folders with unread mail, Views, Categories |
| Search all accounts | Search in the app bar |
| Auto sync on open, folder change, every 2 min while visible | Same; also on return to the app; pull to refresh = forced check |
| Pager | Infinite scroll |
| Row ✉ / 🗑 buttons | Swipe right = read/unread, swipe left = delete |
| Checkbox bulk actions | Long-press to select; Delete, Mark read/unread, Important, Follow-up, Reviewed, Select all |
| Preview with ↑ ↓ | Full-screen reader, swipe left/right or ↑ ↓ buttons, next email prefetched |
| Delete / Unread advance; “& close” variants | Bottom bar Delete / Unread advance; “& close” in ⋯ |
| Reply menu (Reply, Reply all, Forward, AI, Residential template) | Reply sheet with the same entries (AI disabled with the reason when not ready) |
| Compose, Polish with AI, quoted text, forward attachments | Compose screen with ✦ Draft/Polish, Cc/Bcc, quoted text, include attachments |
| More from sender (sender/domain, per-row and bulk read/delete) | Sender sheet with the same |
| Find in email | Find highlights matches (JavaScript stays off, so it cannot scroll to them) |
| Details, unsubscribe | ⋯ → Details & unsubscribe |
| ★ Important, Follow-up, Needs action / Reviewed | Star in the app bar; ⋯ menu |
| Manually flag an email for action | Reader ⋯ → Pending action; also available for multi-selected messages |
| Coupon or gift-card email | Coupons with explicit expiry language and a concrete date are detected automatically; Gift Cards are saved manually; tiles appear only inside the Shopping view |
| AI insight tag, Summarize, Follow-up suggestion | Insight card in the reader; ⋯ → Summarize / Suggest follow-up |
| Event details in an email | Detect event-like mail, review/edit the details, and add it to Apple Calendar |

Email HTML renders with JavaScript off and a CSP that only allows inline styles, `data:` fonts and https/`data:` images; links open in the browser.

### Not in the app yet (web only)

Email → Asana, Gmail Rules, save attachment to Documents, Filters form (date range), AI triage bar. Push notifications are not possible without a paid Apple Developer account (same limit as ajopsios). The home-screen icon badge shows unread mail and is updated while the app is open or recently backgrounded (iOS asks once for badge permission; Android numeric badges depend on the launcher — Samsung/Xiaomi/Huawei yes, stock Pixel shows dots only for notifications).

### Messages and iOS

iOS does not let a third-party app read the Messages database or send iMessage/SMS without the user tapping Send in Apple's compose sheet, and there is no way to receive texts. So the app is a native client for the BlueBubbles server on the Mac, through AadOS — same as the web.

## Build and run (owner)

```sh
cd /Users/sandip/Projects/aados/apps/mobile
flutter pub get
flutter analyze
flutter test
flutter run                      # simulator / connected device
flutter build ipa --no-codesign  # iOS (AltStore: zip Runner.app as Payload/, as ajopsios does)
flutter build apk --release      # Android
```

Against the local Docker stack: on the sign-in screen tap **Server** and enter `http://localhost:3100` (iOS simulator) or `http://10.0.2.2:3100` (Android emulator) — the Docker web port (`AADOS_WEB_PORT`, default 3100). A physical phone cannot reach it (bound to 127.0.0.1).

The release script runs Flutter's iOS release build, which generates the ephemeral Swift package and other Flutter build inputs before packaging `Runner.app` as an unsigned AltStore IPA:

```sh
./bin/build-ipa.sh --local
```
