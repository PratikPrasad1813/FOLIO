# Historical record — former Neon Managed Better Auth migration

> **Archived, not current configuration.** Folio now uses self-managed authentication again. Do not follow the setup steps below; see `AUTHENTICATION.md` for current environment variables, OAuth callbacks, data preservation, and recovery. This historical document is retained to explain existing database states.

# Folio — Migration to Neon Managed Better Auth

Folio's hand-rolled authentication has been replaced with **Neon Managed Better Auth** using the official `@neon/auth` Next.js SDK. Neon PostgreSQL and Drizzle ORM are unchanged, no application data was dropped, and every existing feature continues to resolve its owner through the same `currentUser()` / `getUser()` API.

---

## 1. Summary of the authentication changes

| Before | After |
| --- | --- |
| Hand-rolled opaque sessions in `folio_sessions` | Neon Auth managed sessions in the `neon_auth` schema |
| Custom Google/GitHub OAuth with hand-managed PKCE, state cookies and `folio_auth_flows` | `authClient.signIn.social()` — Neon Auth owns the entire OAuth round trip |
| `src/lib/oauth.ts`, `src/lib/auth-identities.ts`, `/api/auth`, `/api/auth/session`, `/api/auth/oauth/**` | Single catch-all proxy `src/app/api/auth/[...path]/route.ts` |
| Custom rate limiting in `folio_auth_rate_limits` | Rate limiting and abuse protection handled by the Neon Auth service |
| Anonymous fallback to a shared demo account | Removed — every private route requires a real Neon Auth session |

**Identity model.** `folio_users` remains Folio's profile and preferences table and keeps its primary key. A new nullable `auth_user_id` column links each row to a `neon_auth."user".id`. Every existing foreign key (projects, tasks, ideas, milestones, subtasks, activities, notifications, reminders, search history, saved filters, AI preferences, AI usage) is untouched.

On each request Folio resolves the Neon Auth session into a `folio_users` row:

1. Match `folio_users.auth_user_id` to the Neon Auth user id.
2. Otherwise, if Neon Auth reports a **verified** email, claim the existing `folio_users` row with that email. This is how someone who already owned a Folio workspace keeps every project, task and idea the first time they sign in through Neon Auth.
3. Otherwise create a new profile that starts first-time onboarding.

An **unverified** email never claims an existing row, and the fallback insert uses a reserved address when the incoming email is already owned by another profile, so `folio_users.email` uniqueness is never violated.

---

## 2. Files created, modified and removed

### Created
- `src/lib/neon-auth/server.ts` — the single `createNeonAuth()` instance, plus `isNeonAuthConfigured` and session helpers.
- `src/lib/neon-auth/client.ts` — `createAuthClient()` browser client (no arguments, no secrets).
- `src/app/api/auth/[...path]/route.ts` — Neon Auth proxy; exports `GET`, `POST`, `PUT`, `PATCH`, `DELETE` from `auth.handler()`.
- `drizzle/0004_neon_auth_identity_link.sql` — adds `folio_users.auth_user_id text`.
- `drizzle/0005_neon_auth_unique_identity.sql` — adds `folio_users_auth_user_id_idx` unique index.
- `drizzle/meta/0004_snapshot.json`, `drizzle/meta/0005_snapshot.json`, updated `_journal.json`.
- `scripts/test-neon-auth.mjs` — migration verification suite.
- This document.

### Modified
- `src/lib/auth.ts` — rewritten. Exports the same `currentUser`, `getUser`, `publicUser`, `requestOrigin`, `sameOrigin`, `safeDestination`, `signedInDestination` and `AuthenticationError` the rest of Folio already imports, now backed by Neon Auth sessions plus `resolveFolioUser()`.
- `src/proxy.ts` — uses `auth.middleware({ loginUrl: "/login", publicRoutes })` for session validation and login redirects, keeps `X-Robots-Tag`/`Cache-Control` on private routes, forwards `x-folio-destination`, and fails closed when auth is unconfigured.
- `src/components/auth-screen.tsx` — Google/GitHub use `authClient.signIn.social()`; email uses `authClient.signIn.email()` / `authClient.signUp.email()`. Visual design unchanged.
- `src/app/login/page.tsx`, `src/app/signup/page.tsx` — pass `authConfigured` instead of per-provider flags.
- `src/components/workspace.tsx` — sign-out via `authClient.signOut()`; added a `neon` provider label.
- `src/components/profile-settings.tsx` — "Sign-in method" card now describes Neon Auth–managed providers.
- `src/lib/use-workspace.ts` — removed the legacy `/api/auth/session` renewal poll (Neon Auth refreshes sessions in the proxy).
- `src/db/schema.ts` — `authUserId` column and unique index.
- `scripts/folio-test-loader.cjs` — stubs ESM-only Next subpaths so Folio's own logic stays testable outside a bundled build.

### Removed
- `src/app/api/auth/route.ts` — legacy email/session endpoint.
- `src/app/api/auth/session/route.ts` — legacy session renewal.
- `src/app/api/auth/oauth/[provider]/route.ts`, `.../callback/route.ts` — legacy OAuth start/callback.
- `src/lib/oauth.ts` — legacy provider config and code exchange.
- `src/lib/auth-identities.ts` — legacy identity-linking service.

Google Calendar OAuth in `src/lib/google.ts`, `src/lib/calendar-sync.ts` and `src/app/api/integrations/google/**` is **untouched** and continues to work exactly as before.

---

## 3. Packages

| Package | Change |
| --- | --- |
| `@neon/auth` | **added** (`0.8.2`) — official Neon Managed Better Auth SDK |
| `pg`, `drizzle-orm`, `drizzle-kit`, `next`, `react`, `lucide-react` | unchanged |

No self-hosted Better Auth server, no separate auth database, no additional hosting platform.

---

## 4. Database changes and migration details

Two additive migrations, applied in order:

```sql
-- 0004_neon_auth_identity_link.sql
ALTER TABLE "folio_users" ADD COLUMN "auth_user_id" text;

-- 0005_neon_auth_unique_identity.sql
CREATE UNIQUE INDEX "folio_users_auth_user_id_idx" ON "folio_users" USING btree ("auth_user_id");
```

- **Nothing is dropped or reset.** All 19 application tables and their foreign keys to `folio_users.id` are untouched.
- The `neon_auth` schema is created and maintained by **Neon**, not by Folio's Drizzle migrations. Folio therefore declares no cross-schema foreign key; it stores the Neon Auth user id as `text` with a unique index.
- Obsolete tables `folio_sessions`, `folio_auth_flows`, `folio_auth_identities` and `folio_auth_rate_limits` are **retained** so the change is reversible. They can be dropped manually once the migration is confirmed in production.
- Apply with the existing runner: `node scripts/migrate-search.mjs`.

### Existing users

- **Google/GitHub users** whose Neon Auth email is verified are claimed on first sign-in and keep their whole workspace.
- **Email/password users** are *not* automatically migrated: Neon Auth has no admin API to import password hashes without an admin session. They must use password reset (email) or sign in with Google/GitHub using the same address. **This is the one real limitation of the migration.**

---

## 5. Required Neon dashboard configuration

1. Open your Neon project → **Auth** (or **Better Auth**) → **Enable Auth**.
2. Copy the **Auth URL** from *Settings → Better Auth → Project Info*. This is `NEON_AUTH_BASE_URL`.
3. Add your app's origins under **trusted domains**:
   - `http://localhost:3000` (local)
   - `https://YOUR-FOLIO-DOMAIN` (production)
   - Preview wildcard if you use branch previews, e.g. `https://*.your-preview.netlify.app`
4. Paste your Google and GitHub Client ID/Secret into the Neon Auth provider settings for that branch.

## 6. Required Google and GitHub OAuth configuration

**The redirect URI changes.** Neon Auth — not Folio — receives the OAuth callback. Register:

```
{NEON_AUTH_BASE_URL}/callback/google
{NEON_AUTH_BASE_URL}/callback/github
```

Example Google authorized redirect URI:

```
https://ep-example.neonauth.us-east-2.aws.neon.tech/neondb/auth/callback/google
```

- **Google Cloud Console** → OAuth client (Web application) → *Authorized redirect URIs*: the URL above for each branch. Under *Authorized JavaScript origins*, add your app origins (`http://localhost:3000`, `https://your-domain`). Complete the consent-screen branding (app name, support email, authorized domains).
- **GitHub Developer Settings** → OAuth App → *Authorization callback URL*: `{NEON_AUTH_BASE_URL}/callback/github`.
- Google ships shared development credentials, so Google sign-in works immediately for testing. GitHub always requires your own app.
- Register a redirect URI **per branch** you test against, since each branch has its own `NEON_AUTH_BASE_URL`.
- **Keep** the existing Google Calendar callback `https://YOUR-FOLIO-DOMAIN/api/integrations/google/callback` registered — it is separate from sign-in.

---

## 7. Environment variables

| Name | Where | Purpose |
| --- | --- | --- |
| `NEON_AUTH_BASE_URL` | `.env.local` **and** Netlify | Auth URL from the Neon Console for that branch |
| `NEON_AUTH_COOKIE_SECRET` | `.env.local` **and** Netlify | 32+ char secret for signing session cookies (`openssl rand -base64 32`) |
| `DATABASE_URL` | `.env.local` **and** Netlify | Existing Neon PostgreSQL URL (unchanged) |
| `APP_URL` | Netlify (recommended) | Canonical public HTTPS origin; used for redirects and OAuth |
| `NEXT_PUBLIC_APP_URL` | optional | Existing public-origin fallback; URL only, never a secret |
| `FOLIO_ENCRYPTION_KEY` | Netlify | Existing secret; still used for Calendar token encryption |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **Neon Console only** | Paste into Neon Auth provider settings, not into Netlify |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | **Neon Console only** | Paste into Neon Auth provider settings, not into Netlify |

`.env.local` is git-ignored. No secret value is committed or exposed to the browser — verified by scanning every generated client chunk.

---

## 8. Local testing instructions

```bash
node scripts/migrate-search.mjs     # apply the two additive migrations
npm install                          # installs @neon/auth
npm run dev
```

Then:

```bash
node scripts/test-neon-auth.mjs     # 83-assertion migration verification suite
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run lint
npm run build
```

With `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` set in `.env.local`, also manually verify: new user registration, existing user sign-in, Google sign-in, GitHub sign-in, sign-out, session persistence after refresh, protected page access, onboarding, and Google Calendar connection.

---

## 9. Netlify deployment instructions

1. Keep the existing Next.js/Netlify setup and Neon `pg` pool — nothing about deployment changes.
2. In **Netlify → Site settings → Environment variables**, add `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET`, and confirm `DATABASE_URL`, `APP_URL` and `FOLIO_ENCRYPTION_KEY` are present.
3. Back up your database, then run `node scripts/migrate-search.mjs` before the release.
4. Register `{NEON_AUTH_BASE_URL}/callback/google` and `/callback/github` in the provider consoles, and add your production origin to Neon Auth trusted domains.
5. Deploy. `npm run build` compiles; the catch-all `/api/auth/[...path]` route and `proxy.ts` run server-side.

---

## 10. Tests performed and results

**Passed (actually run):**

| Check | Result |
| --- | --- |
| `npx next typegen` | pass |
| `npm exec tsc -- --noEmit` | pass |
| `npm run lint` | pass |
| `npm run build` | pass |
| `build_and_start` + `/api/health` | pass |
| `scripts/test-neon-auth.mjs` | **83 assertions pass** |
| Public pages `/`, `/login`, `/signup`, `/privacy`, `/terms`, `/robots.txt`, `/sitemap.xml` | 200 |
| Protected pages `/overview`, `/projects`, `/tasks`, `/ideas`, `/calendar`, `/ai`, `/settings`, `/onboarding`, `/preferences` | 307 → `/login?next=…` |
| Protected APIs `/api/workspace`, `/api/profile`, `/api/search`, `/api/notifications`, `/api/ai/usage`, `/api/filters` | 401 |
| Forged legacy `folio_session` cookie | 401 — cannot authenticate |
| Neon Auth proxy `/api/auth/get-session` | 503 with an honest unconfigured message |
| Landing renders real product screenshot (1440 px) | pass |
| Login shows Google + GitHub buttons and unconfigured notice | pass |
| Mobile (390 px) has no horizontal overflow | pass |
| Browser console errors | 0 |
| No secret value in any client chunk | pass |
| `resolveFolioUser`: new identity → new onboarding profile | pass |
| `resolveFolioUser`: repeat sign-in → same profile | pass |
| `resolveFolioUser`: verified email claims existing account and preserves onboarding | pass |
| `resolveFolioUser`: unverified email **cannot** claim an existing account | pass |
| `resolveFolioUser`: blank/invalid identity rejected | pass |
| `safeDestination` blocks open redirects | pass |
| Disposable test users cleaned up | pass |

**Not testable in this environment (no Neon Auth credentials):**

- Real Google or GitHub consent and redirect.
- Live sign-up / sign-in / sign-out against the Neon Auth server.
- Session persistence across page refresh with a real session cookie.
- OAuth account linking through the Neon Auth UI.
- Authenticated onboarding and workspace flows end-to-end.
- Google Calendar connection with a signed-in user.

The implementation follows the official Neon Auth Next.js API-methods quick start, the Next.js Server SDK reference, and the OAuth setup guide. It reports an honest 503 and an explicit setup notice rather than simulating a working provider.

---

## 11. Remaining limitations and manual steps

1. **Enable Managed Better Auth in the Neon Console** and set both environment variables. Until then Folio's public site works, but every private route redirects to login and the auth proxy returns 503.
2. **Register the new OAuth redirect URIs** (`{NEON_AUTH_BASE_URL}/callback/{provider}`) — the old Folio callbacks no longer apply.
3. **Existing email/password users are not auto-migrated.** They need a password reset or a matching Google/GitHub identity.
4. **In-app provider linking** is now managed by Neon Auth rather than a Folio settings button. The Settings card explains this; you can add a deeper account-settings flow later using Better Auth's account APIs.
5. **Screenshot recapture** requires a Neon Auth–enabled environment, because the capture script can no longer forge a session cookie. The existing 16 real screenshots in `public/showcase/` remain valid and are unaffected.
6. The obsolete tables `folio_sessions`, `folio_auth_flows`, `folio_auth_identities` and `folio_auth_rate_limits` were intentionally retained. Drop them manually after confirming the migration in production.
7. The previous `scripts/test-phase3.mjs` and `scripts/test-search.mjs` suites authenticate via the legacy `folio_session` cookie and therefore require a Neon Auth–enabled environment (or adaptation) to run. `scripts/test-neon-auth.mjs` is their replacement for the migration surface.

No commit or push was performed.
