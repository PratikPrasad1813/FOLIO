# LOCAL-FIRST PRODUCTION AUDIT — DYNAMIC_SERVER_USAGE FIX & CODEBASE HARDENING

Scope: `src/app/`, `src/lib/`, `src/components/`, `src/db/`, `src-tauri/`, `scripts/`.
Verification: `npx tsc --noEmit` clean for `src/` · `npm run build` (cloud, Next 16.4.5) exits 0 with **zero warnings** · `npm run build:desktop` (static export) exits 0, all 7 workspace views prerendered, working tree fully restored.

---

## 1. THE LOGIN CRASH — `DYNAMIC_SERVER_USAGE` (root cause, fixed)

**Symptom.** In the production build, clicking Google / GitHub sign-in crashed the server render:
`⨯ Error: An error occurred in the Server Components render … digest: 'DYNAMIC_SERVER_USAGE'`.

**Root cause.** `src/lib/auth.ts` wrapped the dynamic-API call chain in `try…catch`
(`currentUserSafe()` caught around `currentUser()`, which awaits `cookies()` /
`headers()`). Next.js signals its switch to dynamic rendering by throwing an
internal bail-out exception from `cookies()`/`headers()`; intercepting that
exception aborts the switch and surfaces the 500 with digest
`DYNAMIC_SERVER_USAGE`.

**Fix (PART 3.1 mandates applied):**

- `cookies()` / `headers()` are now called **strictly outside any try…catch**
  in `currentUser`, `currentUserSafe` and `sessionTokenHash`. Only the
  *database* work is guarded (classified into `DatabaseUnavailableError`), so
  the dynamic bail-out always propagates to Next.js.
- `getUser()` now **redirects to `/login`** when the session is null
  (Server Components / pages). The old throwing behaviour moved to the new
  `requireUser()`, used exclusively by `/api/*` handlers that translate it
  into a JSON 401.
- **Dual-auth resolution** (desktop-first): `Authorization: Bearer <token>`
  header first, falling back to the `folio_session` cookie. The parser
  (`bearerToken()`) is shared with the sync endpoints so both transports
  validate tokens identically.
- All 26 API-route files plus `lib/folio-ai/http.ts` and `lib/search-http.ts`
  were switched from `getUser()` to `requireUser()` (28 files patched).
- The OAuth start/callback routes and the login/signup/onboarding pages keep
  `export const dynamic = "force-dynamic"` (verified across every `route.ts`).

## 2. STATIC EXPORT HARDENING — `scripts/build-desktop.mjs`

- `execSync("npm run build", { shell: true })` replaces the previous spawn —
  immune to the Windows `spawnSync EINVAL` npm-shim failure (PART 3.10).
- **New dynamic-route sweep**: after the explicit stash, the script scans every
  remaining `page/layout/route/template` file and stashes any that declares
  `export const dynamic | revalidate | fetchCache | dynamicParams`. A future
  regression on a web route can therefore never reproduce the
  *"Page with dynamic = \"force-dynamic\" couldn't be exported"* crash.
  Stash/restore is atomic (`finally`), and the manifest line reports
  `N web routes + M dynamic routes stashed & restored`.

## 3. RESILIENT NETWORKING (CATEGORY 4)

- `src/lib/search-client.ts` — `searchRequest` now: treats `fetch` rejections
  as a friendly offline message (re-throws genuine `AbortError`), never leaks
  `SyntaxError` from a 502 HTML body, and carries the server's own error
  message on HTTP failures. ~30 call sites inherit the hardening with no
  signature change.
- `src/lib/use-workspace.ts` — all six raw `await response.json()` calls
  (workspace load/reload/mutate/bulk/convert + profile save) now go through a
  defensive `readJson()` reader: a proxy's HTML error page degrades to a calm
  message instead of an unhandled SyntaxError, and optimistic rollback
  behaviour is unchanged.

## 4. TAURI SHELL (PART 3.2 / 3.3)

- `src-tauri/capabilities/default.json` — added the mandated
  `single-instance:default` alongside `core:default`, `core:event:default`,
  `opener:default`, `deep-link:default`, `sql:default`, `sql:allow-load`,
  `sql:allow-select`, `sql:allow-execute` (the SQLite capability set that
  previously threw `sql.execute not allowed`).
- `src-tauri/tauri.conf.json` — verified compliant: title
  "Folio - Management Studio", 1280×820, resizable, `"decorations": true`,
  **no** `hiddenTitle`/`titleBarStyle`, window `"url": "index.html"`,
  `"frontendDist": "../out"`, `deep-link` plugin with the `folio` scheme.

## 5. VERIFIED-COMPLIANT (no changes required)

- **Local SQLite mirror** (`src/lib/desktop/local-db.ts`): `sqlite:folio.db`;
  `local_projects/tasks/milestones/subtasks/ideas`, `sync_queue`,
  `sync_metadata`, `local_auth`; active-row reads filter
  `(deleted_at IS NULL OR deleted_at = '')`; timestamps are normalised so the
  strings `"null"`/`"undefined"` can never be stored (root cause #6).
- **Sync engine** (`src/lib/desktop/sync-engine.ts`): 60 s interval + `online`
  event + visibility trigger; single-flight cycle; PUSH drains the outbox in
  200-batches (applied/skipped/rejected all terminal → queue row deleted);
  PULL applies deltas with LWW (`remote.updated_at >= local.updated_at`,
  tombstones remove rows) and advances `last_pulled_at` to `server_time`;
  every network call is try…caught, failures park the engine silently on
  `offline`; a 401 surfaces `auth-expired` without ever wiping local data.
- **Sync API** (`/api/sync/push`, `/api/sync/pull`): dual auth (Bearer or
  cookie + same-origin), one Neon transaction per push batch with per-mutation
  SAVEPOINTs, LWW via `setWhere (user_id = … AND updated_at <= excluded…)`,
  soft-delete tombstones, pull includes soft-deleted rows and `server_time`
  captured before the queries.
- **Hydration discipline** (CATEGORY 2): `SyncIndicator` uses the
  `useSyncExternalStore` mounted guard (identical idle placeholder on server +
  hydration render); the desktop session gate boots from the `local_auth`
  SQLite row with zero network calls (root cause #7); all `typeof window` /
  `navigator` / `localStorage` probes across `src/components` and `src/lib`
  run only inside effects, handlers or external-store snapshots.
- **Server/client boundary** (CATEGORY 3): no `"use client"` file imports
  `@/db`, Drizzle, `pg` or Node built-ins (the only grep hit is a docs code
  sample string, not an import). Desktop clients talk to SQLite via
  `@tauri-apps/plugin-sql` and to the cloud via `/api/sync/*` with Bearer.
- **UI mandates** (PART 3.8 / 3.9): no duplicate HTML `<TitleBar />`; no legacy
  raw-text onboarding block — the styled greeting dashboard and the
  First-Login Guide cards (`WorkspaceConcierge`) render by default;
  `projects-view.tsx` defaults its status tab to `"all"` and lists rows where
  `deleted_at IS NULL`.
- **`ensureSchema()`** is idempotent and non-blocking (memoised promise;
  cold starts perform a read-only journal check and skip all DDL when
  current); **Folio logo** is used everywhere — `Logo` mark in the workspace
  sidebar, auth screen, desktop sign-in, docs, downloads, AI surface
  (`FolioAILogo`), `/icon.svg` favicon, and the full Tauri icon set.

## 6. NEXT.JS 16 ASYNC APIs (CATEGORY 1)

Audited `params` / `searchParams` / `cookies()` / `headers()` across
`src/app`: every usage is awaited (`const { id } = await params;`,
`await searchParams`, `await cookies()`, `await headers()`); every route
handler that touches request state carries `export const dynamic =
"force-dynamic"`. The audit found no remaining violations.

## 7. BUILD CONFIG

`next.config.ts` dropped two experimental keys that Next.js 16.4.5 no longer
recognises (`turbopackFileSystemCacheForDev`, `turbopackServerFastRefresh`) —
they produced config warnings on every build. The cloud build now completes
with zero warnings; the desktop/export split (`NEXT_PUBLIC_DESKTOP_BUILD=1` →
`output: "export"` + `images.unoptimized`) is unchanged.

## 8. COMMANDS

```bash
npm install
npm run build            # cloud (Render + Neon) — zero warnings, exit 0
npm run build:desktop    # static export → out/ — exit 0, 7 views prerendered
npm run tauri build      # desktop bundles (requires Rust toolchain + WebKit deps)
```

Note: `npx tsc --noEmit` reports pre-existing errors in `tests/folio.spec.ts`
only; that spec needs the optional `@playwright/test` dev dependency
(`npm i -D @playwright/test`) and is unrelated to this audit.
