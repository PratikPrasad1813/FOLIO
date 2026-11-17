# Changelog

Folio versions follow `V<major>.<minor>`: every release bumps the minor number (V1.1 → V1.2 → V1.3 …) and a major release moves to the next whole number (V2).
The version lives in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json` and `src/lib/desktop-downloads.ts` (installer file names).

## V1.4 — 2026-11-17

### Fixed
- **Desktop "My tasks" showed "You appear to be offline" and 0 tasks.** The Tasks page asked the website for its list instead of reading the copy stored on your computer. It now reads the local copy like Projects and Ideas do, so tasks appear instantly and work without internet.
- **Desktop Folio AI said it was offline and could not check an API key that works on the web.** The Folio AI services refused requests coming from the desktop app and never told Windows it was allowed to talk to them (the key check also sends custom key headers that needed approval). The AI routes (chat, conversations, tasks, usage, preferences, key check) and the workspace route now accept the desktop sign-in and answer with the right permission headers. AI actions started from the desktop (for example "create a project") also keep the desktop sign-in.
- **No scrolling in the Folio AI panel.** The panel was taller than the window with nothing allowed to scroll, so the bottom was cut off. The chats list, the conversation, and the side cards now scroll inside their own boxes; on small windows the whole screen scrolls.

### Changed
- **Folio AI now uses the real Folio logo** in the header, the chats sidebar and next to every assistant message (the old purple "AI" badge and robot face are gone).
- Routes that answer the desktop app now never fail silently: if one of them crashes, the app receives a plain-English message instead of a misleading "offline" notice.

## V1.3 — 2026-11-15

### Fixed
- **Release pipeline test failure** (`workspace-sync.test.ts`, "soft-deleted entities are hidden…"): the in-memory demo/test database now understands sub-queries (`groupBy`, `as`, and sub-query joins), which the Projects list uses. Real PostgreSQL was never affected.
- **Expired or missing sign-in returned a generic server error.** `/api/workspace` and the notification routes now answer HTTP 401 with "Your session has expired. Please sign in again." so the app can send you to the sign-in page, instead of 500 "couldn't be loaded".

## V1.2 — 2026-11-15

### Fixed
- **Projects page showed 0 projects / "We couldn't complete that request."** The database layer wrapped every query in a way that broke Drizzle sub-queries, so `/api/workspace/browse` crashed for projects and tasks. Fixed.
- **Desktop app "hanging" when the same account is open on web and desktop.** Two causes: (1) a single failed database connection permanently switched the server to an in-memory fallback, so sessions and data vanished until a restart; the server now retries, reconnects on its own and never swaps your data for a fake store. (2) The sync engine could wait forever on a stalled request, replaced the whole desktop workspace when a sign-in expired, and did not restart after signing in again. It now has timeouts, back-off retries, keeps your local data and asks you to sign in again with a small banner.
- **Sync push no longer loses changes silently.** Each change is applied in its own savepoint, so one bad change cannot roll back the rest.
- **Windows uninstall: "Folio is currently running… unable to kill Folio".** The program was installed as `app.exe` while the installer tried to close `Folio.exe`. It is now `folio.exe`, and the installer closes Folio in several independent ways (window close, process search by install folder including WebView2 helpers, `taskkill`) so it works with McAfee and other antivirus products. If Folio still cannot be closed, a plain-English dialog explains how to close it by hand and offers Retry.

### Changed
- **Folio AI now uses the same theme as the rest of Folio** in both light and dark. The separate "Synapse" palette and photo background were removed; the AI page follows the app-wide theme and its theme button switches the whole app.
- **Plain-English errors everywhere.** The "A little pause" screen is replaced by a clear message that says what happened, that your work is safe, and exactly what to try (with technical details tucked away for support). A broken view no longer takes down the whole app. API errors (database down, timeouts, expired sign-in, blocked requests) use simple sentences.
- Cargo package renamed `app` → `folio`; package metadata (description, author, license, repository) filled in.
- `tsconfig.json` no longer type-checks the unused `tests/` folder, so `npm run typecheck` is clean.

### Removed
- Unused `public/synapse-dusk.jpg`.
