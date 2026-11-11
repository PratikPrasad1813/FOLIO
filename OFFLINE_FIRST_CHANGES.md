# Folio — 100% Offline-Functional Desktop (Local-First Shell)

This delivery makes the Tauri desktop app fully functional with Wi-Fi off.
The four root causes of the offline crashes are eliminated at the
architecture level, not patched over:

| # | Root cause | Fix |
|---|------------|-----|
| 1 | Cloud-first data fetching: `useWorkspace` awaited `fetch("/api/workspace")`; offline it threw `TypeError: Failed to fetch` and unmounted the workspace | `use-workspace.ts` renders from the local SQLite mirror (`folio.db`) in the desktop shell — 0ms, airplane-mode safe. CRUD writes to SQLite + the `sync_queue` outbox and updates React state optimistically; no HTTP on the user path, ever |
| 2 | Session validation over the network: boot pinged `/api/auth/session`, failed offline, redirected to `/login` | The desktop session (profile + 90-day Bearer token) lives in the `local_auth` SQLite table. Boot reads SQLite ONLY — no network call, no redirect. `/login` never happens offline; only an explicit "Sign out" clears the session |
| 3 | Window target: `tauri.conf.json` loaded the REMOTE site (`https://…onrender.com/overview`) — offline the shell couldn't even boot | `tauri.conf.json` now bundles the static export: `"url": "index.html"`, `"frontendDist": "../out"`, no remote URLs. `npm run build:desktop` produces `out/` |
| 4 | (Carried over) the four failures of the previous sync-engine attempt — `sql.execute not allowed`, deleted_at type poisoning, hydration mismatch, unstyled fallback | SQL capabilities granted; `deleted_at` is always SQL NULL-or-ISO (`normaliseTimestamp`); every Tauri probe is post-hydration; the styled empty-state dashboard renders for new accounts |

---

## 1. Local-first workspace data layer

**Files:** `src/lib/use-workspace.ts`, `src/lib/desktop/desktop-workspace.ts`,
`src/lib/desktop/local-db.ts`, `src/lib/desktop/local-browse.ts`,
`src/lib/use-filtered-collection.ts`

- On launch the desktop shell queries local SQLite immediately
  (`loadDesktopWorkspace()`) and returns active rows
  (`deleted_at IS NULL OR deleted_at = ''`) from `local_projects`,
  `local_tasks`, `local_milestones`, `local_subtasks`, `local_ideas`.
  The workspace paints with zero loading spinners, offline included.
- Local CRUD (`desktopMutate` / `desktopBulkTasks` / `desktopConvertIdea`):
  write the row to SQLite, append the mutation to the durable `sync_queue`
  outbox, update React state optimistically. Never blocks on HTTP.
- `local-browse.ts` is the offline twin of `/api/workspace/browse` — the
  Projects/Tasks views filter the local mirror with identical semantics, so
  counts and lists can never disagree offline.
- Settings changes work offline too: the profile snapshot updates locally
  and a `profile_dirty` marker is queued; the sync engine PATCHes the cloud
  profile on its next successful cycle.

## 2. Offline-resilient desktop session

**Files:** `src/lib/desktop/auth-store.ts`, `src/lib/desktop/local-db.ts`
(`local_auth` table), `src/components/desktop/desktop-session-gate.tsx`,
`src/components/desktop/desktop-signin.tsx`

- `local_auth` (single-row SQLite table) stores the user profile and the
  Bearer token. SQLite was chosen over localStorage: atomic with the mirror,
  survives browser-storage clears.
- Boot: `resolveDesktopBootSession()` reads that row and NOTHING else. A
  cached session ⇒ authenticated, `/overview` renders instantly. There is
  no `/api/auth/session` call on the desktop boot path at all.
- Sign-in transports (first time / after sign-out / token expiry while
  ONLINE): email + password via `POST /api/auth/desktop/login` (CORS,
  rate-limited), or "Continue in your browser" → `<api>/login?next=/desktop-auth`
  → one-time handoff code → `folio://auth?code=…` deep link →
  `/api/auth/desktop/exchange`.
- A 401 from the background engine never wipes data or redirects: the
  status becomes `auth-expired`, the top bar shows "Sign in again", and
  every offline capability keeps working.
- Sign out (explicit only): revoke token (best-effort), clear `local_auth`,
  wipe the mirror + outbox, stop the engine.

## 3. Silent background sync worker

**File:** `src/lib/desktop/sync-engine.ts`

- Triggers: launch, 60-second interval, `window.online`, and tab
  re-visibility. Single-flight (never overlaps).
- Cycle: offline check → PUSH outbox (batches of 200, Bearer) → push pending
  profile → PULL deltas (`?since=last_pulled_at`) applying
  Last-Write-Wins + tombstones → advance cursor to `server_time`.
- ALL network ops are wrapped: `TypeError: Failed to fetch` / DNS / timeout
  (`isNetworkError`) is caught silently — status flips to `offline` (gray
  dot), the outbox stays durable, no unhandled rejections, no error modals,
  no console spam. `online` → `syncing` (yellow pulse) → `synced` (green).
- All engine URLs are ABSOLUTE (`src/lib/desktop/api-base.ts`) — default
  `https://folio-management-studio.onrender.com`, overridable via
  `localStorage["folio.desktop.apiBase"]` or `NEXT_PUBLIC_FOLIO_API_URL`.

## 4. Packaging & window target

**Files:** `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`,
`src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `next.config.ts`,
`scripts/build-desktop.mjs`, `package.json`

- `tauri.conf.json`: `"url": "index.html"`, `"frontendDist": "../out"`,
  `beforeBuildCommand: "npm run build:desktop"`, `devUrl: localhost:3000`
  for `tauri dev`. No remote URL is loaded in production.
- `capabilities/default.json`: `sql:default` + `sql:allow-load/select/execute`
  for the local webview origin (no `remote.urls` grants — the frontend is
  local now).
- `tauri-plugin-sql` (sqlite) registered in Rust and `@tauri-apps/plugin-sql`
  in package.json.
- `npm run build:desktop` (scripts/build-desktop.mjs): stashes web-only
  routes (all `api/`, server-rendered auth pages, docs, the dynamic
  `/projects/[id]` route), runs `next build` with
  `NEXT_PUBLIC_DESKTOP_BUILD=1` + `output: "export"`, and restores the tree
  (crash-safe). Output: `out/` with `index.html` + all seven workspace
  views prerendered.
- Desktop project detail uses client state (`desktopProjectId`) because
  dynamic UUID routes cannot exist in a static export; the web keeps the
  real `/projects/<id>` URL.

## Cloud-side endpoints (deploy with the web app)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth/desktop/login` | cross-origin email+password → profile + 90-day Bearer (CORS for Tauri origins, same rate limits as web login) |
| `POST /api/auth/desktop/handoff` | web-session → one-time 5-minute pairing code |
| `POST /api/auth/desktop/exchange` | consume code → profile + 90-day Bearer (CORS) |
| `POST/DELETE /api/auth/desktop/token` | mint from web session / revoke Bearer |
| `POST /api/sync/push` | one transaction, per-mutation savepoints, LWW upserts, soft deletes (CORS + OPTIONS) |
| `GET /api/sync/pull` | delta incl. tombstones + profile + activity feed + `server_time` (CORS) |
| `GET/PATCH /api/profile` | dual auth (cookie OR Bearer) so the engine can push offline settings changes |

`drizzle/0013_sync_soft_delete.sql` (idempotent, backfilling) adds
`updated_at`/`deleted_at` to milestones, subtasks and ideas and `deleted_at`
to projects/tasks, plus sync indexes. Run `npm run db:migrate` (or apply the
SQL) when deploying.

## Build & verify

```bash
npm install
npm run typecheck            # clean (tests/folio.spec.ts errors pre-exist: @playwright/test is not a repo dependency)
npm run test:desktop-sync    # local-db + offline browse semantics: ALL PASS
npm run build                # web build: OK (workspace stays server-dynamic)
npm run build:desktop        # static export → out/ with index.html + 7 views: OK
npm run tauri dev            # dev shell against localhost:3000
npm run tauri build          # production bundle from out/
```

## Behaviour matrix

| Scenario | Result |
|----------|--------|
| Wi-Fi off, launch app | Boot splash → workspace from SQLite, sync dot gray "Offline" |
| Wi-Fi off, create/edit/delete | Instant local write + outbox queue, toast, zero network |
| Wi-Fi returns | `online` → engine pushes queue, pulls deltas, dot turns green |
| Token expires (online) | Dot "Sign in again", workspace keeps working; re-auth without data loss |
| Fresh install, offline | Styled desktop sign-in screen with an "offline" note (first sign-in needs internet once) |
| Sign out | Session + local mirror cleared; sign-in screen (never a `/login` redirect) |
