# Refresh Folio's product screenshots

The on-demand Playwright command starts a private loopback Next.js server, creates a unique fictional user and real Folio session in a **dedicated local PostgreSQL database**, captures the actual application, verifies scoped cleanup, and publishes ten optimized 1440 × 1000 PNGs to `public/screenshots/`. It does not run during normal builds or startup. Existing captures remain usable if a run fails.

## One-time setup

1. Install dependencies: `npm install`.
2. Install a browser: `npx playwright install chromium`. On Linux, if system libraries are missing, run `npx playwright install-deps chromium` with appropriate administrator privileges.
3. Create a separate local PostgreSQL database called `folio_screenshots` (or `folio_screenshots_<suffix>`). For example: `createdb folio_screenshots`. Give the local user permission to create Folio's tables. **Never point this at your production database**. Remote Neon databases and loopback tunnels whose PostgreSQL server reports a remote address are deliberately refused, even if they are test branches.
4. Set `FOLIO_SCREENSHOT_MODE=local` and `SCREENSHOT_DATABASE_URL` to that database. `DATABASE_URL`, if set, must point to a different database name. Neither variable belongs in Netlify or production configuration. Do not set `NODE_ENV=production` for this command.

## Run or refresh

```sh
FOLIO_SCREENSHOT_MODE=local \
SCREENSHOT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/folio_screenshots' \
npm run screenshots
```

Alternatively put those variables in `.env.local` for development and run `npm run screenshots`. The runner chooses a free local port, starts an isolated server itself, uses a fresh in-memory Playwright profile, and does not accept an external server URL. It checks the database name and server address before any writes. The isolated server uses placeholder OAuth settings and cannot use your real Google or SMTP credentials. A software WebGPU adapter allows the genuine AI interface to render without downloading a model.

It seeds the existing Folio demo workspace with projects, priorities, statuses, deadlines, ideas and activity, plus fictional notifications, a fictional calendar mirror, and a sample AI conversation. No real accounts, calendar credentials, AI API keys, or live provider calls are used. Authentication is a normal opaque Folio session inserted for the temporary user; there is no public test-login route or authorization bypass.

The command writes `dashboard.png`, `projects.png`, `project-details.png`, `tasks-board.png`, `tasks-list.png`, `tasks-calendar.png`, `ideas.png`, `calendar.png`, `analytics.png`, and `folio-ai.png`. Screens are staged temporarily and only published after all captures and cleanup succeed. The landing page uses exactly these filenames and falls back gracefully if one is unavailable.

## Cleanup and safety

In `finally`, the browser and isolated server are closed. Deletion requires the exact newly generated user UUID, its unique `screenshots+...@example.invalid` email, and demo provider. Foreign-key cascades remove only that user's sessions, projects, tasks, ideas, calendar mirrors, notifications, preferences, and AI history. The runner checks that representative owned records are gone and logs success or failure; it never truncates tables or deletes other users. It also removes temporary image files. A forced failure can be tested safely with `FOLIO_SCREENSHOT_FAIL_AFTER_SEED=1` in the same dedicated local environment; the command should exit nonzero and log cleanup success.

## Troubleshooting

* **Safety check failed:** use the exact local mode and dedicated loopback database name; check that `DATABASE_URL` is different and production environment flags are unset. Remote/test Neon is intentionally not accepted.
* **Connection refused / permissions:** start local PostgreSQL, create the dedicated database, and check its URL and permissions. The tool applies the additive Folio schema there.
* **Browser launch or missing library:** rerun `npx playwright install chromium` and, on Linux, `npx playwright install-deps chromium`.
* **AI compatibility timeout:** ensure the Chromium build supports SwiftShader WebGPU; the runner fails rather than publishing an error screen.
* **Selector or loading timeout:** the real UI may have changed; inspect the route and update the corresponding readiness selector in `scripts/screenshots.mjs`. The staged images are not published on failure.
* **Cleanup failed:** note the printed unique demo UUID. In the dedicated local database only, investigate that exact ID and its cascading foreign keys. Never run a broad delete or truncate. Do not point cleanup at production.

To exercise local authentication and image loading, use the same local environment with `node scripts/test-auth-local.mjs`. Live Google/GitHub sign-in and SMTP delivery require separate staging credentials and a real mailbox.
