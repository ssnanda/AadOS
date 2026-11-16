# Development handoff

## Session 1 (email) — status: implemented, NOT yet verified/committed

Base: v0.1.24. Nothing here is committed, pushed, version-bumped or deployed.
`npm install` was not run in the session, so `svelte-check` and `vite build` have **not** run.
Only `node --test` unit tests (pure modules) were run: 10/10 passing.

### Delivered
- **Multi-account views**: a view's folders carry their own `accountId`/`source` (`pipelineFolders`, `hasAccount`, `syncView`).
- **Unified inbox** at `/emails`: tabs All Inboxes / All Messages / Unread / Important / Needs Reply / Recent / Read;
  filters (account, category, read state, view, sender, date range, thread); search across accounts; 50/page; deduplicated
  by `accountId:messageId`; opens the existing sandboxed viewer; local actions (reviewed, not needed, needs action, follow-up, importance).
- **Hidden per-account Inbox feeds** (`Pipeline.system`, id `inbox-<accountId>`) created by `ensureInboxPipelines` (scheduler + first `/emails` visit).
  They sync through the existing pipeline machinery and are hidden from Views, sidebar, dashboard tiles and settings.
- **Categories** (`lib/server/categories.ts`): rule-based, multi-label, manual override (`item.categories`), importance override, counts.
- **Needs Reply / action** detection (reply, task, financial, appointment) with local state (`actionState`, `followUp`).
- **Gmail**: threadId captured, bounded retry/backoff (`gmailFetch`). **OAuth state** now constant-time (`oauth-state.ts`).
- **Account health**: `lastSync`/`lastError` per account, shown in Settings and the inbox.
- Dashboard summary links (need reply, important, bills, renewals, receipts) from deduplicated counts.
- Removed leftover Microsoft references (types, Phoenix features map, docs).

### Verify before committing
```
cd apps/web && npm install && npm run check && npm test && npm run build
```
Then open `/emails`, run "Sync all inboxes", try filters/search/actions, open a message.

### Audit notes (Phase 1)
- OK: session cookie HMAC + HttpOnly/Strict; login CSRF + rate limit; state writes are serialized and atomic (temp file + rename);
  tokens never leave the server (`publicState` strips them); OAuth callbacks are the only public data-less endpoints.
- Gaps (open): no PKCE (Zoho server flow does not support it; Google does); OAuth state is a single slot per provider
  (parallel connect flows overwrite each other); sessions cannot be revoked server-side; login rate limit is in-memory;
  no cross-process lock (single replica assumed); every request decrypts the whole state file.

### Not done (Session 2)
- Durable storage: PostgreSQL/Ecto/Oban migration (state is still the encrypted file; **keep it** until migrated and verified).
  Suggested first slice: Ecto schemas for accounts, messages (unique `account_id, provider_message_id`), message_labels, checkpoints;
  one-way import task reading the encrypted file; dual-read verification; keep file as rollback.
- Zoho: incremental by timestamp, retry/backoff wrapper (like `gmailFetch`), explicit expired-token reconnect state.
- Gmail: `to`/recipient parsing, history API incremental sync, system labels beyond INBOX in the picker.
- Integration tests with mocked provider responses (OAuth callback, token refresh, concurrent `updateState`) need a vitest/`$env` harness.
- Per-account manual sync button and sync preferences in Settings; PKCE for Gmail.
