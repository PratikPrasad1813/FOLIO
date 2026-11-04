# Folio — Global Search & Advanced Filters

This is an in-place extension of the existing Next.js App Router application. The dashboard, workspace/editor components, Google Calendar OAuth and event writes, notifications, reminder delivery, and theme tokens are retained. No runtime dependencies or mock production records were added.

## User-facing features

- **Global search:** use the header search button or **Ctrl+K / Cmd+K**. Search projects, tasks, and ideas in a single palette, or narrow to one category. Results include status, priority, project association, matching snippets, and highlighted terms.
- **Keyboard:** Up/Down changes the active result; Enter opens it; Escape closes the palette; the existing modal restores focus. Clicking a recent query re-runs it against current data.
- **Navigation:** projects open `/projects/<id>`; tasks use the existing Tasks view and details drawer; ideas use the existing Ideas view and editor. Records are rechecked against the current user before opening, including items created in another tab.
- **Recent searches:** eight per user, stored in PostgreSQL. Queries are remembered when opening a result, pressing Enter, clearing a completed query, or dismissing a completed search. Remove one or clear history. Unfinished keystrokes are not logged.
- **Tasks:** status, priority, project, no-project, labels, due-date range, overdue, today, this week (Monday–Sunday), upcoming, completed, and no-due-date filters. Multi-select within status/priority/project/labels is OR; separate filter families are AND. Label matching is case-insensitive.
- **Projects:** status, priority, progress percentage range, start-date range, deadline range, overdue, due today/this week, next-seven-day deadlines, no deadline, and existing archive mode.
- **Sorting:** created, updated, due date, priority, alphabetical; existing Smart/Status/Project task sorts and project Progress sorting remain. Null due dates stay last in both directions. Project progress matches Folio's existing completed-task / total-task ratio, rounded to a whole percentage (empty projects = 0%).
- **Saved filters:** named combinations include query, filters, and sort order. Save, reapply, or delete them from the Saved menu. Maximum 30 per user per resource. Case-insensitive duplicate names return a helpful error.
- **Views:** task Board/List/Calendar and project Grid/List remain in place. View switching does not reset the filter configuration. Pagination is explicit: 60 records per page, with Load more and an accurate matching count.
- **Themes and accessibility:** shared Folio tokens, responsive panels, labels, visible focus, combobox/listbox selection, loading/error/empty states, and reduced-motion support.

## Architecture and security

- `GET /api/search?q=…&scope=all|projects|tasks|ideas` uses PostgreSQL full-text matching, literal substring fallback, and relevance ordering. Titles rank ahead of body-only matches. Task notes, labels, and associated project names are searchable. Empty queries do not read all workspace records.
- At most six results per group are returned for Everything; category search returns at most 20, with a refinement hint when more exist. `limit` may be supplied up to 20.
- `GET /api/workspace/browse?kind=tasks|projects&filters=<JSON>&limit=60&offset=0` evaluates every condition, sort, progress calculation, and count in PostgreSQL. Maximum limit is 100; stable ID tie-breakers prevent arbitrary ordering.
- Search input is debounced by 220ms. Filter changes apply without an Apply round trip. Aborted/obsolete responses cannot replace newer results. Mutations revalidate results after saving; no full page reload is needed.
- All queries use Drizzle and parameterized values. Sort columns/directions and filter values are allow-listed. Text, JSON payload, array, percentage, date, UUID, and pagination limits are validated.
- Ownership comes from the existing Folio user/session resolver, never from a user ID in the request. Parent-project joins and detail lookups are also owner-scoped. Responses use `private, no-store` and `Vary: Cookie`; cross-origin requests are rejected.
- History and saved-filter writes use per-user PostgreSQL transaction locks for bounded history/quota consistency. Both tables have user foreign keys with cascade deletion.

### Existing authentication caveat

This branch originally **always resolved the shared demo user**, despite having existing session tables, `folio_session` cookies, and sign-in handlers. `getUser()` now honors valid sessions per request using that same cookie/hash/table format; it does not replace any provider or password/session mechanism. Invalid or expired cookies fail closed and return 401 from the new APIs.

The inherited anonymous demo entry point remains the default to preserve the current application. It is **shared, not a private production account**. Set `FOLIO_DEMO_MODE=false` to reject requests without a valid session. The existing branch's sign-in UI is still paused; restoring that UI is outside this feature. Its existing email/OAuth API handlers remain in place.

## API endpoints

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/search` | GET | Grouped, owner-scoped global search |
| `/api/search/entity?kind=…&id=…` | GET | Resolve an existing result for its native detail UI |
| `/api/search/recent` | GET, POST, DELETE | List/store recent queries; DELETE without id clears own history |
| `/api/search/recent?id=…` | DELETE | Remove one owned recent query |
| `/api/filters?kind=tasks\|projects` | GET | List owned saved filters |
| `/api/filters` | POST | Save `{ kind, name, config }` |
| `/api/filters?id=…` | DELETE | Delete an owned saved filter |
| `/api/workspace/browse` | GET | Paginated server filtering and sorting |

Saved configurations are versioned (`version: 1`). `src/lib/search-types.ts` is the canonical validation contract. Dates are inclusive. Relative date cutoffs use the user's existing Notifications timezone, falling back to UTC.

## Database migration

The additive, transactional Drizzle migration is `drizzle/0000_search_and_filters.sql`, tracked by `drizzle/meta/_journal.json` and the schema snapshot. It:

1. Creates `folio_recent_searches` and `folio_saved_filters`, with owner foreign keys and uniqueness/lookup indexes.
2. Adds GIN search indexes to projects, tasks, and ideas, and compound task/project filtering and project-progress indexes.
3. Does **not** drop/reset tables, rewrite workspace records, or seed search examples.

For an **existing Folio database**, back up as usual, then run from the project root:

```sh
node scripts/migrate-search.mjs
```

The script reads the existing `DATABASE_URL` from `.env`. The app's existing `ensureSchema()` guard also runs the Drizzle migrator after the legacy bootstrap, under its existing advisory lock. The journal makes this idempotent. `next.config.ts` includes migration files in serverless tracing.

This migration assumes Folio's existing base tables. For a **fresh local database only**, first initialize the schema using the project's existing Drizzle setup:

```sh
npx drizzle-kit push
node scripts/migrate-search.mjs
```

Index creation is transactional, not concurrent. For a large production database, schedule a maintenance window for the one-time GIN index builds. Do not edit an already-applied SQL migration; add a new Drizzle migration for future changes. The snapshot includes the legacy tables to prevent a later `drizzle-kit generate` from mistakenly generating them as new tables.

## Environment variables

- **Required:** no new variables. Continue using the existing `DATABASE_URL`.
- **Optional production hardening:** `FOLIO_DEMO_MODE=false` disables the inherited anonymous shared-demo fallback.
- **Tests only:** `TEST_BASE_URL` overrides `http://localhost:3000` when your running app uses another local port. Tests use the same `DATABASE_URL` as the app. Run on a local/test database only.
- Google OAuth, token encryption, and cron/reminder environment configuration are unchanged.

## Exact local testing instructions

Use Node 22 and an existing PostgreSQL-backed Folio database. Do not overwrite your environment configuration.

**Terminal 1 — apply migration and run the app:**

```sh
node scripts/migrate-search.mjs
npm run dev
```

**Terminal 2 — API integration tests:**

```sh
node scripts/test-search.mjs
```

The suite creates two disposable users and exercises real API/database calls: all searchable resource types and fields, literal wildcard handling, each task/project filter, combined criteria, sort directions, null ordering, pagination, saved filters, recent-history limits, ownership checks, expired/invalid sessions, validation errors, and Calendar/Notifications route compatibility. Only those exact test users and their cascading records are removed in `finally`. It never resets or clears an existing user's workspace.

**Browser tests (Playwright is temporary, not an application dependency):**

```sh
npx --yes --package=@playwright/test playwright install --with-deps chromium
npx --yes --package=@playwright/test -c 'node scripts/test-search-browser.mjs'
```

The browser suite creates a separate disposable account using the existing APIs. It tests keyboard navigation, actual project/task/idea destinations, combined filters, saved-filter reload/reapplication/deletion, view consistency, empty/error/retry states, debounce, dark mode, mobile bounds, and browser exceptions. Screenshots are written to `artifacts/`; these are generated test output, not web assets.

**Static/build validation:**

```sh
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run lint
npm run build
```

For manual QA, open the header search, type a label/project name/note fragment, use arrow keys and Enter, then try combining and saving filters on Projects and My tasks. Toggle the existing theme switch and use a narrow viewport. Existing overview, idea editing, project actions, task editing, notifications, and the Calendar page should continue to work.

## Known limits / scope boundaries

- No assignee filter is invented: Folio's existing task schema has no assignee or collaboration model.
- The new search and browse paths are bounded and server-filtered. The older dashboard/workspace hydration remains unchanged to avoid a broader architectural rewrite; it still maintains the existing workspace cache for dashboards, editors, and summaries.
- Views display the loaded pages. Use Load more to include additional matches, particularly when browsing dates in Calendar.
- Search covers Projects, Tasks, and Ideas—not Google events or notifications, which were not requested search sources.
- Live Google OAuth/read/write calls require your existing Google credentials and account. The feature does not alter those integration routes; local tests verify their compatibility, not an actual external Google authorization.

## File inventory

### New files
- `src/components/global-search.tsx`
- `src/components/search-filters.tsx`
- `src/app/search.css`
- `src/lib/search-types.ts`
- `src/lib/search-service.ts`
- `src/lib/search-http.ts`
- `src/lib/search-client.ts`
- `src/lib/use-filtered-collection.ts`
- `src/app/api/search/route.ts`
- `src/app/api/search/entity/route.ts`
- `src/app/api/search/recent/route.ts`
- `src/app/api/filters/route.ts`
- `src/app/api/workspace/browse/route.ts`
- `drizzle/0000_search_and_filters.sql`
- `drizzle/meta/_journal.json`
- `drizzle/meta/0000_snapshot.json`
- `scripts/migrate-search.mjs`
- `scripts/test-search.mjs`
- `scripts/test-search-browser.mjs`
- `SEARCH_AND_FILTERS.md`

### Modified files
- `src/components/workspace.tsx` — mount native search palette and hydrate selections.
- `src/components/projects-view.tsx` — advanced filters, saved filters, server results, pagination.
- `src/components/tasks-view.tsx` — reuse task controls in popover, saved filters, server results, pagination.
- `src/components/task-board.tsx` — optional preservation of server ordering.
- `src/components/task-calendar.tsx` — optional preservation of filtered task ordering.
- `src/lib/use-workspace.ts` — hydrate fresh selected records into existing editors.
- `src/lib/tasks.ts` — This week focus helper.
- `src/lib/auth.ts` — honor existing sessions; preserve configurable demo fallback.
- `src/db/schema.ts` — additive tables and useful indexes.
- `src/db/migrate.ts` — run versioned additive Drizzle migrations after legacy bootstrap.
- `src/app/layout.tsx` — include token-based search stylesheet.
- `next.config.ts` — trace migration files for deployment.
