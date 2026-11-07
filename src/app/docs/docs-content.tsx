import { DocsCodeBlock as CodeBlock } from "@/components/docs-code-block";
import { DocsExperience } from "@/components/docs-experience";

export const chapters = [
  {
    id: "architecture",
    title: "1. Architecture & philosophy",
    sections: [
      ["philosophy", "Less switching, more doing"],
      ["system-map", "System map"],
      ["workspace-runtime", "Workspace runtime"],
      ["api-contracts", "HTTP contracts"],
    ],
  },
  {
    id: "database",
    title: "2. Environment & database",
    sections: [
      ["environment", "Environment variables"],
      ["schema", "Core Drizzle schema"],
      ["migrations", "Migration lifecycle"],
    ],
  },
  {
    id: "security",
    title: "3. Authentication & deep links",
    sections: [
      ["sessions", "Sessions and credentials"],
      ["web-oauth", "Google and GitHub OAuth"],
      ["desktop-auth", "Desktop protocol handoff"],
    ],
  },
  {
    id: "productivity",
    title: "4. Productivity engines",
    sections: [
      ["projects-milestones", "Projects and milestones"],
      ["task-management", "Kanban and dense task lists"],
      ["ideas", "Idea incubation"],
    ],
  },
  {
    id: "calendar-sync",
    title: "5. Google Calendar sync",
    sections: [
      ["google-setup", "Google Cloud setup"],
      ["sync-engine", "Incremental synchronization"],
      ["sync-resilience", "Errors and recovery"],
    ],
  },
  {
    id: "ai",
    title: "6. Folio AI & local models",
    sections: [
      ["ambient-ai", "Context and trust boundaries"],
      ["prompt-design", "Planning prompts"],
      ["local-models", "WebLLM and local endpoints"],
      ["quality-workflow", "Optional quality models"],
    ],
  },
  {
    id: "desktop",
    title: "7. Tauri desktop client",
    sections: [
      ["tauri-architecture", "Native shell architecture"],
      ["tauri-config", "Configuration reference"],
      ["desktop-packaging", "Build, signing, release"],
    ],
  },
] as const;

const schemaCode = `import { sql } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, pgTable, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import type { PersonalPreferences } from "@/lib/personalization";

export const users = pgTable("folio_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  provider: text("provider").notNull().default("email"),
  weeklyGoal: integer("weekly_goal").notNull().default(12),
  authUserId: text("auth_user_id"),
  personal: jsonb("personal").$type<Partial<PersonalPreferences>>().notNull().default({}),
  onboardingStep: integer("onboarding_step").notNull().default(0),
  onboardingVersion: integer("onboarding_version").notNull().default(1),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  welcomeEmailSentAt: timestamp("welcome_email_sent_at", { withTimezone: true }),
  guideDismissedAt: timestamp("guide_dismissed_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("folio_users_auth_user_id_idx").on(table.authUserId),
]);

export const sessions = pgTable("folio_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
});

export const projects = pgTable("folio_projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("Planning"),
  priority: text("priority").notNull().default("Medium"),
  color: text("color").notNull().default("violet"),
  icon: text("icon").notNull().default("layout"),
  category: text("category").notNull().default("Personal"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  favorite: boolean("favorite").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("folio_projects_user_idx").on(table.userId),
  index("folio_projects_filter_idx").on(table.userId, table.archived, table.status, table.dueDate),
  index("folio_projects_search_idx").using("gin", sql\`to_tsvector('simple', \${table.name} || ' ' || \${table.description} || ' ' || \${table.category})\`),
]);

export const milestones = pgTable("folio_milestones", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  dueDate: text("due_date"),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("folio_milestones_user_idx").on(table.userId),
  index("folio_milestones_project_idx").on(table.projectId),
]);

export const tasks = pgTable("folio_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("todo"),
  completed: boolean("completed").notNull().default(false),
  priority: text("priority").notNull().default("Medium"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  labels: text("labels").array().notNull(),
  estimateMinutes: integer("estimate_minutes"),
  notes: text("notes").notNull().default(""),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("folio_tasks_user_idx").on(table.userId),
  index("folio_tasks_filter_idx").on(table.userId, table.status, table.dueDate),
  index("folio_tasks_project_progress_idx").on(table.userId, table.projectId, table.completed),
  index("folio_tasks_search_idx").using("gin", sql\`to_tsvector('simple', \${table.title} || ' ' || \${table.description} || ' ' || \${table.notes})\`),
]);

export const subtasks = pgTable("folio_subtasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("folio_subtasks_user_idx").on(table.userId),
  index("folio_subtasks_task_idx").on(table.taskId),
]);

export const ideas = pgTable("folio_ideas", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("Personal"),
  color: text("color").notNull().default("yellow"),
  status: text("status").notNull().default("Just an idea"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("folio_ideas_user_idx").on(table.userId),
  index("folio_ideas_search_idx").using("gin", sql\`to_tsvector('simple', \${table.title} || ' ' || \${table.description} || ' ' || \${table.category})\`),
]);

export const googleAccounts = pgTable("folio_google_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  googleUserId: text("google_user_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  picture: text("picture"),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessTokenEnc: text("access_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  scopes: text("scopes").array().notNull().default([]),
  writeEnabled: boolean("write_enabled").notNull().default(false),
  connectionError: text("connection_error"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status").notNull().default("never"),
  lastSyncDetail: jsonb("last_sync_detail"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("folio_google_accounts_user_idx").on(table.userId),
]);

export const googleCalendars = pgTable("folio_google_calendars", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => googleAccounts.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  calendarId: text("calendar_id").notNull(),
  summary: text("summary").notNull().default(""),
  description: text("description").notNull().default(""),
  backgroundColor: text("background_color"),
  primary: boolean("primary").notNull().default(false),
  selected: boolean("selected").notNull().default(true),
  visible: boolean("visible").notNull().default(true),
  syncToken: text("sync_token"),
  lastSyncedAt: timestamp("last_synced_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("folio_google_calendars_unique_idx").on(table.accountId, table.calendarId),
  index("folio_google_calendars_user_idx").on(table.userId),
]);

export const googleEvents = pgTable("folio_google_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => googleAccounts.id, { onDelete: "cascade" }),
  calendarId: text("calendar_id").notNull(),
  googleEventId: text("google_event_id").notNull(),
  recurringEventId: text("recurring_event_id"),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  location: text("location").notNull().default(""),
  startAt: timestamp("start_at"),
  endAt: timestamp("end_at"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  allDay: boolean("all_day").notNull().default(false),
  timezone: text("timezone"),
  status: text("status").notNull().default("confirmed"),
  htmlLink: text("html_link"),
  organizer: text("organizer"),
  attendees: integer("attendees").notNull().default(0),
  etag: text("etag"),
  googleUpdatedAt: timestamp("google_updated_at"),
  localDirty: boolean("local_dirty").notNull().default(false),
  localUpdatedAt: timestamp("local_updated_at"),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("folio_google_events_unique_idx").on(table.accountId, table.googleEventId),
  index("folio_google_events_user_idx").on(table.userId),
  index("folio_google_events_task_idx").on(table.taskId),
  index("folio_google_events_start_idx").on(table.startAt),
]);`;

const apiContracts = `GET /api/workspace
  200 { user, projects, tasks, subtasks, ideas, milestones, activities }
  401 { error }

POST | PATCH | DELETE /api/workspace
  Request: { kind: "projects" | "tasks" | "milestones" | "subtasks" | "ideas",
             id?: UUID, data?: object, action?: "convert", ids?: UUID[] }
  Success: { item, activity, projects, tasks, subtasks }
  Invalid input: 400 { error }; cross-origin: 403 { error }; missing item: 404

POST /api/auth
  Request: { action: "login" | "register", email, password, name?, next? }
  Success: { user }; session cookie is HTTP-only

GET /api/auth/session
  200 { user } | 401 { error }

GET /api/auth/oauth/google
GET /api/auth/oauth/github
  Redirects to provider consent; accepts safe next=... and desktop=1

GET /api/auth/oauth/{provider}/callback
  Validates provider state + browser cookie, exchanges code with PKCE,
  creates web session or a short-lived desktop handoff.

GET  /api/integrations/google
GET  /api/integrations/google/connect
GET  /api/integrations/google/callback
GET  /api/integrations/google/calendars
POST /api/integrations/google/calendars
POST /api/integrations/google/events
PUT  /api/integrations/google/events
POST /api/integrations/google/sync[?full=1]
  Authenticated routes return JSON; mutating routes enforce same-origin checks.

POST /api/auth/desktop/exchange
  Request: { code: 64 lowercase hexadecimal characters }
  Success: { destination }; the one-time code is consumed atomically.`;

const environmentExample = `# Required by src/db/index.ts; local example only.
DATABASE_URL=postgresql://folio:folio@localhost:5432/folio

# Generate a unique secret with: openssl rand -hex 32
# Use the generated value here; never commit this file.
FOLIO_ENCRYPTION_KEY=

# Public canonical app origin. Set APP_URL in production and use HTTPS.
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# OAuth is optional during local development. Add the credentials from each
# provider console to enable its sign-in or calendar integration.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Calendar callback override is useful behind proxies; otherwise Folio derives
# /api/integrations/google/callback from the request origin.
GOOGLE_REDIRECT_URI=

# Optional operational settings
SMTP_URL=
SMTP_FROM=
FOLIO_CRON_SECRET=`;

const sessionCode = `import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";

const scryptAsync = promisify(scrypt);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "folio_session";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64) as Buffer;
  return \`\${salt}:\${key.toString("hex")}\`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hash, extra] = stored.split(":");
  if (extra || !/^[a-f0-9]{32}$/i.test(salt || "") ||
      !/^[a-f0-9]{128}$/i.test(hash || "")) return false;
  const candidate = await scryptAsync(password, salt, 64) as Buffer;
  return timingSafeEqual(Buffer.from(hash, "hex"), candidate);
}

export async function createSession(userId: string) {
  await destroySession();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  jar.set(SESSION_COOKIE, "", {
    ...cookieOptions(new Date(0)),
    maxAge: 0,
  });
}`;

const tauriConfig = `{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/tooling/cli/schema.json",
  "productName": "Folio",
  "version": "1.0.0",
  "identifier": "com.folio.workspace",
  "build": {
    "beforeBuildCommand": "",
    "beforeDevCommand": "",
    "frontendDist": "../public",
    "devUrl": "http://localhost:3000"
  },
  "app": {
    "windows": [{
      "title": "Folio - Management Studio",
      "width": 1280,
      "height": 820,
      "minWidth": 900,
      "minHeight": 600,
      "resizable": true,
      "fullscreen": false,
      "theme": "Dark",
      "url": "https://folio-management-studio.onrender.com/overview"
    }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png",
      "icons/icon.icns", "icons/icon.ico"
    ],
    "android": { "debugApplicationIdSuffix": ".debug" }
  },
  "plugins": { "deep-link": { "desktop": { "schemes": ["folio"] } } }
}`;

const rustDeepLink = `#[cfg(desktop)]
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(
      |app, args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.show();
          let _ = window.unminimize();
          let _ = window.set_focus();
          if let Some(url) = args.iter().find(|arg| arg.starts_with("folio://")) {
            let _ = app.emit("deep-link://new-url", vec![url.clone()]);
          }
        }
      },
    ));
  }
  builder
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      #[cfg(all(debug_assertions, any(target_os = "linux", target_os = "windows")))]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link().register_all()?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}`;

const desktopListener = `"use client";

import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";

export function DesktopDeepLinkListener() {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const handledCodes = new Set<string>();

    const exchangeCode = async (code: string) => {
      if (handledCodes.has(code)) return;
      handledCodes.add(code);
      try {
        const response = await fetch("/api/auth/desktop/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await response.json() as { destination?: string; error?: string };
        if (!response.ok || !data.destination) {
          throw new Error(data.error || "Desktop sign-in could not be completed.");
        }
        window.location.assign(data.destination);
      } catch (error) {
        console.error("Desktop sign-in exchange failed.", error);
        window.location.assign(
          \`/login?error=\${encodeURIComponent("Desktop sign-in could not be completed. Please try again.")}\`,
        );
      }
    };

    const handleUrls = (urls: string[]) => {
      for (const rawUrl of urls) {
        try {
          const url = new URL(rawUrl);
          const code = url.searchParams.get("code");
          if (url.protocol === "folio:" && url.hostname === "auth" &&
              code && /^[a-f0-9]{64}$/.test(code)) {
            void exchangeCode(code);
          }
        } catch (error) {
          console.error("Could not parse a Folio sign-in link.", error);
        }
      }
    };

    void (async () => {
      const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
      unlisten = await onOpenUrl(handleUrls);
      if (disposed) { unlisten(); return; }
      const currentUrls = await getCurrent();
      if (currentUrls) handleUrls(currentUrls);
    })().catch((error: unknown) => {
      console.error("Could not initialize Folio deep-link handling.", error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return null;
}`;

const Callout = ({
  kind,
  title,
  children,
}: {
  kind: "Note" | "Warning" | "Tip";
  title: string;
  children: React.ReactNode;
}) => {
  const tones = {
    Note: "border-sky-400/40 bg-sky-400/[0.07] text-sky-100",
    Warning: "border-amber-400/40 bg-amber-400/[0.07] text-amber-100",
    Tip: "border-violet-400/40 bg-violet-400/[0.07] text-violet-100",
  };
  return (
    <aside className={`my-6 rounded-xl border-l-2 px-5 py-4 ${tones[kind]}`}>
      <strong className="mb-1 block text-sm">{kind}: {title}</strong>
      <div className="text-sm leading-7 text-slate-300">{children}</div>
    </aside>
  );
};

function ChapterTitle({ number, title, lead }: { number: string; title: string; lead: string }) {
  return (
    <header className="mb-10 border-b border-slate-800 pb-8">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">
        Chapter {number}
      </p>
      <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 max-w-3xl text-base leading-8 text-slate-400">{lead}</p>
    </header>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mb-4 scroll-mt-24 text-xl font-semibold tracking-tight text-white">
      {children}
    </h3>
  );
}

export type ChapterId = (typeof chapters)[number]["id"];

export function DocsChapterContent({ chapterId }: { chapterId: ChapterId }) {
  return (
    <DocsExperience key={chapterId} chapters={chapters} activeChapterId={chapterId}>
        <main className="min-w-0">
          <article className="space-y-24">
            {chapterId === "architecture" && (
            <section id="architecture" className="scroll-mt-24">
              <ChapterTitle number="01" title="Architecture, Philosophy & Unified Workspace Engine" lead="Folio puts the information and actions needed for a personal workday into one coherent workspace. Its architectural center is a server-owned, user-scoped data model with a responsive client that can render multiple ways of working over the same entities." />
              <SectionTitle id="philosophy">Less switching, more doing</SectionTitle>
              <p className="leading-8">The product thesis is “Less switching, more doing.” A common workday spreads planning across a notes tool, an issue tracker, a calendar, and an AI chat. The resulting four-tab productivity tax is not only the time to change windows: it is the repeated cost of re-establishing context, reconciling dates, and deciding which copy of a plan is authoritative. Folio combines projects, tasks, milestones, ideas, calendar events, and an optional AI assistant around a single personal workspace.</p>
              <p className="mt-4 leading-8">This is a product boundary, not a claim that every external tool disappears. Google Calendar remains an integration; the app’s workspace remains the canonical home for Folio project and task data. External event mirrors add schedule context without turning a calendar provider into a source of project status. The interface favors progressive disclosure: a high-level overview for orientation, project views for outcomes, Kanban and list surfaces for execution, and an idea inbox for uncommitted thoughts.</p>
              <Callout kind="Tip" title="Keep one source of truth per responsibility">
                A project owns scope and health; a task owns execution state; a milestone groups deliverables; a Google mirror owns provider event identity and sync state. Cross-link those records rather than duplicating their lifecycles.
              </Callout>

              <SectionTitle id="system-map">System map</SectionTitle>
              <p className="mb-4 leading-8">The diagram separates browser rendering, server-side application logic, persistence, external OAuth/calendar services, and the optional desktop host. Next.js 16 and React Server Components support server rendering; client components handle interactions that need browser state. Turbopack is available through the Next.js development/build toolchain, not a separate data service.</p>
              <CodeBlock language="architecture diagram" code={`┌────────────────────────────── Folio client ──────────────────────────────┐
│ Browser: React 19 / Next.js 16 App Router                                │
│ Server Components + route handlers     Client Components + local state  │
│        │ workspace/API requests                     │ UI events          │
└────────┼────────────────────────────────────────────┼───────────────────┘
         ▼                                            │
┌──────────────────────── Next.js server ──────────────┼───────────────────┐
│ Auth/session boundary · route handlers · domain logic · Drizzle ORM     │
│ Validation · user ownership filters · transactions · integrations       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ SQL
                               ▼
                     ┌─────────────────────┐
                     │ PostgreSQL          │
                     │ Folio-owned tables  │
                     │ Drizzle migrations  │
                     └─────────────────────┘

Google OAuth / Calendar API ◄──── encrypted server-side integration
Browser WebGPU + WebLLM      ◄──── local inference; account history and quota sync through Folio APIs

┌──────────────────────── Tauri v2 desktop ───────────────────────────────┐
│ Rust host + native WebView (WebView2 / WKWebView / WebKitGTK)           │
│ Deep-link plugin + single-instance focus → hosted Folio web application │
└─────────────────────────────────────────────────────────────────────────┘
                                      ▲
                       folio://auth?code=... one-time handoff`}/>
              <p className="leading-8">The deployed Tauri configuration currently points its main window to <code>https://folio-management-studio.onrender.com/overview</code>; its frontend distribution points to <code>../public</code> as a build fallback. That distinction matters: the current shell is a native wrapper around the hosted web experience, not a promise that every server route runs locally inside the desktop bundle. A production self-hosted or offline-first desktop architecture would require separate deployment and local-data decisions.</p>

              <SectionTitle id="workspace-runtime">Workspace runtime and state changes</SectionTitle>
              <p className="leading-8">The workspace loader fetches a user’s projects, tasks, subtasks, ideas, milestones, recent activities, and timezone preference in parallel. Each SQL query scopes by the authenticated user ID. The client hook maintains a typed workspace snapshot and performs interactive updates so controls can respond quickly; API success is the authority for durable state. The safe optimistic-update pattern is: capture the prior value, apply the anticipated state, send the mutation, merge the returned canonical row and related timestamps, and restore the prior value with a visible error if the request fails.</p>
              <ol className="my-5 list-decimal space-y-2 pl-6 leading-7">
                <li>Read the current session on the server; do not trust a client-supplied user ID.</li>
                <li>Load the workspace aggregate with bounded activity history and cache disabled for private responses.</li>
                <li>Apply local interaction state (selection, drag preview, filters) independently from persisted state.</li>
                <li>Mutate using the resource kind and validated payload; enforce ownership in the write predicate.</li>
                <li>Return the updated entity and side effects so the client converges on server state.</li>
              </ol>
              <p className="leading-8">The application uses route handlers for JSON APIs; do not document or introduce unimplemented server actions as if they were the current mutation interface. When adding a server action, apply the same authorization, validation, transaction, and error-surfacing rules as the existing routes.</p>

              <SectionTitle id="api-contracts">HTTP contracts and error semantics</SectionTitle>
              <p className="mb-3 leading-8">The contracts below summarize the current high-level public shape. Individual handlers may add resource-specific validation and optional fields; consult the route implementation before relying on a narrow shape in an integration.</p>
              <CodeBlock language="http contract" code={apiContracts}/>
              <Callout kind="Warning" title="User ownership is not implied by UUID secrecy">
                Every data operation must include the authenticated user predicate, even if identifiers are unguessable. Mutating JSON endpoints must reject cross-origin requests and return explicit 4xx/5xx responses rather than success-shaped empty data.
              </Callout>
              <h4 className="mt-7 text-base font-semibold text-white">Choosing the rendering boundary</h4>
              <p className="mt-3 leading-8">Keep static product explanation, legal information, and documentation on the server-rendered path wherever interaction does not require browser state. Use client components for stateful controls—drag previews, keyboard focus, local model workers, search dialogs, and theme-aware interactions—not as a blanket wrapper around data fetching. This reduces the amount of JavaScript that must hydrate and makes the server the natural place to enforce authentication before sensitive workspace data is serialized.</p>
              <p className="mt-3 leading-8">A route handler should own the HTTP boundary and delegate business rules to domain modules when a behavior is reused. Keep provider-specific payload parsing near the integration boundary, translate it to Folio’s internal types, then return a stable application shape. This avoids leaking external API naming conventions into every view. For private workspace responses, set non-cacheable response semantics unless the caching layer is explicitly keyed by authenticated identity and has been tested against cross-user leakage.</p>
              <div className="docs-request-steps my-6">
                <span>REQUEST LIFECYCLE</span>
                <ol>
                  <li><b>01</b> Session lookup</li>
                  <li><b>02</b> Validate input</li>
                  <li><b>03</b> Scope by owner</li>
                  <li><b>04</b> Commit mutation</li>
                  <li><b>05</b> Reconcile client</li>
                </ol>
              </div>
            </section>
            )}

            {chapterId === "database" && (
            <section id="database" className="scroll-mt-24">
              <ChapterTitle number="02" title="Environment Configuration, Database Schema & Migrations" lead="Folio uses PostgreSQL as the durable workspace store and Drizzle ORM as the typed query and schema layer. A base SQL bootstrap establishes original tables; the ordered Drizzle journal applies incremental changes." />
              <SectionTitle id="environment">Environment variables</SectionTitle>
              <p className="leading-8"><code>DATABASE_URL</code> is required by the PostgreSQL pool. <code>FOLIO_ENCRYPTION_KEY</code> protects persisted Google OAuth credentials and signed state; use a random, stable secret of at least 32 characters in production and keep a protected backup. Changing the key makes previously encrypted credentials unreadable and requires users to reconnect. Production OAuth-provider checks also require an HTTPS <code>APP_URL</code> and a correctly sized encryption key.</p>
              <CodeBlock language=".env.local" code={environmentExample}/>
              <div className="my-6 overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400"><tr><th className="p-3">Variable</th><th className="p-3">Purpose and handling</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {[
                      ["DATABASE_URL", "PostgreSQL connection string used by the server pool and migration tools. Keep it server-only."],
                      ["FOLIO_ENCRYPTION_KEY", "Stable secret for AES-256-GCM token sealing and HMAC state signing. Generate randomly; never expose with NEXT_PUBLIC_."],
                      ["APP_URL", "Canonical HTTPS origin in production; used by OAuth provider readiness checks and outbound URLs."],
                      ["NEXT_PUBLIC_APP_URL", "Public app origin used for selected redirect construction. Anything with this prefix is bundled for clients; never put secrets here."],
                      ["GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET", "OAuth web-client credentials used by Google Calendar connect and Google sign-in."],
                      ["GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET", "OAuth app credentials for GitHub sign-in."],
                      ["GOOGLE_REDIRECT_URI", "Optional explicit Google Calendar callback URI when proxy headers cannot provide the correct public origin."],
                      ["SMTP_URL / SMTP_FROM", "Optional mail transport and sender identity for email features."],
                      ["FOLIO_CRON_SECRET", "Optional bearer secret for protected scheduled notification processing."],
                    ].map(([name, description]) => <tr key={name}><th className="whitespace-nowrap p-3 align-top font-mono text-xs text-violet-200">{name}</th><td className="p-3 leading-6 text-slate-400">{description}</td></tr>)}
                  </tbody>
                </table>
              </div>

              <SectionTitle id="schema">Core Drizzle schema (as implemented)</SectionTitle>
              <p className="leading-8">The following is the complete Drizzle definition for the requested core records, Google account/token table, calendar cache, and event mirror, including their declared indexes. Folio names these actual tables <code>folio_google_accounts</code>, <code>folio_google_calendars</code>, and <code>folio_google_events</code> rather than generic <code>accounts</code> and <code>calendar_events</code>. The live source of truth remains <code>src/db/schema.ts</code>; that module also defines auth identities and flows, activity, reminders, notifications, AI, and auxiliary tables not duplicated in this excerpt. Dates intended as date-only values are strings in <code>YYYY-MM-DD</code> form to avoid accidental timezone shifts.</p>
              <CodeBlock language="typescript · src/db/schema.ts" code={schemaCode}/>
              <p className="leading-8">A few schema choices are deliberate. Projects and tasks carry <code>userId</code> so reads and writes can enforce tenant ownership. Removing a user cascades through user-owned records. Removing a project or milestone leaves its tasks intact by nulling the optional link; removing a task removes its subtasks. Task status has four application values (<code>todo</code>, <code>in_progress</code>, <code>in_review</code>, <code>done</code>) and the legacy boolean <code>completed</code> is kept consistent by application logic. Ordering belongs to subtask rows via <code>position</code>; Kanban columns are status buckets, not separately persisted column records.</p>
              <Callout kind="Note" title="Additional schema details">
                Calendar state is spread across <code>folio_google_accounts</code>, <code>folio_google_calendars</code>, and <code>folio_google_events</code>. Each provider event is idempotently keyed by account and Google event ID; per-calendar sync tokens support incremental updates. See the Google Calendar chapter for conflict fields and behavior.
              </Callout>

              <SectionTitle id="migrations">Migration lifecycle and verification</SectionTitle>
              <p className="leading-8">The repository bootstrap applies two layers in order: idempotent base SQL from <code>src/db/base-schema-statements.json</code>, then migrations from <code>drizzle/</code> via Drizzle’s migrator. It holds a PostgreSQL advisory lock while applying both layers. The Neon-managed <code>neon_auth</code> namespace is not created or migrated by Folio. Avoid running schema push against production as an unreviewed deployment shortcut.</p>
              <CodeBlock language="powershell / shell" code={`# Install dependencies from the lockfile first.
npm install

# Apply the app's base schema and ordered migration journal.
npm run db:init

# Read-only comparison of live PostgreSQL columns against Drizzle definitions.
npm run db:verify

# Run the repository's migration runner explicitly when operating on a
# pre-existing installation; use the documented app script.
npm run db:migrate

# Inspect a proposed Drizzle migration before applying it.
npx drizzle-kit generate

# Development-only schema push. Review target DATABASE_URL before running.
npx drizzle-kit push`}/>
              <p className="leading-8">Use <code>drizzle-kit generate</code> to create a reviewed migration from schema changes. Commit the generated SQL, inspect foreign keys and indexes, and apply it through the deployment’s controlled migration step. <code>drizzle-kit push</code> is a development convenience that may apply schema changes directly and is not equivalent to a reviewed, replayable migration. After changes, run <code>npm run db:verify</code>; it is read-only and reports missing Folio tables/columns and the applied journal count. For a fresh install, <code>npm run db:init</code> is the canonical bootstrap in this repository.</p>
              <Callout kind="Warning" title="Protect production data">
                Take a tested database backup before destructive DDL. Review migrations for data loss, lock duration, nullability backfills, and rollback strategy. Always verify which database the environment points to before executing a write command.
              </Callout>
              <h4 className="mt-7 text-base font-semibold text-white">Data ownership, indexes, and query shape</h4>
              <p className="mt-3 leading-8">A user-owned row should be queried with both its primary identifier and authenticated <code>userId</code>; a foreign key proves referential integrity but does not by itself prove the current caller owns a referenced project. When accepting a task’s project or milestone ID, verify that the referenced record belongs to the same user inside the transaction. This closes the gap between a valid UUID and an authorized relationship. Cascades keep deletion predictable, while <code>set null</code> preserves user work when an optional parent is removed.</p>
              <p className="mt-3 leading-8">Indexes are chosen for the access paths the UI uses: per-user filters, status and due-date views, project progress calculations, and full-text search. PostgreSQL GIN indexes improve search and filtering at the cost of additional write amplification and storage; avoid creating overlapping indexes without measuring query plans. When list sizes grow, add bounded pagination and a stable order key rather than returning an unbounded workspace snapshot. Keep multi-row operations—idea conversion, task status plus completion timestamp, and provider sync cursor advancement—inside a database transaction where partial success would leave inconsistent state.</p>
              <Callout kind="Tip" title="Back up both data and secrets">
                A recoverable deployment needs a PostgreSQL backup and the matching encryption key stored separately in a protected secret manager. A database restore without its token-encryption key can restore Folio records but cannot recover Google refresh credentials.
              </Callout>
            </section>
            )}

            {chapterId === "security" && (
            <section id="security" className="scroll-mt-24">
              <ChapterTitle number="03" title="Authentication, Security & Custom Protocol Deep Linking" lead="Folio keeps provider credentials on the server, uses short-lived OAuth flows and opaque browser sessions, and gives the desktop client a single-use handoff code rather than a reusable browser cookie." />
              <SectionTitle id="sessions">Session lifecycle and credential protection</SectionTitle>
              <p className="leading-8">Password credentials are derived with Node’s <code>scrypt</code> using a per-password random salt and a 64-byte output. Stored form is <code>salt:derived-key</code> in hex. Verification validates both encoded lengths before comparing equal-length byte buffers with <code>timingSafeEqual</code>. Session creation generates 32 cryptographically random bytes, returns the raw token only to the browser cookie, and persists its SHA-256 hash in <code>folio_sessions</code>. The cookie is <code>HttpOnly</code>, <code>SameSite=Lax</code>, path-wide, and <code>Secure</code> in production. Its seven-day expiry is checked against the database for each authenticated request.</p>
              <CodeBlock language="typescript · lifecycle excerpt" code={sessionCode}/>
              <p className="leading-8">Logout deletes the current token hash and expires the cookie. Renewal updates a still-live session; expired sessions are not resurrected. OAuth state is random, bound to an HttpOnly browser cookie, stored hashed with a ten-minute flow expiry, and consumed atomically on callback. Provider exchange uses PKCE S256. These controls are complementary: state/browser binding prevents cross-browser callback substitution; PKCE binds the authorization code exchange; the persisted one-time flow prevents replay.</p>
              <Callout kind="Warning" title="Never log raw credentials">
                Do not log passwords, raw session tokens, OAuth authorization codes, refresh tokens, encryption keys, or the complete callback query. Store only derived or encrypted forms where the feature requires persistence.
              </Callout>

              <SectionTitle id="web-oauth">Google and GitHub OAuth walkthrough</SectionTitle>
              <ol className="my-5 list-decimal space-y-2 pl-6 leading-7">
                <li>The browser visits <code>/api/auth/oauth/google</code> or <code>/api/auth/oauth/github</code>. Folio validates provider configuration and rate-limits the attempt.</li>
                <li>The server creates random state, a separate browser-binding value, and a PKCE verifier; it stores hashes and an encrypted verifier in <code>auth_flows</code> with a short expiry.</li>
                <li>The provider redirects back to <code>/api/auth/oauth/{`{provider}`}/callback</code>. Folio checks state, browser binding, provider, expiry, and (for account linking) the existing session.</li>
                <li>Folio exchanges the one-time code server-to-server with the PKCE verifier and verifies provider identity. Google requires a verified email; GitHub resolves a verified address through its email endpoint.</li>
                <li>Identity resolution links only under explicit rules; Folio does not automatically merge unrelated accounts that happen to share an email.</li>
                <li>Web sign-in creates a normal session; desktop sign-in creates an expiring handoff record and redirects to the custom protocol.</li>
              </ol>
              <p className="leading-8">Google sign-in uses <code>openid email profile</code>; Google Calendar authorization is a separate integration flow described later. OAuth credentials belong in server environment variables only. In production, register exact HTTPS callback URLs in provider consoles and set the canonical app origin correctly.</p>

              <SectionTitle id="desktop-auth">Desktop deep link: browser to one-time session handoff</SectionTitle>
              <p className="leading-8">In the desktop sign-in screen, Folio builds the provider URL with <code>desktop=1</code> and calls <code>openUrl</code> from <code>@tauri-apps/plugin-opener</code>; this delegates to the user’s configured system browser (for example, Chrome or Edge on Windows), rather than embedding provider consent in the app webview. After verification, the callback creates a random 256-bit hex code, stores only its hash with a two-minute expiry and safe workspace destination, and redirects to <code>folio://auth?code=…</code>. Tauri’s deep-link plugin delivers that URL to the desktop webview. The client posts the code to <code>/api/auth/desktop/exchange</code>; the server atomically deletes the matching unexpired row before creating a browser session. A stolen or replayed code therefore cannot be exchanged a second time. The native single-instance plugin raises/focuses the existing window and forwards a second-launch URL instead of opening a competing session window.</p>
              <CodeBlock language="rust · src-tauri/src/lib.rs" code={rustDeepLink}/>
              <CodeBlock language="typescript · deep-link listener excerpt" code={desktopListener}/>
              <p className="leading-8">The exact callback route validates <code>folio://auth</code> and a 64-character lowercase hex code before contacting the exchange endpoint. The exchange endpoint applies same-origin checks, validates request JSON, hashes the code, checks expiry, and consumes the handoff in one SQL delete-returning operation. The returned destination is selected on the server from an allowlisted set of workspace paths; never navigate to a raw user-provided URL.</p>
              <Callout kind="Note" title="The protocol is an input boundary">
                Custom URL schemes can be invoked by other local applications. Treat every URL as untrusted input, enforce a strict path/host/parameter allowlist, keep handoff codes short-lived and one-time, and never place a long-lived session token in a deep link.
              </Callout>
              <h4 className="mt-7 text-base font-semibold text-white">Security review checklist for auth changes</h4>
              <ul className="mt-3 list-disc space-y-2 pl-6 leading-7">
                <li>Normalize email addresses before account lookup and enforce database uniqueness to handle simultaneous sign-ups.</li>
                <li>Rate-limit credential and provider flows without using raw email addresses or session secrets as limiter keys.</li>
                <li>Keep redirect destinations on an explicit allowlist; reject protocol-relative URLs, backslashes, control characters, and external hosts.</li>
                <li>Check cookie flags and HTTPS proxy configuration in the deployed environment, not only in local development.</li>
                <li>Return clear user-facing failures while keeping provider response bodies and secrets out of logs.</li>
                <li>Test expiry, cancellation, replay, account-link mismatch, and second-instance launch as first-class flow branches.</li>
              </ul>
              <p className="mt-3 leading-8">The session token is a bearer credential: possession grants the associated account’s authority. Hashing it at rest limits exposure from database reads, but does not replace TLS, cookie protections, authorization checks, or session invalidation. Rotate sessions on authentication boundaries, expire them server-side, and make account deletion and recovery invalidate existing credentials. If adding a new OAuth provider, validate the provider’s identity token or fetch profile through its authenticated API; a matching email string without a verified-email guarantee is not proof of identity.</p>
            </section>
            )}

            {chapterId === "productivity" && (
            <section id="productivity" className="scroll-mt-24">
              <ChapterTitle number="04" title="Core Productivity Engines" lead="Projects, milestones, tasks, subtasks, and ideas share a typed data foundation but have distinct state transitions. The interface can change representation without changing the owner of the underlying record." />
              <SectionTitle id="projects-milestones">Projects, milestones, progress, and health</SectionTitle>
              <p className="leading-8">A project records name, description, workflow status, priority, category, dates, appearance, favorite state, and archive state. Milestones represent checkpoints within the project. Tasks can reference a project and optionally a milestone. The present progress helper counts tasks assigned to a project and computes <code>round(done / total × 100)</code>; it returns zero when no tasks exist. Milestone progress counts tasks assigned to that milestone and returns 100% when the milestone itself is explicitly completed, even when it has no child tasks. Otherwise it uses the same rounded fraction, or zero for an empty milestone.</p>
              <CodeBlock language="typescript · progress semantics" code={`function projectProgress(projectId: string, tasks: Task[]) {
  const items = tasks.filter(task => task.projectId === projectId);
  const done = items.filter(task => task.completed).length;
  return { total: items.length, done,
    percent: items.length ? Math.round(done / items.length * 100) : 0 };
}

function milestoneProgress(milestone: Milestone, tasks: Task[]) {
  const items = tasks.filter(task => task.milestoneId === milestone.id);
  const done = items.filter(task => task.completed).length;
  return { total: items.length, done,
    percent: milestone.completed ? 100 :
      items.length ? Math.round(done / items.length * 100) : 0 };
}`}/>
              <p className="leading-8">Health is a derived presentation metric, not a persisted project status. The project UI combines completion, date proximity, overdue work, and project state for a quick signal; keep this derivation explainable and make thresholds consistent across cards and detail views. Project lifecycle values are Planning, In progress, On hold, and Completed. Archiving is a separate boolean so a completed or paused project can remain available without cluttering active views.</p>
              <p className="mt-4 leading-8">Archival should remain an explicit user action unless a future policy is defined. The current schema has an <code>archived</code> boolean and no scheduled retention rule; do not silently auto-archive records based only on age or completion. If an automatic archive policy is introduced, expose its criteria, preserve an audit trail, and make restoration straightforward.</p>

              <SectionTitle id="task-management">Dual task management: Kanban and dense list</SectionTitle>
              <p className="leading-8">The task board and task list are two projections over the same task entity. The board groups tasks into workflow buckets: To do, In progress, In review, and Completed. During a drag, the browser may display a temporary position preview, but a successful drop must persist the resulting status through the workspace API. Task ordering in the current schema is not represented by a general task-position field; do not infer stable manual ordering across reloads. If durable within-column ranking is needed, add an explicit order key and migration before claiming it.</p>
              <p className="mt-4 leading-8">The high-density list is for scanning and keyboard-driven work. A reliable interaction model keeps focus visible, scopes shortcuts to the list (and ignores editable inputs), separates selection from completion, and reports bulk failures. Typical commands include arrow-key movement between rows, Enter to open a selected task, and a documented completion shortcut. Do not trigger destructive bulk actions without a clear selection and confirmation. Batch mutations use the task-only bulk API branch, validate every UUID, constrain writes to the authenticated user, and return the changed records for reconciliation.</p>
              <div className="my-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5"><h4 className="font-semibold text-white">Kanban interaction contract</h4><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-400"><li>Keep the current task ID stable while dragging.</li><li>Show a local preview; persist only the intended status change on drop.</li><li>On network or validation failure, restore the previous lane and announce the error.</li><li>Support a non-drag path for keyboard and assistive-technology users.</li></ul></div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5"><h4 className="font-semibold text-white">Dense list interaction contract</h4><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-400"><li>Maintain one active row and an independent selected set.</li><li>Keep shortcuts away from text fields and dialogs.</li><li>Batch only supported task operations; display partial or total failures clearly.</li><li>Preserve query, filters, and selection intentionally after mutations.</li></ul></div>
              </div>
              <p className="leading-8">Task records support priority, start and due dates, labels, notes, estimates, completion time, optional project/milestone links, and subtasks. The legacy <code>completed</code> boolean is kept in sync with <code>status === &quot;done&quot;</code>; mutations must update both to avoid inconsistent readers. A subtask’s <code>position</code> provides ordered checklist display and can be reindexed after drag or insert.</p>

              <SectionTitle id="ideas">Idea incubator and promotion</SectionTitle>
              <p className="leading-8">Ideas reduce the activation cost of capturing an unfinished thought. They have lightweight metadata (title, description, category, color, status, timestamp) and three current workflow labels: Just an idea, Exploring, and Ready to start. Promotion is a deliberate transition, not an automatic AI side effect: the workspace route locks the idea row, creates a Planning project using the idea’s title, description, category, and color, deletes the original idea, records an activity entry, and commits the related database work as a transaction. The conversion operation is safe to retry only insofar as the source idea still exists; on a second request the server returns a not-found/validation response instead of creating a duplicate.</p>
              <p className="mt-4 leading-8">The current conversion does not automatically invent milestones or subtasks; the new project begins as a formal container for the user to plan. A future enhancement can ask Folio AI to propose an execution tree, but should preview proposed content and require confirmation before creating records. This preserves the useful distinction between idea capture and commitment.</p>
              <Callout kind="Tip" title="Keep capture friction low">
                An idea can remain intentionally incomplete. Avoid requiring a due date, project, or task breakdown at capture time; make the transition to structured work progressive and reversible where the data model allows it.
              </Callout>
              <h4 className="mt-7 text-base font-semibold text-white">Consistency rules worth preserving</h4>
              <p className="mt-3 leading-8">Treat <code>status</code> as the workflow vocabulary and keep the compatibility <code>completed</code> flag synchronized in every write path, including bulk edits, AI proposals, imports, and task conversion. Set and clear <code>completedAt</code> at the same time as the status transition. These values answer different questions: status explains the workflow stage; the timestamp records when completion occurred. Reopening a task should not leave a stale completion timestamp that analytics can mistake for a current completion.</p>
              <p className="mt-3 leading-8">Progress percentages are useful summaries but can hide blocked work and unequal task sizes. They count tasks equally in the current helper, so a one-minute checkbox and a multi-day deliverable each contribute one unit. If weighted progress is introduced, define the weight source and behavior for tasks without estimates, then label the metric clearly. Health should combine a small number of explainable signals and remain derived so that changing a deadline does not require a separate consistency migration.</p>
              <p className="mt-3 leading-8">For larger workspaces, compute view projections from indexed server queries rather than repeatedly scanning all tasks in every component. Keep keyboard navigation in a roving-focus model, announce status changes to screen readers, and provide buttons or menus as alternatives to drag-only operations. On concurrent edits, the API response is canonical; stale client snapshots should be reconciled or refreshed rather than written back wholesale.</p>
            </section>
            )}

            {chapterId === "calendar-sync" && (
            <section id="calendar-sync" className="scroll-mt-24">
              <ChapterTitle number="05" title="Native Google Calendar Bi-Directional Synchronization" lead="Calendar integration is an explicit, revocable OAuth capability. Folio first requests calendar read access; event-write access is a separate incremental grant. The server stores encrypted credentials and a bounded mirror of selected calendars and events." />
              <SectionTitle id="google-setup">Google Cloud configuration and scopes</SectionTitle>
              <ol className="my-5 list-decimal space-y-2 pl-6 leading-7">
                <li>Create a Google Cloud project, enable Google Calendar API, and configure the OAuth consent screen with an accurate app name, privacy policy, support contact, and requested scopes.</li>
                <li>Create a Web application OAuth client and register the exact redirect URI <code>https://your-host/api/integrations/google/callback</code> (or the configured <code>GOOGLE_REDIRECT_URI</code>).</li>
                <li>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> on the server only. Use HTTPS in production and keep provider credentials out of client bundles.</li>
                <li>On initial connect, Folio requests <code>https://www.googleapis.com/auth/calendar.readonly</code>. When the user enables writes, it requests the incremental <code>https://www.googleapis.com/auth/calendar.events</code> scope separately.</li>
                <li>Publish the consent screen or add test accounts as required by the project’s publishing state and Google’s current verification policy.</li>
              </ol>
              <p className="leading-8">Read-only first is a least-privilege product decision. The scope change is reflected in <code>writeEnabled</code>; event create/update endpoints refuse writes if permission has not been granted. Explain the scope at the point of consent and provide a disconnect action that revokes provider access and clears local secrets.</p>

              <SectionTitle id="sync-engine">Incremental delta sync and conflict model</SectionTitle>
              <p className="leading-8">A Folio account has one Google account record, one record per selected calendar, and mirrored events. First sync and explicit full sync read up to a bounded 400-day history. Subsequent runs use each calendar’s Google <code>syncToken</code>; response pages are processed idempotently and the final token is persisted. Google event identity is uniquely indexed by account and event ID, allowing the same page to be replayed without duplicate mirror rows. A 410 response means the sync token is invalid; the engine discards incremental assumptions and restarts a full sync.</p>
              <p className="mt-4 leading-8">Token refresh happens one minute before access-token expiry to reduce races with outgoing API requests. Refresh and access credentials are encrypted with AES-256-GCM before database persistence. All-day event end dates follow Google’s exclusive-end convention; timed event instants preserve timezone metadata where available. Canceled events are handled as provider deletions. Calendar metadata refresh is cosmetic: if it fails, it must not block event synchronization.</p>
              <p className="mt-4 leading-8">Event records include <code>localDirty</code> and <code>localUpdatedAt</code> to mark local edits awaiting push. A production conflict policy should compare provider ETags/updated timestamps and local dirty state, then report both versions when neither side can safely win. Never silently overwrite a dirty local edit with a remote snapshot. Folio task deadlines remain task dates; a calendar event may link to a task, but the two records are not automatically interchangeable.</p>
              <CodeBlock language="sync state machine" code={`Connect (read-only consent)
  └─ persist encrypted refresh token
      └─ discover calendars → selected calendar rows
          └─ full sync (no syncToken; bounded history)
              ├─ upsert provider event mirrors by stable event ID
              └─ persist nextSyncToken per calendar

Later sync
  ├─ refresh access token if expiry is within 60 seconds
  ├─ request delta pages with syncToken
  ├─ apply adds / changes / cancellations idempotently
  └─ persist the new syncToken after all pages succeed

HTTP 410 on a sync token → full resync; expired refresh token → mark
connection revoked, clear access token, and ask the user to reconnect.`}/>

              <SectionTitle id="sync-resilience">Rate limits, revocation, offline behavior</SectionTitle>
              <p className="leading-8">A Google 401/invalid-grant response is not a transient sync error: mark the integration as requiring reauthorization and remove unusable access-token material. Network failures should be surfaced as a retryable status without erasing the last known event mirror. Apply bounded exponential backoff with jitter for transient 429/5xx responses; respect provider retry hints and avoid multiplying retries across request layers. A per-calendar failure can produce a partial result while successful calendars finish. A manual “sync now” request returns a summary of additions, updates, removals, conflicts, and errors.</p>
              <p className="mt-4 leading-8">Offline mode means local reads and user edits can continue when the browser has cached workspace data; it does not mean server-backed changes have synchronized. Queueing writes requires an explicit durable outbox, idempotency keys, ordering rules, and a visible pending/error state. Do not report offline changes as synchronized until the server confirms them. Rate-limited operations should be deferred rather than retried in a tight loop.</p>
              <p className="mt-4 leading-8">The sync loop is bounded to a maximum number of pages per calendar so a malformed or unusually large response cannot keep one request alive forever. When that ceiling is reached, preserve the last fully committed sync token and return a partial result; a subsequent sync can continue from a safe cursor. Advance the saved token only after all pages belonging to that delta have been applied. Record per-calendar outcomes and counts so an operator can distinguish “no changes” from “not attempted” and “partially failed”. Never delete unseen events after an incomplete page sequence: absence is only meaningful after a complete full-sync window.</p>
              <p className="mt-4 leading-8">For write-back, persist a stable mapping between the Folio object and Google event ID before reporting success. Retry creates with an idempotency strategy to avoid duplicate events if the provider accepted a request but the response was lost. When updating, send the known ETag using conditional requests where supported; a precondition failure signals that the remote version changed and should enter conflict handling rather than being overwritten blindly. Keep time semantics explicit: date-only deadlines are not UTC instants, recurring event instances need a stable recurring-event relationship, and all-day end dates are exclusive.</p>
              <Callout kind="Warning" title="Credential rotation has operational impact">
                Keep the encryption key stable across deploys. If it is lost or rotated without a migration, stored refresh tokens cannot be opened; the safe recovery is to ask users to reconnect, not to guess or log the secret.
              </Callout>
            </section>
            )}

            {chapterId === "ai" && (
            <section id="ai" className="scroll-mt-24">
              <ChapterTitle number="06" title="Folio AI Engine & Local Open-Weight LLM Integration" lead="Folio AI is designed as a reviewable assistant: it can reason over a bounded workspace context, but consequential edits are presented as proposed actions and applied through the application’s normal validated mutation layer." />
              <SectionTitle id="ambient-ai">Ambient context and privacy boundary</SectionTitle>
              <p className="leading-8">Useful context can include active project goals, unfinished tasks, due dates, recent activity, and upcoming calendar events. Assemble only the smallest relevant subset for the user’s request, with explicit limits on record count and character length. Remove unrelated personal fields and never include session cookies, OAuth credentials, or hidden system metadata. Context should carry stable IDs when proposing actions so the executor can resolve and validate targets rather than trusting model-generated names.</p>
              <p className="mt-4 leading-8">The implemented local provider uses WebLLM and WebGPU in the browser. The model weights and prompts are processed locally after download; normal Folio account/session and usage features still communicate with the Folio server. “Local inference” is not equivalent to “the entire application is offline.” User-visible wording should precisely distinguish local model inference from server persistence and request accounting.</p>
              <p className="mt-4 leading-8">Action proposals should be structured, schema-validated, previewable, and idempotent where possible. Treat model output as untrusted text, not executable code. Every action must pass ordinary authorization and domain checks; the model never gets direct database access or permission to bypass confirmation.</p>

              <SectionTitle id="prompt-design">Task decomposition and estimation prompts</SectionTitle>
              <p className="leading-8">Strong prompts state the task, available context, output schema, constraints, and uncertainty. Request a small plan rather than an exhaustive speculative backlog. For estimation, ask for a range or confidence and the assumptions that dominate it. Keep inference output bounded by configured input/output limits; preserve a clear refusal path when required context is missing.</p>
              <CodeBlock language="prompt template · task decomposition" code={`System:
You help the signed-in user plan work inside Folio. Use only the context below.
Do not claim to have edited workspace data. Return a concise proposal that the
user can review. If the goal is ambiguous, ask one focused question.

User goal:
{{goal}}

Relevant projects and tasks:
{{bounded_workspace_context}}

Return JSON matching:
{
  "summary": "string",
  "tasks": [
    { "title": "string", "description": "string",
      "priority": "Urgent|High|Medium|Low|None",
      "estimateMinutes": "integer or null",
      "dependsOn": ["earlier task index"]
    }
  ],
  "assumptions": ["string"],
  "openQuestions": ["string"]
}
Rules: create actionable steps; avoid invented dates, owners, or integrations;
keep the plan to a useful minimum; explain uncertainty instead of false precision.`}/>
              <CodeBlock language="prompt template · time estimation" code={`Estimate the effort for the single work item below.
Return a low-to-high duration range in minutes, confidence (low|medium|high),
and up to three explicit assumptions. Do not convert an uncertain estimate
into a calendar commitment.

Work item: {{task_title}}
Description: {{task_description}}
Known constraints: {{relevant_context}}

Output JSON only:
{ "lowMinutes": 0, "highMinutes": 0, "confidence": "low|medium|high",
  "assumptions": ["..."] }`}/>

              <SectionTitle id="local-models">On-device models, Ollama, and WebGPU</SectionTitle>
              <p className="leading-8">Folio offers two compact WebLLM models: Llama 3.2 1B for quick replies and SmolLM2 1.7B for fuller workspace planning. Download both sequentially in one action; their combined model files are about 1.7 GB and stay within the 2 GB bundle limit. Folio recommends Llama on devices with unknown or limited memory and SmolLM2 on devices reporting at least 8 GB; devices reporting under 4 GB do not expose Folio AI. The configured context window is 4,096 tokens, input is capped at 4,000 characters, output at 2,048 tokens, and the daily token allowance is 50,000; the UI exposes usage as a percentage only. Mobile browsers also need WebGPU. Inference stays on-device, while conversation history and task progress sync to the Folio account.</p>
              <SectionTitle id="quality-workflow">Optional quality models and staged collaboration</SectionTitle>
              <p className="leading-8">After the compact models are installed, Folio can offer an optional quality-model library. Eligible devices can inspect each model’s strengths and trade-offs, download one model at a time, or install all models compatible with that device. The library includes Gemma 2 2B IT (~1.5 GB), Qwen 2.5 3B Instruct (~1.3 GB), Phi 3.5 Mini (~1.2 GB), and Qwen 2.5 7B Instruct (~2.4 GB). Availability is filtered using reported system memory and required WebGPU features; for example, Gemma requires <code>shader-f16</code>. These are additional downloads, not part of the compact bundle: installing quality models can use more than 2 GB of storage, and browser-reported memory is only a compatibility hint, not a guarantee of available GPU memory.</p>
              <p className="mt-4 leading-8">When smart routing is enabled, a prompt is assessed as complex, and every quality model offered for the device is installed, Folio can run a staged workflow locally. With two installed quality models it plans and writes; with three it plans, reviews the plan, and writes; with four it can also prepare a separate Folio-action stage. Each model is loaded and unloaded before the next stage to avoid keeping all model weights in GPU memory simultaneously. The multi-model request uses a larger usage reservation (up to 16,384 tokens rather than the regular 6,144-token reservation), so it consumes more of the daily allowance. Model strengths are descriptive rather than benchmark guarantees.</p>
              <p className="mt-4 leading-8">A staged workflow does not silently change the workspace. Any proposed Folio actions are returned through the normal action-plan review and confirmation flow; only after approval can Folio apply them through its validated mutation layer. Users can continue with the compact models instead, and devices without compatible quality upgrades retain the compact-model experience.</p>
              <p className="mt-4 leading-8">A local Ollama-compatible OpenAI endpoint can be used as an integration option in a development environment when a provider adapter is configured to call it. Typical local URL is <code>http://localhost:11434/v1</code>; do not expose that endpoint publicly without authentication and network controls. A browser page cannot safely assume it may call localhost: browser mixed-content, CORS, private-network and permission policies vary. The current repository’s default Folio AI provider is WebLLM/WebGPU, not an Ollama HTTP client.</p>
              <CodeBlock language="local model comparison" code={`Path                 Inference location    Privacy / tradeoff
WebLLM + WebGPU      User's browser         Prompt/model inference local;
                                           weights download to browser cache
Ollama + local API   User's device service  Local if bound to loopback;
                                           requires an explicit adapter
Hosted model API     Provider's servers     Strong availability/model choice;
                                           workspace context leaves device

Current Folio default: device-aware WebLLM (Llama 3.2 1B for unknown or limited
system memory; SmolLM2 1.7B for everyday planning).
Conversation/task history and quota metadata sync to Folio; model inference
and downloaded weights remain on the device. Roster entries require compatible
compiled model artifacts, memory, and registry availability.`}/>
              <p className="leading-8">Choose local inference when device-side processing and avoiding third-party model providers are priorities; Folio account sync and quota checks still require network access. A local model is not automatically safer from malicious prompt content or inaccurate output. Evaluate outputs, keep destructive operations confirmed, and never treat model confidence as authorization.</p>
              <h4 className="mt-7 text-base font-semibold text-white">Evaluation and graceful degradation</h4>
              <p className="mt-3 leading-8">A model adapter should expose a narrow interface for initialization, progress, generation, interruption, reset, and unload. Keep model loading behind an explicit user action because downloading hundreds of megabytes consumes bandwidth and storage. Report download progress, whether assets were cached, WebGPU initialization errors, and cancellation clearly; release the worker when the user unloads the model or the browser route no longer needs it. Never silently fall back to a remote provider after a local model fails, since that changes the privacy contract.</p>
              <p className="mt-3 leading-8">Evaluate generated plans against a fixed set of representative requests: vague goals, tasks with dependencies, already-completed work, sensitive content, requests to act on an unknown project, and malicious instructions embedded in task descriptions. Measure schema-valid output, useful decomposition, hallucinated dates, and whether unsafe operations are presented as proposals. Keep evaluation samples synthetic or consented, and avoid retaining raw prompts longer than the feature requires.</p>
              <p className="mt-3 leading-8">Streaming improves perceived responsiveness but introduces partial output. Do not parse or execute an incomplete JSON fragment. Buffer the response, validate it against a runtime schema after generation completes, reject unknown fields, and show a recoverable parse error with the original user input intact. Pause automatic scrolling when the user has moved away from the latest message. Check the estimated prompt against the local context budget and ask users to split requests that will not fit; abort signals should stop generation and release the UI’s busy state even when the worker rejects during interruption.</p>
            </section>
            )}

            {chapterId === "desktop" && (
            <section id="desktop" className="scroll-mt-24">
              <ChapterTitle number="07" title="Cross-Platform Desktop Client (Tauri v2 Manual)" lead="Tauri supplies a compact Rust host around the operating system’s WebView, with narrowly scoped plugins for opener behavior, custom deep links, and single-instance handling." />
              <SectionTitle id="tauri-architecture">Rust core and native WebViews</SectionTitle>
              <p className="leading-8">Tauri’s Rust process owns the native window and plugin lifecycle; the UI is rendered by the operating system’s WebView: WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux. That avoids bundling a separate browser engine but means platform WebView versions and system dependencies affect runtime behavior. The configured plugins include deep-link, opener, logging in development, and single-instance on desktop. Keep the Tauri command surface small, validate all webview input, and grant only capabilities required by the app.</p>
              <p className="mt-4 leading-8">The current window uses a 1280×820 initial size, minimum size 900×600, dark native theme, and a hosted production URL. The active Tauri config sets <code>csp</code> to <code>null</code>; this is permissive and should be revisited before embedding arbitrary remote content or expanding native permissions. A strict content security policy must account for the actual app origin, WebGPU/model assets, and required API connections rather than being copied blindly.</p>

              <SectionTitle id="tauri-config">tauri.conf.json reference</SectionTitle>
              <p className="leading-8">This listing reproduces the relevant current repository configuration. Build output targets and icon paths must exist for release packaging. The empty before-build commands mean this config does not invoke a Next.js build; in this deployment, the window loads the hosted application URL.</p>
              <CodeBlock language="json · src-tauri/tauri.conf.json" code={tauriConfig}/>

              <SectionTitle id="desktop-packaging">Cross-platform packaging, signing, and releases</SectionTitle>
              <p className="leading-8">Tauri’s bundle targets can generate platform-native packages when the correct target toolchain and packaging dependencies are installed. Windows releases may produce an NSIS <code>.exe</code> installer and an MSI package. macOS release builds target both <code>aarch64-apple-darwin</code> and <code>x86_64-apple-darwin</code>; combine/sign/notarize them according to the project’s release process before publishing a universal DMG. Linux bundles can produce a Debian <code>.deb</code> and an AppImage where the required system libraries and bundler are available. Build each target on a supported CI runner or use a properly provisioned cross-compilation environment; a successful local compile does not attest that artifacts install on every supported distribution.</p>
              <CodeBlock language="release commands · target examples" code={`# Inspect bundle target options for the installed Tauri CLI:
npx tauri build --help

# Windows: run on a Windows runner with the WebView2 runtime/toolchain.
npx tauri build --bundles nsis,msi

# macOS: build both architectures on a macOS runner.
npx tauri build --target aarch64-apple-darwin --bundles dmg
npx tauri build --target x86_64-apple-darwin --bundles dmg

# Linux: provision the documented GTK/WebKitGTK and packaging dependencies.
npx tauri build --bundles deb,appimage`}/>
              <p className="leading-8">Artifact names are determined by the Tauri bundle configuration and target. Release automation should inspect the actual produced filenames, generate checksums, attach provenance, and publish versioned artifacts; do not hardcode a download link to a file that has not been built and uploaded. The landing-page download menu should track the release pipeline’s real artifacts.</p>
              <p className="mt-4 leading-8">For Windows, sign installers and binaries with a protected code-signing certificate or a managed signing provider such as SignPath.io, timestamp signatures, and verify signatures before release. SmartScreen reputation is earned over time and may still warn on a new publisher; do not advise users to bypass the warning. For macOS, sign with a Developer ID Application certificate, enable hardened runtime as appropriate, submit the DMG/app for Apple notarization, staple the notarization ticket, and verify with platform tools such as <code>codesign</code> and <code>spctl</code>. For Linux, publish signed repository metadata or checksums/signatures and document distro dependencies. Do not disable Gatekeeper or instruct users to bypass platform security; resolve signing/notarization failures and distribute verifiable, correctly signed artifacts.</p>
              <p className="mt-4 leading-8">The repository release workflow runs Windows, Ubuntu, and macOS jobs from a version tag or manual dispatch, installs the Node and Rust toolchains, provisions Linux WebKitGTK dependencies, and requests a universal Apple target on macOS. Before expanding that workflow, verify what the action actually emits for each platform and use the exact resulting case-sensitive asset names in the website download menu. A release manifest or generated asset list is safer than maintaining guessed filenames in multiple places. Keep preview builds distinct from stable releases and make the app version, Git tag, release title, and migration compatibility traceable to the same source revision.</p>
              <p className="mt-4 leading-8">The desktop wrapper loads the hosted web app, so testing must cover network conditions as well as native installation. Verify the app’s login path opens the system browser, the protocol handler returns to the already-running process, the window is restored from minimized state, and an expired or reused handoff code fails safely. Test upgrades over an earlier version, clean installs, uninstall behavior, and whether protocol registration remains correct after an update. Record the OS image and WebView version used for release qualification.</p>
              <Callout kind="Warning" title="Treat remote web content and native capabilities as one security boundary">
                Because the desktop shell currently loads a hosted site, a compromise or misconfiguration of that origin affects the desktop UI too. Keep remote content trusted, use a restrictive CSP, avoid broad shell permissions, and require explicit confirmation for sensitive native actions.
              </Callout>
              <h3 className="mt-8 text-lg font-semibold text-white">Release checklist</h3>
              <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-slate-400">
                <li>Confirm app version, product identifier, icons, and custom protocol registration.</li>
                <li>Build on supported CI images and verify every requested target exists.</li>
                <li>Sign and timestamp Windows artifacts; sign, notarize, and staple macOS artifacts.</li>
                <li>Install-test packages on clean supported OS images and confirm upgrade/uninstall behavior.</li>
                <li>Verify deep links, OAuth handoff, second-instance focus, and expired-code behavior.</li>
                <li>Publish checksums, release notes, source revision, and artifact provenance together.</li>
              </ul>
            </section>
            )}
          </article>

          <footer className="mt-24 border-t border-slate-800 pt-8 text-sm leading-7 text-slate-500">
            Keep this manual aligned with executable code. The schema source is <code>src/db/schema.ts</code>, server handlers live under <code>src/app/api</code>, integration logic lives under <code>src/lib</code>, and desktop configuration and Rust plugins live under <code>src-tauri</code>. When behavior changes, update the corresponding chapter and test the actual contract.
          </footer>
        </main>
    </DocsExperience>
  );
}
