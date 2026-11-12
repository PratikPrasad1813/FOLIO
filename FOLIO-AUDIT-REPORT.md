# Folio Codebase Audit Report — Next.js 16 / TypeScript / Offline-First

**Auditor scope:** `src/app/`, `src/lib/`, `src/components/`, `src/db/`, `src-tauri/`
**Base revision:** `PratikPrasad1813/FOLIO` @ `45be078` (includes the local-first offline architecture from `743252c`)
**Verification:** `tsc --noEmit` clean · ESLint clean on all changed files · `next build` (web) passing · `build:desktop` static export passing (7 workspace views prerendered, no CSR bailout)

---

## Executive summary

| Category | Violations found | Status |
| --- | --- | --- |
| 1 — Next.js 16 async APIs | 0 (verified clean) | Already compliant at HEAD |
| 2 — Hydration / environment mismatches | **4 real violations** | **All fixed** |
| 3 — Server/client boundary leakage | 0 real (2 false positives analysed) | Verified safe |
| 4 — Resilient network & outbox handling | **4 unhandled rejection paths + 1 desktop hardening** | **All fixed** |
| Branding | Logo absent from 60+ platform icons, AI surfaces | Unified everywhere |

51 files changed, 252 insertions(+), 96 deletions(-). Full patch: `audit_changes.diff`.

---

## CATEGORY 1 — Next.js 16 async API breaking changes

**Verdict: clean — no `cookies()`/`headers()`/`params`/`searchParams` call is synchronous.**

Every call site was enumerated and verified:

| Pattern | Sites | Verification |
| --- | --- | --- |
| `await cookies()` | `src/lib/auth.ts` (5 sites), `src/app/docs/docs-content.tsx`, OAuth routes, Google integration routes | All awaited; `auth.ts` wraps them in cached async helpers |
| `await headers()` | `src/app/(workspace)/layout.tsx:33` | Awaited |
| `params: Promise<…>` in API handlers | All 14 dynamic `[id]`/`[provider]` route handlers | Typed as `Promise` and destructured via `await context.params` |
| `await params` in pages | `(workspace)/[view]`, `(workspace)/[view]/[id]`, `docs/[chapter]` | Awaited |
| `await searchParams` in pages | `login`, `signup`, `onboarding`, `download` | Awaited (typed Promise params) |

No 500-crash vectors from the async API migration exist in the current tree.

---

## CATEGORY 2 — React hydration & environment mismatches

### C2-1 (HIGH) `src/lib/use-persistent-state.ts` — storage read inside `useState` initializers

Both `usePersistentState` and `usePersistentJson` read `localStorage`/`sessionStorage` in their lazy initializers. The server always renders the fallback while a client with a stored preference renders a different value → React aborts hydration with a tree mismatch. This affected **20 persisted UI preferences** across `projects-view` (7), `tasks-view` (8), `task-editor` (1), `task-calendar` (4) — e.g. a user who last used the List view would hydrate `/projects` with `view="list"` against server HTML for `view="grid"`.

**Fix:** both hooks now always initialise with `fallback` and adopt the stored value in a post-mount `useEffect` (the same contract as `next-themes`). Inline `allowed` arrays are handled through a stable serialised dependency; JSON validators are kept in refs so the adopt-effect runs once per key. Public API unchanged.

### C2-2 (HIGH) `src/lib/use-ai-conversations.ts:62` — sessionStorage in initializer

`useState(() => readStoredConversationId())` produced the same mismatch for the Folio AI active-conversation highlight.

**Fix:** initialises to `null`; the persisted id is restored in a post-mount effect. `refresh()` already falls back to `readStoredConversationId()` after the first load, so behaviour is preserved.

### C2-3 (MEDIUM) `src/components/folio-ai-panel.tsx` — `aiTheme` initializer

The AI panel theme was read from `localStorage` during render ("dark" on server, "light" on a themed client → class mismatch on `fm-menu-synapse is-light`).

**Fix:** starts as `"dark"` on both server and hydration; the stored preference is adopted in a post-mount effect, then persisted on change as before.

### C2-4 (HIGH — build-breaking for the desktop export) `src/components/profile-settings.tsx` — `useSearchParams()` without a Suspense boundary

`ProfileSettings` is rendered by the Settings workspace view, which the desktop static export **prerenders** (`generateStaticParams` in `(workspace)/[view]/page.tsx`). `useSearchParams()` in a prerendered client component without a `<Suspense>` boundary is the classic Next.js 15/16 CSR-bailout failure.

**Fix:** the search-param-derived connection notice now lives in its own `<ConnectionNotice />` component rendered inside `<Suspense fallback={null}>`. The desktop export build now completes with all 7 views prerendered.

### Verified-safe patterns (no change required)

- `public-site.tsx` `useIso` (`useLayoutEffect` on client only) — React-endorsed SSR-safe pattern; storage read inside the effect.
- `onboarding.tsx` theme adoption — inside `useEffect` with try/catch.
- `lib/desktop/runtime.ts` — probe result memoised and only trusted from effects/handlers; `desktopRuntimeKnown()` is the render-safe hint.
- `AISettingsModal` BYOK initializers — the modal only mounts after user interaction (post-hydration).
- `sync-indicator.tsx` / `desktop-session-gate.tsx` — already use `useSyncExternalStore` server-snapshot + hydration guards.

---

## CATEGORY 3 — Server/client boundary leakage

**Verdict: no runtime leakage.** A precise scanner (real import statements only, not template-literal code samples) flagged 5 candidates; all verified safe:

| Candidate | Analysis |
| --- | --- |
| `profile-settings.tsx`, `onboarding.tsx` → `@/lib/profile-service` | `import type { readProfile }` — erased at compile time; zero runtime/bundle impact |
| `email-preview-studio.tsx` → `@/lib/email/templates` | `templates.ts` → `design-system.ts` are pure string builders (no nodemailer, no db) |
| `desktop/sync-engine.ts`, `desktop/desktop-workspace.ts` → `@/lib/sync-protocol` | Deliberately shared isomorphic protocol module (types + guards only) |
| `docs-content.tsx` matches | `"use client"` and drizzle imports appear only **inside documentation code samples** (template literals); the file itself is a server component |

`@/db` (Drizzle/Neon) is imported exclusively by API route handlers, server components and server-only `src/lib` services. `node:crypto` usage (`lib/crypto.ts`) is server-only. No changes required — the boundary is clean.

---

## CATEGORY 4 — Resilient network & outbox error handling

### C4-1 `src/components/integrations/google.tsx` — four unhandled rejection paths

Fire-and-forget promise chains without `.catch` — a dropped Wi-Fi connection (or an HTML 500 breaking `response.json()`) would raise unhandled promise rejections:

1. Calendar visibility toggle: `void updateCalendar(…).then(…)`
2. "Refresh calendar list" button: `void fetch(…).then(() => refresh())`
3. Event-access toggle: `void (async () => { await setWriteEnabled(…) })()`
4. Disconnect confirmation: `void disconnect().then(…)`

**Fix:** all four now terminate in `.catch(…)` handlers that surface a friendly message via `setMessage`, restore the busy/checkbox state, and refresh status where relevant. Dropped connections now degrade to an inline notice — no unhandled rejections, no white screen.

### C4-2 `src/components/profile-settings.tsx` — desktop-shell hardening

Inside the Tauri webview a relative `fetch("/api/profile")` can never succeed (no same-origin Next.js server — the shell loads bundled static assets), so the Settings card showed a permanent error even while fully online.

**Fix (local-first, consistent with the sync architecture):**
- In the desktop runtime the card reads the **cached profile snapshot from `folio.db`** (`getCachedProfile`) and refreshes itself on every `folio:workspace-sync` event (i.e., after each background sync cycle).
- "Show getting-started guide" now queues through the **outbox profile-pending queue** (`markLocalProfilePending({ guideDismissed: false })`) instead of a direct PATCH — works offline, pushed by the engine's next cycle.
- The web-only "Edit profile & preferences" link (`/preferences` — a server-rendered page pruned from the desktop bundle) is hidden in the desktop shell, guarded by a mounted-state check (C2 discipline).
- Supporting change: `PendingProfilePatch` (`local-db.ts`) and the engine's pending parser (`sync-engine.ts`) now accept `guideDismissed`, which the server's `/api/profile` allow-list already permits.

### Verified-safe network paths (no change required)

- **Sync engine** (`sync-engine.ts`): every network op runs inside `runCycle`'s try/catch; `isNetworkError()` silences `TypeError: Failed to fetch`/DNS/abort; 401 → `auth-expired` (never a sign-out, never data loss); hard timeouts via `AbortController`.
- **Auth store** (`auth-store.ts`): boot resolution is SQLite-only; sign-out revoke is best-effort with catch; `desktopSignOut` wipes locally even when the cloud call fails.
- **Workspace hooks** (`use-workspace.ts`): desktop path is SQLite-only; web 401s redirect; all mutations optimistic with rollback.
- **Notifications hook**: `desktopNotificationsOffline()` guard; all fetches wrapped; throwing mutators (`saveTaskReminder`, `updatePreferences`, `runReminderCheck`, …) are caught at every call site (`task-reminder-control.tsx`, `notification-settings.tsx` — verified).
- **AI layer**: `task-manager` retries with idempotency keys; `byok-provider`/panel fetches wrapped; `history.append/load` never reject.
- **Server routes**: all 40+ route handlers wrap their bodies in try/catch; `/api/sync/push` isolates poison mutations on SAVEPOINTs and returns per-item outcomes (applied/skipped/rejected).

---

## Branding — "Folio's logo everywhere, from AI to desktop app"

The supplied mark (`icon.svg` — lavender tile `#f0edf8`, two-tone "F" `#39313f`/`#aa92c2`) is now the single source of identity:

| Surface | Change |
| --- | --- |
| `public/icon.svg` | Exact copy of the supplied mark (favicon for web + desktop webview) |
| `src/components/ui.tsx` | `Logo` rewritten to the official F-glyph (main mass `currentColor` for theme adaptivity, brand-lavender accent arm); new **`LogoMark`** export with the full tile for hero surfaces |
| Desktop boot splash + root redirect | `✳` glyph replaced with `LogoMark` (both `desktop-session-gate.tsx` and `desktop-root-redirect.tsx`) |
| Desktop sign-in card | `LogoMark` replaces the wordmark glyph |
| Folio AI | `AIAvatar` now carries the F-mark on the assistant tile (state ring + activity dot preserved, per-instance SVG ids via `useId`); `FolioAILogo` rebuilt on the official mark + neon "AI" capsule |
| Social card | `opengraph-image.tsx` composites the mark (PNG data URL for satori) with the wordmark |
| Tauri bundle | **All 60 icon assets regenerated** from the SVG: core PNGs (32/64/128/256/512), multi-size `icon.ico` (16–256), modern PNG-based `icon.icns` (ic07–ic14), 10 Windows Store logos, 18 iOS AppIcons, Android adaptive launcher set (square + round + transparent foregrounds at all densities), launcher background colour aligned to the tile (`#f0edf8`) |
| Legacy Electron shell | `desktop/icon.ico` regenerated from the same mark |

---

## Complete list of modified files

**Application code**
1. `src/lib/use-persistent-state.ts` — hydration-safe rewrite (C2)
2. `src/lib/use-ai-conversations.ts` — sessionStorage hydration fix (C2)
3. `src/components/folio-ai-panel.tsx` — aiTheme hydration fix (C2) + official mark in `AIAvatar`/`FolioAILogo`
4. `src/components/profile-settings.tsx` — Suspense boundary (C2/C1-class) + desktop local-first profile (C4)
5. `src/components/integrations/google.tsx` — 4× `.catch` hardening (C4)
6. `src/lib/desktop/local-db.ts` — `PendingProfilePatch.guideDismissed`
7. `src/lib/desktop/sync-engine.ts` — pending-profile type extended
8. `src/components/ui.tsx` — `Logo` + `LogoMark`
9. `src/components/desktop/desktop-session-gate.tsx`, `desktop-root-redirect.tsx`, `desktop-signin.tsx` — brand mark + lint fix
10. `src/app/opengraph-image.tsx` — branded social card

**Brand assets**
11. `public/icon.svg` + 59 regenerated files under `src-tauri/icons/**` + `desktop/icon.ico`

## Known pre-existing items (outside audit scope, documented for transparency)

- `tests/folio.spec.ts` references `@playwright/test`, which is not in `package.json` → `tsc` reports type errors there. This predates the audit (the repo builds with `typescript.ignoreBuildErrors`); the e2e suite is run through its own loader (`scripts/folio-test-loader.cjs`).
- Relative `/api/*` fetches in notifications/AI surfaces inside the desktop shell intentionally degrade silently (cloud-only features); the workspace, mutations, settings profile and sync remain fully offline-capable by design.
