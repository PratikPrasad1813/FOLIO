# Folio authentication and account transition

## What the repository history actually shows

The initial commit `8f0069e` used Folio's own email/password and Google/GitHub OAuth routes. It used Node's built-in **scrypt**, a random salt, and a `salt:hex-key` password hash; `folio_sessions` stored only the SHA-256 hash of an opaque cookie token. The OAuth routes used a state cookie and provider-specific authorization-code exchanges. There was no third-party authentication library and no middleware file in that commit. The next application commit `5c6936a` explicitly **disabled authentication**, routing every request to one shared demo user; it left OAuth and API files behind, but they were not a complete working authentication system. Third-Commit `d432f4c` introduced `@neon/auth`, its client, server wrapper, catch-all proxy, Neon middleware, `auth_user_id` link, and migrations `0004`/`0005`; some old files remained in that published tree. The old migration document describes an intermediate design that is not independently present as a Git commit.

## Restored design

Folio owns credentials, OAuth identities, and sessions in PostgreSQL through Drizzle. The original scrypt format and `folio_session` token format are compatible with initial-commit accounts. Session cookies are HttpOnly, SameSite=Lax, Secure in production, expire after seven days, renew while the workspace is active, and are revoked on logout. API and page guards validate the database session; mutations check their origin, and Folio's APIs enforce user ownership. OAuth uses the existing `folio_auth_flows` and `folio_auth_identities` tables with single-use state, a browser-bound HttpOnly cookie, PKCE, expiry, stable provider subjects, and verified emails. Google and GitHub are separate flows. Both request an account picker where supported.

An identity already linked by provider and subject resolves to the original Folio user UUID. To recover the original email-only OAuth records, a verified identity for that **same legacy provider** can be attached once. A different provider is never silently merged just because its email matches. Sign in to the existing account (or recover it by email), then use Settings → Sign-in method to link a provider; its verified email must match, and the browser must retain the same session throughout the flow. Conflicting identity or provider links are rejected. GitHub verification comes from its `/user/emails` API, not the public profile email.

## Preserving existing Neon-managed accounts

No application user IDs, ownership foreign keys, data, existing identity tables, historical migrations, `folio_users.auth_user_id`, or the Neon-managed `neon_auth` schema are deleted or rewritten. Managed IDs are **not** treated as Folio UUIDs. Back up the database and inspect `folio_users.id`, `auth_user_id`, email, and existing identity records before changing deployments. Legacy Folio password hashes remain usable. Managed-only password hashes are not available in Folio's compatible scrypt format and must not be copied or guessed. Those users should use **Forgot your password?** (available when `NEXT_PUBLIC_EMAIL_FEATURES_ENABLED=true`; see [Email features](#email-features-paused-in-the-interface)): a one-time 30-minute link is delivered to their existing Folio email, the token is stored only as a hash, and all old Folio sessions are revoked after reset. They can then link their verified Google/GitHub identity in Settings. Accounts with reserved `@neon-auth.invalid` addresses cannot receive mail; an administrator must verify ownership and resolve those cases individually before updating a profile. Never merge users or delete `neon_auth` merely based on matching IDs or unverified email. Old Neon-managed browser sessions must sign in again.

Recovery requires configured SMTP. Responses do not reveal whether an email exists. Links contain the token in a URL fragment, are single-use, and are not logged. Use a trusted mail service; do not disable TLS verification. Folio does not expose hashes, tokens, or provider secrets to the browser.

## Deployment, including Netlify

Set these in the server-side Netlify environment configuration (and `.env.local` locally):

* `DATABASE_URL`: existing Neon PostgreSQL connection string. Keep the same database to preserve data.
* `APP_URL`: canonical **HTTPS** origin, e.g. `https://your-domain.example`. Set `NEXT_PUBLIC_APP_URL` to the same public origin if used. Do not use a request-supplied host as a production canonical URL.
* `FOLIO_ENCRYPTION_KEY`: a stable random secret of at least 32 characters (`openssl rand -base64 32`). It protects OAuth flow verifiers and existing Calendar tokens; do not rotate casually or old Calendar tokens become unreadable.
* `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: optional Google web OAuth credentials. Register `https://YOUR-DOMAIN/api/auth/oauth/google/callback`. Google Calendar has the separate callback `/api/integrations/google/callback` and separate scopes.
* `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: optional GitHub OAuth app credentials. Register `https://YOUR-DOMAIN/api/auth/oauth/github/callback`.
* `SMTP_URL`, `SMTP_FROM`: authenticated SMTP URL and sender for recovery. SMTP must support TLS/STARTTLS. Without these, recovery reports that it is unconfigured; existing compatible passwords still work.
* `FOLIO_CRON_SECRET`: optional, for scheduled reminders.

Do not set `NEON_AUTH_BASE_URL` or `NEON_AUTH_COOKIE_SECRET`; they are obsolete. Secrets are server-only. Each preview hostname needs a correctly configured canonical origin and provider callback; do not expose screenshot mode or its database credentials in Netlify. Register local callback URLs separately when testing locally.

## Schema and rollout

Historical migrations `0003`–`0006` are retained exactly. New `0007_password_recovery.sql` only adds the recovery-token table and index. The existing Folio initializer applies missing base schema/journal migrations on demand; on an existing database take a backup and review the journal first. `npm run db:verify` is read-only; `npm run db:migrate` applies pending changes. No migration removes or modifies managed auth tables. Roll out on a staging copy first, test recovery with a real mailbox and both OAuth providers, verify workspace IDs and owned data, and retain the managed schema until the migration has been independently audited and approved. No destructive migration is part of this change.

## Complete Account Deletion & Data Lifecycle

Folio provides a fully functional, privacy-first account deletion workflow directly in the application.

### Location & User Experience
- **Location:** `Settings` → `Account` → `Danger Zone` → `Delete account...`.
- Displays a dedicated danger-styled card with an explicit explanation of data permanence.
- Clicking the button opens a professional, accessible confirmation dialog (`DeleteAccountModal`).
- The modal breaks down every category of data that will be erased:
  - 📁 **Projects & Milestones:** Project boards, categories, milestone checkpoints, and progress metrics.
  - ✅ **Tasks & Subtasks:** All tasks, checklists, notes, tags, estimates, and reminder timers.
  - 💡 **Idea Board:** All captured ideas, stages, and exploration notes.
  - 📅 **Calendar & Integrations:** Connected Google Calendar accounts, synced mirrors, and encrypted credentials.
  - 🧠 **Folio AI:** Assistant conversation logs, messages, and model preferences.
  - ⚙️ **Account Data & Sessions:** Passwords, linked OAuth identities, active sessions, and personal preferences.
- **Confirmation Requirement:** The user must explicitly type their account email address (or `"delete my account"`).
- **Re-Authentication Requirement:** If the user has a password set (`user.passwordHash`), their current password is required and verified with `verifyPassword()`. If the user is a pure OAuth user without a password, confirmation of their verified email address verifies their intention.
- **Accidental Deletion Prevention:** The submission button is disabled until all verification criteria are met. A loading spinner indicates progress.
- **Post-Deletion Experience:** All database sessions are erased, the `folio_session` HTTP-only cookie is cleared, and the browser is redirected to `/?deleted=account_deleted`, displaying an acknowledgment banner. Any subsequent request with an old session receives `401 Unauthorized`.

### Server-Side Integrity & Security (`DELETE /api/account`)
- **Server-Verified Identity:** The server authenticates the user from the secure session cookie via `getUser()`. It never accepts a client-provided user ID.
- **CSRF Protection:** Validates `sameOrigin(request)`.
- **Rate Limiting:** Protects against abuse with `allowAuthAttempt(request, "account-deletion", user.email)`.
- **External Token Revocation:** Best-effort revocation of Google Calendar refresh tokens via Google's revocation endpoint before database deletion.
- **Single Database Transaction:** All user records are deleted within an atomic transaction (`db.transaction`). If any operation fails, the transaction rolls back completely.
- **Strict Data Isolation:** Every query is strictly filtered with `WHERE userId = user.id` (and `WHERE id = user.id`). Other users' records and shared global tables (`folio_scheduler_runs`, `folio_auth_rate_limits`) are never touched.
- **Neon Managed Auth Safety:** The `neon_auth` schema is untouched.
- **Zero Orphaned Records:** Explicit deletion covers all 25 child tables in dependency order, supplemented by PostgreSQL `ON DELETE CASCADE` foreign keys.

## Email features (paused in the interface)

Email verification and password recovery are hidden from users while `NEXT_PUBLIC_EMAIL_FEATURES_ENABLED` is not `true` (the default). This is a **frontend-only** switch. The backend stays fully implemented.

| Surface | While the flag is off | Backend status |
| --- | --- | --- |
| "Forgot your password?" link on sign-in | Hidden | Unchanged |
| `/recover` request form and token completion | Calm notice only; the browser makes no request | `POST /api/auth/recovery` validates single-use, 30-minute tokens |
| Verification prompts, "Send verification link", "Verify email address" | Replaced by a calm notice in the workspace and Settings | `POST /api/auth/verify` validates single-use, 24-hour tokens |
| `/verify-email#token=…` completion | Calm notice; the browser makes no request | `confirm` action unchanged |
| Email status chip in Settings | Shown only when the address is verified | `email_verified_at` preserved |

Rules that hold regardless of the flag:

- `email_verified_at` changes only when a valid, unexpired verification token is consumed, or when a sign-in provider asserts a verified address during OAuth (Google's `email_verified` claim, or GitHub's verified-email API, never the public profile email). A password reset never sets it.
- Nothing infers verification from the sign-in provider or from the flag. Legacy Google and GitHub accounts show no unverified state.
- No route or server action requires a verified email. Account deletion requires the current password for password accounts and a typed confirmation, regardless of verification.
- Server-side code never reads the flag. Email errors are generic (for example, "Email verification is temporarily unavailable. Please try again later.") and never include SMTP settings.
- Failed deliveries never mark a welcome or verification email as sent.

### Configuring Resend when a verified domain is available

1. In Resend, add your domain and create the DNS records it shows (DKIM and SPF; DMARC recommended). Resend will not send from a domain you have not verified.
2. Create a Resend API key with sending access.
3. Set these **server-only** variables in your host (for example, Netlify environment variables):

   ```sh
   SMTP_URL="smtps://resend:re_your_api_key@smtp.resend.com:465"
   SMTP_FROM="Folio <hello@mail.your-domain.example>"
   APP_URL="https://your-canonical-domain.example"
   ```

   Port 465 (or 2465) uses implicit TLS. Port 587, 2587, or 25 uses STARTTLS. The username is the literal string `resend`.
4. Verify delivery on a staging deployment with the flag still off, then set `NEXT_PUBLIC_EMAIL_FEATURES_ENABLED=true` in the build environment and redeploy.

### Testing the flag

`npm run test:email-flag` (requires the dedicated `folio_screenshots` database) starts the app in both states, verifies the hidden or restored UI, confirms generic backend errors, confirms that a reset never marks an address verified, and confirms that sign-in, OAuth, existing sessions, and protected routes are unaffected. Delivery to a real mailbox still requires a staging deployment.

## Testing limitations

The local integration suites test provider redirect selection, state rejection, simulated verified provider identities, registration, login, logout, renewal, expiry, recovery-token replay, CSRF, cross-user isolation, complete account deletion, and transactional cascading. Actual Google/GitHub authorization and live SMTP delivery require real provider credentials on a staging deployment. See `SCREENSHOTS.md` for the isolated test environment.
