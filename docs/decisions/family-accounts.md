# Family accounts — design (proposed, awaiting owner confirmation)

Owner direction (2026-11-17): hybrid. Each family member has **their own space**; emails can be marked **Shared or Individual**;
calendars likewise (**shared family calendar vs individual calendars**); a **kids area** with accounts based on age.

## Roles
| Role | Who | Can do |
| --- | --- | --- |
| Owner | You | Everything; create/disable members; household settings (AI, storage, integrations). |
| Adult | Spouse/adult family | Own space (own Gmail/Zoho, tasks, reminders, documents, assistant) + everything shared with the household. |
| Teen (13–17, from birth date) | | Own space with limits (proposal: may connect own email; no AI background triage; owner can see their shared items, not individual mail). |
| Child (<13, from birth date) | | Kids area only: chores/tasks assigned to them, reminders, the shared family calendar, kid-safe dashboard. No email, no documents, AI off or kid-safe mode. |
Age band is computed from the stored birth date, so a child becomes a teen automatically.

## Sharing model
- **Email**: each connected account has a default visibility (Individual | Shared with household). Individual messages can be
  marked Shared (e.g. school notices, bills) — the reverse (Shared -> Individual per message) too. Shared items appear in a
  "Family" inbox for adults; nobody else ever sees Individual mail.
- **Calendar**: each provider calendar is Individual or Shared; plus a local **Family calendar** (AadOS-owned) for household events.
- **Tasks/reminders**: personal by default; household tasks can be assigned to members (chores for kids).
- **Documents**: personal by default; a "Family" folder visible to adults.
- AI only ever sees data the **asking user** may see (retrieval is filtered by user + sharing before anything is sent).

## Data model (additive migrations; existing data becomes the owner's)
- `users` (id, name, role, birth_date, login, scrypt password hash, disabled, created_at) — owner seeded from the current login.
- Sessions carry the user id (signed); every route resolves the user and authorizes per object.
- Per-user application state: `app_state` keyed by user id (owner keeps today's row), credentials scoped `user:<id>:account:<id>`.
- `shares` (object_type, object_id, visibility, shared_by) for email accounts/messages and calendars; `household_events`, task assignment.
- Relational tables (`ai_*`, `documents`) gain `user_id`; queries always filter by it.

## Delivery slices
1. Users + login per user + Family page (create/disable members, roles, birth date, reset password); owner-only Settings.
2. Per-user spaces (state, accounts, tasks, reminders, documents, assistant) with strict isolation tests.
3. Sharing: email account/message visibility + Family inbox; calendar visibility + Family calendar.
4. Kids area (age bands, chores, kid-safe dashboard, restricted navigation).

## Questions for the owner
1. Age bands OK (child < 13, teen 13–17)? What may a teen see/do?
2. "Shared" = whole household, or choose specific members per item?
3. May parents see a kid's individual data (email/tasks), or only shared items?
