# Folio Phase 3 — Public website, authentication and personalized onboarding

> Historical implementation notes: the local-AI descriptions below refer to an earlier provider and have been superseded. Folio AI is now bring-your-own-key; current setup and usage limits live in the [README's Bring Your Own Key AI section](README.md#bring-your-own-key-ai) and the app's `/docs` route.

## What is implemented

The existing Next.js App Router, Drizzle ORM, `pg` connection pool, PostgreSQL records, Netlify-compatible build, Google Calendar integration, notifications, search and AI modules are preserved. This phase replaces anonymous shared-demo access with authenticated workspace access. The shared demo record is **not deleted**; it is no longer an automatic anonymous identity.

### Public experience

- Editorial, responsive landing page at `/` with locally served DM Sans and Instrument Serif, warm neutral/violet tokens, light/dark surfaces and reduced-motion support.
- Responsive navigation: Product, Features, Folio AI, How it works, FAQ, sign in, get started and theme toggle.
- Hero with a genuine Folio overview screenshot, eight-view interactive product showcase, project/task feature panels, idea/calendar/search storytelling, honest local-AI section, three-step introduction, privacy section, expandable FAQ, closing CTA and functional footer links.
- Premium `/login` and `/signup` pages. Google/GitHub are the primary choices; the existing email/password flow remains available without adding passwords to OAuth.
- `/privacy`, `/terms`, metadata, dynamic Open Graph image, sitemap and robots rules. There are no invented endorsements, customer logos, user counts, security certifications, contact addresses or paid plans.

## Real screenshot capture

`public/showcase/light/` and `public/showcase/dark/` each contain:

| Asset | Actual source route/state |
| --- | --- |
| `dashboard.webp` | `/overview` |
| `projects.webp` | `/projects`, grid |
| `tasks.webp` | `/tasks`, Board |
| `task-list.webp` | `/tasks`, List |
| `calendar.webp` | `/calendar`, cropped to the existing `.tk-cal` calendar element |
| `ideas.webp` | `/ideas` |
| `insights.webp` | `/tasks`, existing Insights expanded and List visible |
| `ai.webp` | `/ai`, actual assistant welcome/device/usage UI, without simulating generated answers |

There is no standalone Analytics route in this branch. “Insights” is the real task analytics panel, not a fabricated dashboard.

`public/showcase/manifest.json` records each source route, crop, view, dimensions and capture time. Images are optimized WebP at 1440×960, approximately 53–84 KB each. The capture account is named **Folio Studio**, has a random non-personal test address, and is populated only with Folio's existing synthetic example fixtures. No existing user's data, email, tokens or provider credentials are captured. The temporary account is deleted in `finally`, cascading only its own fixture rows.

Capture workflow (local/test database only):

1. Start Folio against an isolated local/test database using the existing `DATABASE_URL`.
2. Run `npx --yes --package=@playwright/test playwright install --with-deps chromium`.
3. Run `npx --yes --package=@playwright/test -c 'node scripts/capture-showcase.mjs'`.
4. Restart the Next.js production server or rebuild so newly created public assets are indexed.

The workflow creates its own account/session, explicitly sets both the stored account theme and browser preference, waits for the actual app/data/fonts, uses reduced motion, captures the running UI and verifies its theme and image dimensions. It never opens an existing account. Dates are relative to the capture date; example project/task content is stable.

### Screenshot/theme synchronization

`ProductImage` renders two separate, genuinely captured images. Theme-scoped CSS displays only the matching set **before React hydration**. Width/height reserve layout space; there is no brightness filter or layout shift. The hero is eager; lower images are lazy. Loading an image warms its counterpart for a smooth later theme change. Product preview tabs switch screenshots only and are explicitly labeled as previews, not live workspace controls.

## Authentication architecture

The existing opaque `folio_session` cookie format, SHA-256 token-hash database records and email password-hash format are preserved.

- `getUser()` now requires a real valid server session. Anonymous shared-demo fallback is removed regardless of the legacy demo flag.
- Sessions last 30 days. The authenticated session endpoint renews active sessions with fewer than 7 days remaining. The workspace checks on visibility and periodically. Login rotates the session; logout deletes the server record and cookie.
- Cookies are HTTP-only, SameSite=Lax, host-scoped, Path=/, and Secure for HTTPS/non-local deployments. Localhost HTTP is supported for development.
- A PostgreSQL-backed 25-attempt/15-minute rate limit protects sign-in and OAuth initiation across serverless instances. Stored request identifiers are hashed; expired entries are cleaned up.
- Next 16 `src/proxy.ts` validates private API and workspace navigation requests, returns consistent unauthorized API responses, and redirects unauthenticated page requests to `/login?next=…`.
- The workspace server layout revalidates sessions and onboarding state. Client navigation cannot bypass the server guard. Each underlying API continues enforcing its own user-level ownership.
- Only allow-listed workspace destinations are accepted as `next`; external URLs, protocol-relative redirects and malformed paths are rejected.
- Login/signup redirect authenticated users to onboarding if needed, otherwise to their safe intended destination. Completed users do not repeat onboarding.
- Public landing/legal pages are indexable. Workspace, profile editing, onboarding, authentication pages and API/callback responses are noindex.

### OAuth and account linking

Google and GitHub use authorization-code flow with **S256 PKCE**, a random state token, and a separate HTTP-only browser-binding cookie. A short-lived server-side `folio_auth_flows` row stores the hashed state/binding, encrypted verifier, provider, intended destination, expiry and optional linking session.

The callback atomically consumes the matching, unexpired flow before contacting the provider, preventing replay across serverless instances. Errors do not expose tokens or internal provider responses.

- Google identity is read from the authenticated TLS UserInfo endpoint, requiring `sub`, email, and **`email_verified === true`**. The app does not trust a client-decoded ID token.
- GitHub identity uses stable numeric `id`; email is always obtained from `/user/emails` with **primary and verified** flags. The public profile email is not treated as proof.
- `folio_auth_identities` stores provider + stable subject, unique per identity, and user + provider, unique per account. No sign-in access/refresh tokens are stored or returned to the browser.
- Different providers are **never automatically merged on email**. An existing account must be signed in, then connect the other provider from Settings. The callback verifies the original account and session plus the new provider identity. Identities already owned by another account cannot be attached.
- Legacy accounts with no identity row can be claimed only by their **original provider** using that provider's verified matching email. Their ID and workspace records are preserved; subsequent logins use the stable provider subject.
- Existing Google Calendar OAuth remains separate, including its read/write scopes, encryption and callback. Google login alone does not connect Calendar.

## OAuth-console configuration still required

Live credentials are not configured in the sandbox. No real provider login/consent or production Neon connection is claimed to have been tested.

### Google Cloud Console

Create/configure a **Web application** OAuth client. Set the consent screen/audience and add these exact authorized redirect URIs:

- Local sign-in: `http://localhost:3000/api/auth/oauth/google/callback`
- Production sign-in: `https://YOUR-FOLIO-DOMAIN/api/auth/oauth/google/callback`
- Keep the existing Calendar callback: `https://YOUR-FOLIO-DOMAIN/api/integrations/google/callback` (and its local equivalent if used).

Sign-in scopes: `openid email profile`. Calendar scopes remain the existing separate read and optional event-write grants. Configure the Calendar API and consent verification/test users as required by Google. Use exact callbacks, not wildcards.

### GitHub Developer Settings

Create an OAuth App (or separate development/production apps) with the site URL and exact callback:

- Local: `http://localhost:3000/api/auth/oauth/github/callback`
- Production: `https://YOUR-FOLIO-DOMAIN/api/auth/oauth/github/callback`

Scopes: `read:user user:email`; PKCE uses S256. Do not enable broad callback wildcard matching. The user must have a verified primary email address.

### Environment variable names

Retain existing values; do not commit them:

- `DATABASE_URL`: existing Neon PostgreSQL URL, including the deployment's required SSL configuration.
- `APP_URL`: canonical public HTTPS origin, recommended in production for OAuth/CSRF/SEO.
- `NEXT_PUBLIC_APP_URL`: existing supported public-origin fallback. It contains only a URL, never a secret.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
- `FOLIO_ENCRYPTION_KEY`: existing server-only stable secret used by Calendar encryption and OAuth verifier encryption; `TOKEN_ENCRYPTION_KEY` remains an existing fallback.
- Existing `GOOGLE_REDIRECT_URI`, if configured for Calendar, remains unchanged; sign-in builds its separate provider-specific callback from `APP_URL`.
- Existing reminder scheduler secrets/settings are unchanged.

No AI API key, alternative database, billing system or additional hosting platform is introduced. No production environment values were overwritten.

## Profile and onboarding

`drizzle/0003_identity_and_onboarding.sql` is additive:

- Extends `folio_users` with typed/validated `personal` JSON, `onboarding_step`, `onboarding_version`, and nullable `onboarding_completed_at`.
- Marks accounts present during migration as already onboarded so existing users keep direct workspace access. New accounts default to incomplete setup.
- Adds `folio_auth_identities`, `folio_auth_flows`, and `folio_auth_rate_limits` with appropriate uniqueness, foreign keys and expiry indexes.
- No existing workspace tables, accounts or records are dropped/recreated/reset.

The existing Drizzle migration journal is used. The legacy schema bootstrap checks the migration journal before running DDL, avoiding broad table-lock contention on normal cold starts. Its advisory lock is transaction-scoped so it is safe with Neon's transaction-pooled connections. `next.config.ts` continues including the migration files for deployment.

### Steps

Welcome → display name → form of address → optional gender → optional country → IANA timezone → language/regional formats → work preferences → available productivity preferences → theme → optional assistant identity → actual workspace.

- Each completed step saves and records its position. Refresh resumes the last saved step. Back/Continue and optional Skip work without a long registration form.
- Provider name is prefilled but editable. Country and timezone suggestions are not treated as confirmed identity data.
- English is the only translated app language offered. Regional English variants control formatting; no unsupported translations are implied.
- Gender is nullable, never inferred, unrelated to assistant presentation, and editable/clearable later.
- The completion screen follows a successful database commit. It does not create sample projects/tasks for real users.
- `/preferences` reuses the same uncluttered controls for later editing; Settings links to it and displays connected sign-in accounts.

### Stored preferences and effects

| Preference | Effect |
| --- | --- |
| Display/preferred/custom name | Profile labels and dashboard greetings |
| Optional gender/country | Optional profile information only; never access control |
| Language | English only in this release |
| IANA timezone | Existing notification/reminder timezone is reused; calendar event rendering/input, local day cutoffs, search date filters, dashboard and AI date context use it |
| Date format | Shared date displays use readable, DMY, MDY or YMD |
| Time format | Calendar clock display and AI reset-time display use 12h/24h |
| Week start | Calendar columns and task/week metrics/filter boundaries use Sunday or Monday |
| Regional locale | Date/time and dashboard number formatting |
| Task density/insights | Existing compact/comfortable task rows and insights defaults |
| Weekly goal | Existing weekly progress target |
| Notifications/quiet hours | Existing notification preference table and engine |
| Theme | Shared system/manual/persisted theme; system changes are observed; account theme applies before workspace render |
| Assistant name/presentation/style | Existing `folio_ai_preferences`, not a duplicate table |
| Work uses | Optional profile context; does not restrict modules |

UTC remains the timestamp storage basis; date-only task/project fields remain date-only to avoid shifting intended calendar dates.

## Testing

Automated tests use real Drizzle/PostgreSQL API paths against the configured sandbox database and disposable users. They do not access production Neon or existing user workspaces.

Commands from the project root:

1. Apply outstanding migrations to an existing Folio database: `node scripts/migrate-search.mjs`.
2. Start local Folio: `npm run dev`.
3. New auth/profile/onboarding server suite: `node scripts/test-phase3.mjs`.
4. Browser preparation: `npx --yes --package=@playwright/test playwright install --with-deps chromium`.
5. Full public-to-private browser journey: `npx --yes --package=@playwright/test -c 'node scripts/test-phase3-browser.mjs'`.
6. Existing regressions: `node scripts/test-search.mjs`, `node scripts/test-ai-actions.mjs`, `node scripts/test-ai-usage.mjs`, and `npx --yes --package=@playwright/test -c 'node scripts/test-search-browser.mjs'`.
7. Validation: `npx next typegen`, `npm exec tsc -- --noEmit --pretty false`, `npm run lint`, `npm run build`.

`TEST_BASE_URL` optionally selects another local test port. Tests use the same `DATABASE_URL` as the running app. Playwright is temporary test tooling, not a new runtime dependency.

Verified suites during implementation:
- 141 Phase 3 server assertions: public/protected routes, safe redirects, secure cookies, existing email account creation/login, each onboarding step and resume, validation/mass-assignment rejection, timezone/AI preference reuse, optional clearing, session refresh/logout/expiry, empty new workspace, user isolation, explicit identity linking, legacy provider compatibility, controlled Google/GitHub PKCE + verified-email protocol tests, single-use callback consumption/replay rejection, persistent rate limits.
- 73 Phase 3 browser checks: desktop/tablet/mobile landing, metadata, all 16 theme/view image states, theme persistence, mobile navigation, FAQ, signup → every onboarding step → intended workspace, interruption/resume, back navigation, optional identity details, regional settings with visible DMY task dates, compact rows, task insights and Sunday-first calendar, live system-theme following, profile editing, logout, and no browser exceptions.
- 225 existing search API assertions, 38 search browser checks, 29 AI-action API assertions, and 33 AI-usage API assertions.
- Real screenshot generation completed for all 16 assets; temporary fixture accounts were cleaned up.

Provider token/profile responses in the protocol unit checks are controlled test fixtures—not a claim that live OAuth consent was exercised. External Google/GitHub sign-in and connected Calendar read/write still require the console credentials and live account verification described above. Real local model inference remains dependent on WebGPU hardware, as in earlier phases.

## Netlify deployment

1. Keep the existing Next.js/Netlify deployment and the existing Neon `pg` pool connection. There is no new database provider or separate app.
2. Configure the canonical `APP_URL`, OAuth clients, existing database URL and encryption secret in Netlify's server environment. Keep secrets out of `NEXT_PUBLIC_*`.
3. Back up normally and apply the additive migration before the release using `node scripts/migrate-search.mjs`. The existing bootstrap also applies outstanding journal entries safely.
4. Build with `npm run build`; deploy using Netlify's Next.js runtime. Static screenshot/font assets ship from `public/`; the proxy and authenticated handlers run server-side.
5. Register exact HTTPS callbacks in both provider consoles and test Google/GitHub signup, returning login, explicit linking, cancellation and Calendar permissions using your own test accounts.
6. Confirm the sitemap/canonical/social image use the real configured domain. Private pages and callbacks are noindex.

## Known limitations and review notes

- Live OAuth consent, real provider-account recovery and production Neon were not tested without deployment credentials. The app deliberately shows honest not-configured messages rather than simulating login.
- Existing password-based accounts remain supported. Email ownership verification/password-reset delivery is not added because no mail service is configured. OAuth users do not need a password.
- There is no self-service account deletion UI yet; the privacy page states this. Legal copy should be reviewed by the operator before a commercial launch.
- No standalone Analytics module or unsupported language translations are invented. Insights are the existing task metrics.
- Optional work-use/gender fields are profile context only; they do not silently change permissions or invent dashboard layouts.
- Browser/device local-AI limitations and Phase 2 tool limitations remain; no universal model-compatibility promise is made.
- API authorization remains user-scoped independent of onboarding. The server page guard requires setup completion before entering the workspace; existing APIs are not disabled during optional preference setup.

## File inventory

**New:**
- Public pages: `src/app/login/page.tsx`, `signup/page.tsx`, `onboarding/page.tsx`, `preferences/page.tsx`, `privacy/page.tsx`, `terms/page.tsx`, `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`, `error.tsx`.
- Components: `src/components/public-site.tsx`, `auth-screen.tsx`, `onboarding.tsx`, `profile-settings.tsx`.
- Styles/assets: `src/app/public.css`, `onboarding.css`, `public/fonts/*`, `public/showcase/light/*.webp`, `public/showcase/dark/*.webp`, `public/showcase/manifest.json`.
- Services: `src/lib/auth-identities.ts`, `profile-service.ts`, `personalization.ts`, `countries.json`, `timezones.json`.
- Routing/session: `src/proxy.ts`, `src/app/api/auth/session/route.ts`.
- Migration: `drizzle/0003_identity_and_onboarding.sql`, `drizzle/meta/0003_snapshot.json`, updated journal.
- Tooling: `scripts/capture-showcase.mjs`, `folio-test-loader.cjs`, `test-phase3.mjs`, `test-phase3-browser.mjs`, this document.

**Updated:**
- `src/app/page.tsx`, `layout.tsx`, `(workspace)/layout.tsx`, `(workspace)/[view]/page.tsx`, `next.config.ts`.
- `src/lib/auth.ts`, `oauth.ts`, `types.ts`, `tasks.ts`, `use-workspace.ts`, `search-service.ts`, `folio-ai/action-executor.ts`.
- `src/db/schema.ts`, `migrate.ts`.
- `src/app/api/auth/route.ts`, auth OAuth start/callback routes, `api/profile/route.ts`, `api/workspace/route.ts`.
- `src/components/theme-toggle.tsx`, `workspace.tsx`, `workspace-views.tsx`, `dashboard.tsx`, `task-calendar.tsx`, `integrations/google.tsx`, `notification-settings.tsx`, `folio-ai-panel.tsx`.
- Existing browser regression fixture setup now marks its disposable accounts as already onboarded.

No commit or push was performed.
