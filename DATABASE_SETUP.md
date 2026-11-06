# Folio Database Setup & Schema Management

Folio connects to PostgreSQL (including Neon PostgreSQL or local PostgreSQL) via Drizzle ORM. Database connections read `DATABASE_URL` from the environment. The database stores account credentials, sessions, and workspace data; keep its connection string private.

---

## 1. Quickstart

### Fresh database initialisation

1. Create a PostgreSQL database and set its connection string as `DATABASE_URL` in the project-root `.env.local` file. Do not commit this file or share its contents.
2. Install dependencies and initialize the schema:

```sh
npm install
npm run db:init       # applies the base application schema and pending Drizzle migrations
npm run db:verify     # read-only comparison against src/db/schema.ts
npm run dev
```

For an existing database, use its existing `DATABASE_URL` so that Folio continues using the same data. The initializer is additive: it creates missing Folio schema and applies pending migrations without dropping tables or records.

### Production on Render

Set `DATABASE_URL` in the Render service's environment settings to the PostgreSQL provider's connection string. For the current deployment, the app's public origin is `https://folio-management-studio.onrender.com`; set both `APP_URL` and `NEXT_PUBLIC_APP_URL` to that value as well. Keep database credentials and other secrets in the host's environment settings, not in source control.

Before deploying schema changes to an existing database, take a database backup. Apply pending changes with `npm run db:migrate`, then run `npm run db:verify` to perform a read-only schema check. Neither command resets or deletes existing data.

---

## 2. Two-Layer Schema Architecture

Folio builds its PostgreSQL database in two ordered layers:

| Layer | Source | Tables & Features |
| --- | --- | --- |
| **Layer 1: Base Application Schema** | `src/db/base-schema-statements.json` | The 16 base tables: `folio_users`, `folio_sessions`, `folio_projects`, `folio_milestones`, `folio_tasks`, `folio_subtasks`, `folio_ideas`, `folio_activities`, `folio_google_accounts`, `folio_google_calendars`, `folio_google_events`, `folio_task_reminders`, `folio_notification_prefs`, `folio_notifications`, `folio_reminder_deliveries`, `folio_scheduler_runs` |
| **Layer 2: Drizzle Journal** | `drizzle/0000` through `0009` | 13 additional tables and column enhancements: `folio_recent_searches`, `folio_saved_filters`, `folio_ai_daily_usage`, `folio_ai_usage_reservations`, `folio_ai_preferences`, `folio_ai_conversations`, `folio_ai_messages`, `folio_auth_flows`, `folio_auth_identities`, `folio_auth_rate_limits`, `folio_password_resets`, `folio_email_verifications`, `folio_ai_tasks`, and `folio_users` profile/onboarding columns |

Both layers are idempotent and guarded by a session-level advisory lock (`72031917`), ensuring parallel cold-starts or simultaneous server instances cannot race.

---

## 3. Ordered Migrations Inventory

1. `0000_search_and_filters.sql` — Full-text search GIN indexes, `folio_recent_searches`, and `folio_saved_filters`.
2. `0001_folio_ai_usage.sql` — `folio_ai_daily_usage` and `folio_ai_usage_reservations`.
3. `0002_folio_ai_preferences.sql` — `folio_ai_preferences` (assistant persona, presentation, and style).
4. `0003_identity_and_onboarding.sql` — `folio_auth_flows`, `folio_auth_identities`, `folio_auth_rate_limits`, and onboarding columns.
5. `0004_neon_auth_identity_link.sql` — `folio_users.auth_user_id` linkage column (historical preservation).
6. `0005_neon_auth_unique_identity.sql` — `folio_users_auth_user_id_idx` unique index.
7. `0006_ai_conversations.sql` — `folio_ai_conversations` and `folio_ai_messages`.
8. `0007_password_recovery.sql` — `folio_password_resets` with foreign key cascade.
9. `0008_vip_experience.sql` — `folio_email_verifications`, `email_verified_at`, `welcome_email_sent_at`, and `guide_dismissed_at`.
10. `0009_ai_long_running_tasks.sql` — `folio_ai_tasks` for long-running AI task execution, heartbeats, intermediate partial output, and stale-worker recovery.

---

## 4. Foreign Key Architecture & Account Deletion Integrity

Folio has 40 foreign keys across its 29 tables, with 26 foreign keys directly referencing `folio_users.id` with `ON DELETE CASCADE`.

When an account is deleted via `DELETE /api/account`:
- The server verifies identity from the authenticated session and validates re-authentication (current password for password accounts, confirmation phrase matching user email).
- External Google Calendar tokens are revoked via Google's revocation endpoint.
- An atomic database transaction (`db.transaction`) explicitly deletes all child records in dependency order, followed by the user row in `folio_users`.
- Every deletion query is strictly scoped to `WHERE userId = user.id`. Other users' data is completely untouched.
- The global tables (`folio_scheduler_runs`, `folio_auth_rate_limits`) and the unmanaged `neon_auth` schema are never touched.

---

## 5. Schema Commands

- `npm run db:init` — Idempotently executes Layer 1 followed by pending Layer 2 migrations.
- `npm run db:migrate` — Alias for `db:init`, safe for deployment pipelines.
- `npm run db:verify` — Read-only verification comparing the live database against `src/db/schema.ts`. Exits with an error if any table or column is missing.

---

## 6. Screenshot & Test Databases

Never run automated screenshot generation or destructive tests against a production or application database.
- Screenshot generation requires `FOLIO_SCREENSHOT_MODE=local` and a dedicated loopback database named `folio_screenshots`.
- Remote Neon databases and databases with matching names to `DATABASE_URL` are strictly refused by safety guards.
- See [SCREENSHOTS.md](./SCREENSHOTS.md) for full instructions.
