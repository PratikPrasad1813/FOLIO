# Folio

<div align="center">
  <h3>A little clarity. A lot of possibility.</h3>
  <p>
    A thoughtful, privacy-first personal workspace for your projects, tasks, schedule, and ideas.
    <br />
    Built with <strong>Next.js 16 (App Router)</strong>, <strong>PostgreSQL</strong> via <strong>Drizzle ORM</strong>, and on-device <strong>WebGPU Local AI</strong>.
  </p>

  <p>
    <a href="https://github.com/PratikPrasad1813/Folio"><img src="https://img.shields.io/badge/GitHub-Repository-blue?logo=github" alt="GitHub Repository" /></a>
    <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-16.4.4-black?logo=next.js" alt="Next.js" /></a>
    <a href="https://orm.drizzle.team"><img src="https://img.shields.io/badge/Drizzle_ORM-0.45.2-brightgreen" alt="Drizzle ORM" /></a>
    <a href="https://www.postgresql.org"><img src="https://img.shields.io/badge/PostgreSQL-15%2B-blue?logo=postgresql" alt="PostgreSQL" /></a>
    <a href="https://webllm.mlc.ai"><img src="https://img.shields.io/badge/WebLLM-Local_WebGPU-purple" alt="WebLLM" /></a>
    <a href="https://playwright.dev"><img src="https://img.shields.io/badge/Playwright-E2E_Screenshots-orange?logo=playwright" alt="Playwright" /></a>
  </p>
</div>

---

## Setup Guides

- [Database setup and migrations](DATABASE_SETUP.md)
- [Authentication and account security](AUTHENTICATION.md)
- [Refreshing product screenshots](SCREENSHOTS.md)

---

## Table of Contents

1. [Overview & Vision](#overview--vision)
2. [Verified Technology Stack](#verified-technology-stack)
3. [Architecture Overview & Project Structure](#architecture-overview--project-structure)
4. [Screenshot Gallery & Visual Tour](#screenshot-gallery--visual-tour)
5. [Core Features](#core-features)
   - [Unified Workspace & First-Login Concierge](#unified-workspace--first-login-concierge)
   - [Project Management & Milestone Checkpoints](#project-management--milestone-checkpoints)
   - [Kanban, High-Density Lists & Task Calendar](#kanban-high-density-lists--task-calendar)
   - [Google Calendar Bidirectional Sync](#google-calendar-bidirectional-sync)
   - [Idea Board with One-Click Conversion](#idea-board-with-one-click-conversion)
   - [Task Insights & Velocity Metrics](#task-insights--velocity-metrics)
   - [Local-First On-Device AI (WebLLM)](#local-first-on-device-ai-webllm)
   - [Contextual Notifications & Quiet Hours](#contextual-notifications--quiet-hours)
   - [Complete Secure Account Deletion](#complete-secure-account-deletion)
   - [VIP Transactional Email Design System](#vip-transactional-email-design-system)
6. [Quickstart & Local Installation](#quickstart--local-installation)
7. [Environment Variables Reference](#environment-variables-reference)
8. [Database Setup & Migrations](#database-setup--migrations)
9. [Authentication & Account Management](#authentication--account-management)
10. [Account Deletion & Data Lifecycle](#account-deletion--data-lifecycle)
11. [Google Calendar Integration Setup](#google-calendar-integration-setup)
12. [GitHub OAuth Setup](#github-oauth-setup)
13. [Email Configuration & Preview Studio](#email-configuration--preview-studio)
14. [Testing Suite](#testing-suite)
15. [Automated Screenshot Pipeline](#automated-screenshot-pipeline)
16. [Production Deployment](#production-deployment)
17. [Troubleshooting Guide](#troubleshooting-guide)
18. [Contributing & Security Reporting](#contributing--security-reporting)
19. [License Information](#license-information)

---

## Overview & Vision

Folio is designed around a simple belief: **your personal workspace should feel calm, private, and distraction-free**.

Rather than scattering your focus across disjointed apps—one for notes, one for to-dos, one for project milestones, and another for calendar events—Folio unites your ambitions, day-to-day commitments, and early sparks in one cohesive, server-rendered application.

### Key Tenets
- **Self-Managed Security:** Authentication and workspace records remain under your control. Sessions use opaque SHA-256 tokens in secure, HTTP-only, SameSite=Lax cookies with `scrypt` password hashing.
- **Privacy by Design:** On-device AI executes in your browser using WebGPU and WebLLM. Conversation drafts, prompts, and context never leave your machine.
- **Complete Data Ownership:** At any point, export your entire workspace as readable JSON or permanently delete your account with guaranteed zero orphaned records across all 25 PostgreSQL tables.
- **Calm, Human Design:** Polished typography (`Instrument Serif` & `DM Sans`), thoughtful light/dark themes, subtle animations, and zero spam.

---

## Verified Technology Stack

| Layer | Technology | Details |
| --- | --- | --- |
| **Framework** | Next.js 16.4.4 | App Router, Server Components, Streaming Route Handlers, Proxy Middleware |
| **UI Library** | React 19.2.6 | Client Components, Hooks, Context, `useId`, `useSyncExternalStore` |
| **Database** | PostgreSQL 15+ | Hosted on Neon PostgreSQL or local PostgreSQL instance |
| **ORM & Migrations**| Drizzle ORM 0.45.2 & Drizzle Kit | Type-safe schema definition, transactional queries, 28 tables |
| **Styling** | Tailwind CSS 4 & PostCSS 8 | Custom CSS design tokens, CSS variables, fluid responsive layouts |
| **Icons & Visuals** | Lucide React 1.66.0 | Semantic SVG iconography across all components |
| **Local AI Engine** | `@mlc-ai/web-llm` 0.2.87 | WebGPU browser-based LLM inference with zero cloud server dependencies |
| **Image Processing**| Sharp 0.35.5 | High-efficiency PNG palette optimization and metadata extraction |
| **Automation & E2E**| Playwright 1.64.1 | Headless Chromium automation for screenshot generation and test suites |
| **Email Delivery** | Nodemailer 10.3.1 | TLS SMTP client for transactional emails (welcome, verification, reset) |

---

## Architecture Overview & Project Structure

```
Folio/
├── src/
│   ├── app/                           # Next.js App Router (Pages, Layouts, API Routes)
│   │   ├── (workspace)/               # Private workspace layout & dynamic views
│   │   ├── api/                       # REST endpoints (auth, workspace, notifications, ai, google)
│   │   │   ├── account/route.ts       # DELETE /api/account (secure account deletion)
│   │   │   ├── auth/                  # Credentials, OAuth routes, session renewal, verification
│   │   │   ├── integrations/google/   # Google Calendar OAuth, event syncing, calendar listing
│   │   │   ├── notifications/         # Notification feeds, preferences, reminders, cron runner
│   │   │   ├── profile/route.ts       # User personalization, settings, and profile updates
│   │   │   └── workspace/             # Core CRUD for projects, tasks, milestones, and ideas
│   │   ├── dev/emails/page.tsx        # Local Email Design System Preview Studio
│   │   ├── login/ & signup/           # Authentication pages with Google/GitHub/email
│   │   ├── onboarding/                # 10-step personalization & smart-default onboarding
│   │   ├── recover/ & verify-email/   # Password reset & email verification flows
│   │   ├── globals.css & public.css   # Core design system tokens and landing page styling
│   │   └── layout.tsx & page.tsx      # Root application layout & public SaaS landing page
│   ├── components/                    # Modular React Components
│   │   ├── danger-zone.tsx            # Danger Zone settings card & DeleteAccountModal
│   │   ├── dashboard.tsx              # OverviewPanel, weekly focus ring, priority queue
│   │   ├── workspace-concierge.tsx    # First-login onboarding guide with live 4-step checklist
│   │   ├── public-site.tsx            # Comprehensive 18-section SaaS product landing page
│   │   ├── notification-center.tsx    # In-app notification center with categorized filters
│   │   ├── task-board.tsx             # Kanban workflow columns with drag-and-drop
│   │   ├── task-list.tsx              # High-density filtered task table with bulk operations
│   │   ├── task-calendar.tsx          # Month and week calendar views with deadline overlays
│   │   ├── folio-ai-panel.tsx         # On-device WebGPU assistant UI & plan review
│   │   └── global-search.tsx          # ⌘K workspace spotlight search
│   ├── db/                            # Database Schema & Migration Engine
│   │   ├── schema.ts                  # Drizzle ORM schema defining 28 PostgreSQL tables
│   │   ├── base-schema-statements.json# 93 idempotent SQL DDL statements for base schema
│   │   └── migrate.ts                 # Two-layer migration runner with session advisory lock
│   └── lib/                           # Server & Client Libraries
│       ├── account-deletion.ts        # Atomic transaction account deletion workflow
│       ├── account-events.ts          # Welcome, verification, linking, and calendar notifications
│       ├── auth.ts                    # scrypt password hashing, session cookies, rate limits
│       ├── oauth.ts                   # Google & GitHub OAuth exchange with PKCE & state cookies
│       ├── email/                     # Transactional email design system, templates & mailer
│       │   ├── design-system.ts       # HTML table layout engine, Outlook VML, responsive CSS
│       │   ├── templates.ts           # 6 transactional email builders
│       │   └── mailer.ts              # SMTP transport, single-send welcome logic & rollback
│       ├── google.ts & calendar-sync.ts# Google OAuth, token refresh & calendar synchronization
│       └── reminder-processor.ts      # Quiet hours, reminder scheduling, and delivery history
├── drizzle/                           # Ordered Drizzle SQL migrations (0000 to 0008)
├── public/
│   ├── screenshots/                   # Real application captures (1440 × 1000 optimized PNGs)
│   └── fonts/                         # Licensed web fonts (Folio Sans & Folio Editorial)
├── scripts/                           # Database & Testing Operator Scripts
│   ├── init-database.mjs              # Base schema & migration runner (Layer 1 + Layer 2)
│   ├── verify-schema.mjs              # Read-only schema verification against schema.ts
│   ├── screenshots.mjs                # Playwright pipeline for automated screenshot generation
│   ├── test-auth-local.mjs            # Authentication, session, and CSRF integration test suite
│   ├── test-account-deletion.mjs      # Account deletion & cascading integrity test suite
│   └── test-vip-experience.mjs        # Email templates, preview studio & onboarding test suite
├── package.json
└── next.config.ts
```

---

## Screenshot Gallery & Visual Tour

All screenshots are captured from the actual running application using Playwright in an isolated database environment:

| Screen | Description | File |
| --- | --- | --- |
| **Main Dashboard** | Welcome header, weekly focus ring, priority tasks, deadlines, and recent activity | `public/screenshots/dashboard.png` |
| **Projects Overview** | Multi-category project cards with custom colors, categories, and milestone progress | `public/screenshots/projects.png` |
| **Project Details** | Dedicated project workspace with checkpoint milestones, linked tasks, and notes | `public/screenshots/project-details.png` |
| **Kanban Task Board** | To Do, In Progress, In Review, and Done columns with drag-and-drop cards | `public/screenshots/tasks-board.png` |
| **Task List** | High-density task view with multi-select bulk actions, due chips, and project badges | `public/screenshots/tasks-list.png` |
| **Task Calendar** | Agenda timeline laying out tasks and project deadlines across the week | `public/screenshots/tasks-calendar.png` |
| **Calendar Sync** | Google Calendar integration showing external meetings beside Folio deadlines | `public/screenshots/calendar.png` |
| **Idea Board** | Fleeting thought capture with stages (Just an idea, Exploring, Ready to start) | `public/screenshots/ideas.png` |
| **Analytics & Insights** | Task completion velocity, weekly goal trends, and overdue metrics | `public/screenshots/analytics.png` |
| **Folio AI Assistant** | Local-first on-device WebGPU assistant with transparent action plan previews | `public/screenshots/folio-ai.png` |

---

## Core Features

### Unified Workspace & First-Login Concierge
- **Empty State Integrity:** A new workspace starts clean and private without dummy pre-filled clutter.
- **First-Login Concierge:** Interactive 4-step checklist on `/overview` (*Shape your workspace rhythm*, *Create your first project*, *Add one actionable next step*, *Park an idea for later*) that updates live as real items are created and can be persistently dismissed.

### Project Management & Milestone Checkpoints
- Custom categories (*Personal*, *Product*, *Engineering*, *Marketing*, *Client work*).
- Custom color tokens (*violet*, *green*, *peach*, *blue*, *yellow*, *pink*) and icons.
- Checkpoint milestones that compute project completion velocity in real time.

### Kanban, High-Density Lists & Task Calendar
- Fluid Kanban board with keyboard shortcuts (`N` for new project, `T` for task, `I` for idea).
- Density toggle (*Comfortable* vs. *Compact*).
- Multi-select bulk actions: mark complete, change status, reschedule, or batch delete.

### Google Calendar Bidirectional Sync
- Read-only calendar visibility by default; event creation is an optional write scope.
- Encrypted refresh and access tokens at rest with **AES-256-GCM**.
- Incremental delta sync using Google sync tokens.

### Idea Board with One-Click Conversion
- Capture ideas before you organize them.
- Stages: *Just an idea*, *Exploring*, and *Ready to start*.
- One-click **"Make it a project"** converts an idea into a full project with notes intact.

### Local-First On-Device AI (WebLLM)
- Powered by `@mlc-ai/web-llm` running directly inside the browser using WebGPU.
- **Zero Cloud Leakage:** Prompts, responses, and workspace context never leave your device.
- **Verified Action Plans:** When AI prepares workspace changes, you inspect the exact proposed plan before confirming execution.
- **Reliable Long-Running Tasks (No 3-Minute Cutoff):** Complex prompts and multi-step workspace plans are never killed by a fixed 180-second timer. A background task manager (`src/lib/folio-ai/task-manager.ts`) and PostgreSQL task table (`folio_ai_tasks`) persist task status (`queued`, `running`, `waiting`, `completed`, `failed`, `cancelled`), execution stages, periodic heartbeats, reservation lease renewals, and intermediate partial output across in-app navigation and page refreshes.
- 50 messages/day allowance tracked via database reservations.

### Contextual Notifications & Quiet Hours
- Customizable reminder timings (15m, 30m, 1h, 1d before, custom local time).
- Configurable quiet hours holding reminders until your morning begins.
- In-app notification center with categorized tabs (*Task*, *Project*, *Deadline*, *Calendar*, *Account*).

### Complete Secure Account Deletion
- Located in `Settings` → `Account` → `Danger Zone` → `Delete account...`.
- Re-authenticates with current password (for password users) and requires typing confirmation email.
- Atomically deletes all user-owned records across all 25 PostgreSQL tables within a single database transaction.
- Revokes external Google Calendar tokens and destroys active sessions.

### VIP Transactional Email Design System
- Built with email-client-compatible HTML tables, Outlook VML `<v:roundrect>` buttons, responsive CSS, and zero external image dependencies.
- 6 complete transactional templates: Welcome, Email Verification, Password Reset, Password Changed, Provider Linked, and Calendar Connected.
- Local preview studio at `/dev/emails`.

---

## Quickstart & Local Installation

### Prerequisites
- **Node.js** 20.x or 22.x
- **PostgreSQL** 15+ (local instance or [Neon](https://neon.tech))

### 1. Clone & Install Dependencies
```sh
git clone https://github.com/PratikPrasad1813/Folio.git
cd Folio
npm install
```

### 2. Configure Environment Variables
Create a `.env.local` file in the project root (see [Environment Variables Reference](#environment-variables-reference)):
```sh
cp .env.example .env.local
```

### 3. Initialize the Database
Folio's database initializes in two ordered layers (Base Application Schema + Drizzle Migrations):
```sh
npm run db:init
npm run db:verify
```

### 4. Start Development Server
```sh
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Environment Variables Reference

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | PostgreSQL connection URL (e.g. `postgresql://user:pass@ep-xyz.neon.tech/neondb` or `postgresql://postgres:postgres@127.0.0.1:5432/app_db`) |
| `APP_URL` | **Yes** | Canonical public origin (`http://localhost:3000` in dev, `https://folio-management-studio.onrender.com` in production) |
| `NEXT_PUBLIC_APP_URL` | Optional | Same public origin as `APP_URL`; used by client-side integrations |
| `FOLIO_ENCRYPTION_KEY` | **Yes** (prod) | 32+ character secret for AES-256-GCM token encryption (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth client ID for sign-in & Google Calendar |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth client secret |
| `GITHUB_CLIENT_ID` | Optional | GitHub OAuth client ID for sign-in |
| `GITHUB_CLIENT_SECRET` | Optional | GitHub OAuth client secret |
| `SMTP_URL` | Optional | Authenticated TLS SMTP connection URL (e.g. `smtps://user:pass@smtp.mail.com:465`) |
| `SMTP_FROM` | Optional | Sender identity (e.g. `Folio <hello@folio.studio>`). Must use a domain verified with your provider. |
| `NEXT_PUBLIC_EMAIL_FEATURES_ENABLED` | Optional | `true` shows email verification and password-recovery UI. Defaults to `false`. Frontend only; inlined at build time, so never put secrets in it. See [Email configuration](#email-configuration--preview-studio). |
| `FOLIO_CRON_SECRET` | Optional | Bearer secret for scheduled reminder runner endpoint (`/api/notifications/process`) |
| `FOLIO_SCREENSHOT_MODE` | Automation | Set to `local` only when running `npm run screenshots` |
| `SCREENSHOT_DATABASE_URL`| Automation | Dedicated loopback test database URL for screenshot pipeline (`folio_screenshots`) |
| `FOLIO_EMAIL_PREVIEW` | Optional | Set to `1` in production to inspect `/dev/emails` (enabled automatically in dev) |

---

## Database Setup & Migrations

Folio connects to PostgreSQL using Drizzle ORM and node-postgres (`pg`).

### Two-Layer Initialisation
1. **Layer 1: Base Application Schema** (`src/db/base-schema-statements.json`): 93 idempotent DDL statements creating the 16 original base tables (`folio_users`, `folio_projects`, `folio_tasks`, `folio_google_accounts`, etc.).
2. **Layer 2: Drizzle Migration Journal** (`drizzle/`): 9 incremental migrations (`0000_search_and_filters.sql` through `0008_vip_experience.sql`).

### Available Commands
```sh
npm run db:init      # Idempotently executes Layer 1 + Layer 2 with an advisory lock
npm run db:migrate   # Alias for db:init, suitable for deployment hooks
npm run db:verify    # Read-only verification comparing PostgreSQL against src/db/schema.ts
```

---

## Authentication & Account Management

Folio features a **self-managed authentication architecture**:
- **Password Security:** Scrypt password hashing with high-entropy random salts (`salt:hex-key`). Passwords are never stored in plaintext.
- **Session Architecture:** 64-character cryptographic tokens. Only the SHA-256 hash of the token is stored in `folio_sessions`. Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- **OAuth Providers:** Google and GitHub OAuth 2.0 with PKCE (`S256` code challenge) and state cookies. Both providers request the account picker (`select_account`) on every sign-in to prevent accidental cross-account session reuse.
- **Account Linking:** Linking Google or GitHub in Settings requires an active verified session and matching verified email. Silent cross-provider email hijacking is strictly prevented.
- **Email Verification:** 24-hour expiring single-use links (`/verify-email#token=...`) stored as SHA-256 hashes.
- **Password Recovery:** 30-minute expiring single-use links (`/recover#token=...`) stored as SHA-256 hashes. Password resets automatically revoke all existing sessions.

---

## Account Deletion & Data Lifecycle

Folio provides a fully functional, privacy-first account deletion workflow directly in the application.

### User Flow
1. Navigate to **Settings** → **Account** → **Danger Zone** → **Delete account...**.
2. A modal details the permanence of the action and itemizes all categories of data being erased.
3. **Re-Authentication:**
   - Password accounts require entering the current password.
   - Pure OAuth accounts require confirming their account email address.
4. **Confirmation Phrase:** The user must explicitly type their account email address or `"delete my account"`.
5. Upon confirmation, `DELETE /api/account` executes. The user session is destroyed and the browser redirects to `/?deleted=account_deleted`.

### Server-Side Integrity & Isolation
- **Endpoint:** `DELETE /api/account` (and `DELETE /api/profile`).
- **Authorization:** Authenticated directly from session cookie. Client-supplied user IDs are completely ignored.
- **CSRF & Rate Limiting:** Enforces `sameOrigin(request)` and rate limits deletion attempts.
- **Token Revocation:** Automatically revokes external Google Calendar OAuth tokens before deletion.
- **Single Database Transaction:** Deletes records from all 25 user-owned tables in dependency order, followed by the user row in `folio_users`.
- **Zero Orphaned Data:** Every query is strictly filtered by `WHERE userId = user.id`. No other user's records can ever be affected.
- **Session Destruction:** Deletes database sessions and wipes the `folio_session` cookie. Old session tokens receive `401 Unauthorized` immediately.

---

## Google Calendar Integration Setup

To enable Google Calendar sync:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable the **Google Calendar API**.
3. Create an **OAuth 2.0 Client ID** (Web application).
4. Add the following **Authorized redirect URI**:
   ```
   https://folio-management-studio.onrender.com/api/integrations/google/callback
   ```
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your environment.
6. When connected, refresh tokens are sealed with `AES-256-GCM` using `FOLIO_ENCRYPTION_KEY`.

---

## GitHub OAuth Setup

To enable GitHub sign-in:

1. In GitHub, go to **Settings** → **Developer Settings** → **OAuth Apps** → **New OAuth App**.
2. Set the **Authorization callback URL**:
   ```
   https://folio-management-studio.onrender.com/api/auth/oauth/github/callback
   ```
3. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in your environment.

---

## Email Configuration & Preview Studio

### Current status: email features are paused in the interface

Until a verified SMTP sender is configured for the Render deployment, the frontend hides its email-dependent features behind `NEXT_PUBLIC_EMAIL_FEATURES_ENABLED` (default `false`):

| Hidden or replaced while disabled | Still implemented in the backend |
| --- | --- |
| "Forgot your password?" on sign-in, and the recovery request form | Recovery token issuance and single-use validation (`/api/auth/recovery`) |
| Verification prompts, "Send verification link" and "Verify email address" | Verification token issuance and 24-hour single-use validation (`/api/auth/verify`) |
| The `/recover` and `/verify-email` completion pages | SMTP transport (Nodemailer), email templates, and the `/dev/emails` preview studio |
| The email status chip in Settings | The `email_verified_at` column and migrations `0007` and `0008` |

Email/password sign-in, Google and GitHub sign-in, existing sessions, and protected routes are unaffected, and no feature requires a verified email address. Verification is never inferred from the flag or from the sign-in provider. See [AUTHENTICATION.md](AUTHENTICATION.md#email-features-paused-in-the-interface) for the full rules.

To re-enable:

1. Configure an SMTP provider (Resend example below) and confirm a real delivery on a staging deployment.
2. Set `NEXT_PUBLIC_EMAIL_FEATURES_ENABLED=true` in the **build** environment and redeploy. The value is inlined when the app is built, so a change needs a new build.
3. Test the forgot-password link, a verification email, and a password reset end to end with a real mailbox.

### Resend (SMTP relay)

Folio sends mail through standard SMTP (Nodemailer). It has no Resend-specific SDK code, so Resend works through its SMTP relay:

```sh
SMTP_URL="smtps://resend:re_your_api_key@smtp.resend.com:465"
SMTP_FROM="Folio <hello@mail.your-domain.example>"
```

- Host `smtp.resend.com`. Port `465` (implicit TLS) or `587` (STARTTLS).
- Username is the literal string `resend`. Password is your Resend API key (starts with `re_`).
- Resend requires a domain you own, verified with DKIM and SPF DNS records (DMARC recommended). The `SMTP_FROM` address must use that verified domain.
- Set these as server environment variables only (never as `NEXT_PUBLIC_*`).

### SMTP Setup
To deliver real transactional emails, provide an authenticated TLS SMTP URL:
```sh
SMTP_URL="smtps://username:password@smtp.example.com:465"
SMTP_FROM="Folio <hello@your-domain.example>"
```
When SMTP is unconfigured, Folio skips email delivery gracefully without failing user registration or password reset flows.

### Local Preview Studio (`/dev/emails`)
Folio includes an interactive Email Preview Studio enabled in local development:
- Open [http://localhost:3000/dev/emails](http://localhost:3000/dev/emails).
- Switch across all 6 transactional templates.
- Toggle between **Desktop (640px)**, **Mobile (375px)**, **Plain text**, and **Client & CTA audit**.
- Test recipient edge cases: standard name, missing name, long name, and special characters.

---

## Testing Suite

Folio includes comprehensive automated test suites running against an isolated loopback test database:

```sh
# 1. Authentication, Sessions, OAuth, and CSRF tests
FOLIO_SCREENSHOT_MODE=local \
SCREENSHOT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/folio_screenshots' \
npm run test:auth

# 2. Account Deletion, Token Revocation, Cascading Cleanup, and Isolation tests
FOLIO_SCREENSHOT_MODE=local \
SCREENSHOT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/folio_screenshots' \
npm run test:account-deletion

# 3. Email Templates, Preview Studio, and Onboarding Journey tests
FOLIO_SCREENSHOT_MODE=local \
SCREENSHOT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/folio_screenshots' \
node scripts/test-vip-experience.mjs

# 4. Email feature flag: disabled and re-enabled states, generic errors, and auth intact
FOLIO_SCREENSHOT_MODE=local \
SCREENSHOT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/folio_screenshots' \
npm run test:email-flag
```

---

## Automated Screenshot Pipeline

To refresh the real application screenshots used across the public landing page:

```sh
# 1. Install Chromium for Playwright (if not already installed)
npx playwright install chromium

# 2. Run the automated screenshot command
FOLIO_SCREENSHOT_MODE=local \
SCREENSHOT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/folio_screenshots' \
npm run screenshots
```
This command:
1. Verifies the target database is a dedicated local database named `folio_screenshots`.
2. Starts an isolated Next.js development server on a dynamic port.
3. Creates a temporary demo user, seeds realistic workspace data, and generates a session.
4. Navigates through all 10 views and captures desktop viewport screenshots (1440 × 1000).
5. Optimizes and saves the images to `public/screenshots/`.
6. Verified scoped cleanup removes the temporary demo user and all owned records.

---

## Production Deployment

### Render Deployment
1. Create a Render Web Service connected to the GitHub repository `https://github.com/PratikPrasad1813/Folio`.
2. Set the build command to `npm install && npm run build` and the start command to `npm run start`.
3. Configure environment variables in the Render Dashboard:
   - `DATABASE_URL` — Neon PostgreSQL connection string.
   - `APP_URL` and `NEXT_PUBLIC_APP_URL` — `https://folio-management-studio.onrender.com`.
   - `FOLIO_ENCRYPTION_KEY` — 32+ character random secret.
   - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` (optional).
   - `GITHUB_CLIENT_ID` & `GITHUB_CLIENT_SECRET` (optional).
   - `SMTP_URL` & `SMTP_FROM` (optional).
   - `FOLIO_CRON_SECRET` (optional).

### Node.js / Docker
```sh
npm install
npm run db:init
npm run build
npm run start
```

---

## Troubleshooting Guide

| Issue | Cause | Solution |
| --- | --- | --- |
| `relation "folio_users" does not exist` | Ran raw Drizzle migration without base schema | Run `npm run db:init` to apply Layer 1 base schema followed by Layer 2 migrations. |
| `Screenshot safety check failed` | Target is remote Neon DB or matches `DATABASE_URL` | Screenshots must run with `FOLIO_SCREENSHOT_MODE=local` and a dedicated database named `folio_screenshots`. |
| `Cannot access WebGPU` | Browser lacks WebGPU support | Use a modern browser (Chrome 113+, Edge) with hardware acceleration enabled. The rest of Folio works normally without AI. |
| Google Calendar says `Not configured` | Client ID / Secret missing | Provide `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and register redirect URI in Google Cloud Console. |
| Verification or recovery link is missing | Frontend flag is off, or SMTP is not configured | Email actions are hidden while `NEXT_PUBLIC_EMAIL_FEATURES_ENABLED` is not `true`. To deliver mail, set `SMTP_URL` and `SMTP_FROM` with a verified sending domain, then enable the flag and rebuild. |
| Recovery or verification shows "temporarily unavailable" | Delivery not configured on this server | Expected while the flag is off or SMTP is absent. Users see a calm notice; technical details stay in server logs only. |


---

## Contributing & Security Reporting

Contributions are welcome! Please check the GitHub repository:
- **Repository:** [https://github.com/PratikPrasad1813/Folio](https://github.com/PratikPrasad1813/Folio)
- **Issues:** [https://github.com/PratikPrasad1813/Folio/issues](https://github.com/PratikPrasad1813/Folio/issues)
- **Pull Requests:** [https://github.com/PratikPrasad1813/Folio/pulls](https://github.com/PratikPrasad1813/Folio/pulls)

### Security Reporting
If you discover a potential security vulnerability, please report it responsibly by opening a confidential security advisory on GitHub or contacting the repository maintainers. Never open public issues containing sensitive credentials or exploitable payloads.

---

## License Information

This repository currently does not include a standalone open-source license file. All rights are reserved by the project author unless explicitly stated otherwise. Check the repository for updates on licensing.
