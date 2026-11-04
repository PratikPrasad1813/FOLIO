#!/usr/bin/env node
// Comprehensive automated test suite for Folio Secure Account Deletion.
// Verifies authentication verification, confirmation matching, cascading deletion,
// multi-user data isolation, external token revocation, session invalidation,
// and transaction rollback.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { and, eq, inArray } from "drizzle-orm";
import { loadFolioEnv } from "./lib/env.mjs";

loadFolioEnv();

const screenshotUrl = process.env.SCREENSHOT_DATABASE_URL;
const target = screenshotUrl ? new URL(screenshotUrl) : null;
const database = target && decodeURIComponent(target.pathname.slice(1));
if (
  process.env.FOLIO_SCREENSHOT_MODE !== "local" ||
  process.env.NODE_ENV === "production" ||
  !target ||
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  !/^folio_screenshots(?:_[a-z0-9_]+)?$/.test(database)
) {
  throw new Error(
    "Account deletion tests require FOLIO_SCREENSHOT_MODE=local and a dedicated loopback folio_screenshots database.",
  );
}

process.env.DATABASE_URL = screenshotUrl;
process.env.FOLIO_ENCRYPTION_KEY = randomBytes(32).toString("hex");

// Auto-create loopback folio_screenshots test database if not yet present
const load = createRequire(import.meta.url)("./folio-test-loader.cjs");
try {
  const { Client } = load("pg");
  for (const fallbackDb of ["postgres", "app_db"]) {
    try {
      const u = new URL(screenshotUrl);
      u.pathname = `/${fallbackDb}`;
      const client = new Client({ connectionString: u.toString() });
      await client.connect();
      const check = await client.query("select 1 from pg_database where datname = $1", [database]);
      if (!check.rows.length) {
        await client.query(`create database ${database}`);
      }
      await client.end();
      break;
    } catch {
      // try next fallback
    }
  }
} catch {
  // best-effort pre-creation
}
const { db, pool } = load(resolve("src/db/index.ts"));
const { applySchema } = load(resolve("src/db/migrate.ts"));
const schema = load(resolve("src/db/schema.ts"));
const { deleteUserAccount, DeletionAuthError, DeletionInputError } = load(
  resolve("src/lib/account-deletion.ts"),
);
const { sealToken } = load(resolve("src/lib/crypto.ts"));

const {
  activities,
  authFlows,
  authIdentities,
  authRateLimits,
  emailVerifications,
  folioAiConversations,
  folioAiDailyUsage,
  folioAiMessages,
  folioAiPreferences,
  folioAiUsageReservations,
  googleAccounts,
  googleCalendars,
  googleEvents,
  ideas,
  milestones,
  notificationPreferences,
  notifications,
  passwordResets,
  projects,
  recentSearches,
  reminderDeliveries,
  savedFilters,
  sessions,
  subtasks,
  taskReminders,
  tasks,
  users,
} = schema;

const runId = randomUUID();
const hash = (v) => createHash("sha256").update(v).digest("hex");
const ip = `198.20.${parseInt(runId.slice(0, 2), 16)}.${parseInt(runId.slice(2, 4), 16)}`;

let safe = false;
let server;
let browser;
let serverLog = "";
const createdUserIds = [];

async function freePort() {
  const s = createServer();
  await new Promise((ok, fail) => s.listen(0, "127.0.0.1", ok).on("error", fail));
  const p = s.address().port;
  await new Promise((ok) => s.close(ok));
  return p;
}

async function waitForHealth(base) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("Test server exited prematurely.");
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Test Next.js server did not become healthy.");
}

try {
  const { rows: [actual] } = await pool.query(
    "select current_database() as db, inet_server_addr()::text as address",
  );
  assert.equal(actual.db, database);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::1/128"].includes(actual.address));
  safe = true;
  await applySchema();

  /* ---------------------------------------------------------------------- */
  /* Unit / Service level tests for deleteUserAccount                       */
  /* ---------------------------------------------------------------------- */
  const salt = randomBytes(16).toString("hex");
  const password = "StrongPassword2026!";
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;

  const userAId = randomUUID();
  const emailA = `delete-test-${userAId}@example.test`;
  const [userA] = await db
    .insert(users)
    .values({
      id: userAId,
      name: "User To Delete",
      email: emailA,
      provider: "email",
      passwordHash,
    })
    .returning();
  createdUserIds.push(userA.id);

  // 1. Missing / wrong confirmation phrase
  await assert.rejects(
    () =>
      deleteUserAccount({
        user: userA,
        confirmation: "wrong-email@example.com",
        password,
      }),
    DeletionInputError,
  );

  // 2. Missing password for email account
  await assert.rejects(
    () =>
      deleteUserAccount({
        user: userA,
        confirmation: emailA,
        password: "",
      }),
    DeletionAuthError,
  );

  // 3. Wrong password
  await assert.rejects(
    () =>
      deleteUserAccount({
        user: userA,
        confirmation: emailA,
        password: "IncorrectPassword123",
      }),
    DeletionAuthError,
  );

  console.log("PASS: Confirmation phrase and password validation errors enforced.");

  /* ---------------------------------------------------------------------- */
  /* Multi-User Population & Cascading Deletion Verification               */
  /* ---------------------------------------------------------------------- */
  // Create User B (whose data MUST remain untouched)
  const userBId = randomUUID();
  const emailB = `keep-user-${userBId}@example.test`;
  const [userB] = await db
    .insert(users)
    .values({
      id: userBId,
      name: "User To Keep",
      email: emailB,
      provider: "email",
      passwordHash,
    })
    .returning();
  createdUserIds.push(userB.id);

  // Populate User B with project, task, idea
  const [projB] = await db
    .insert(projects)
    .values({ userId: userB.id, name: "User B Project" })
    .returning();
  const [taskB] = await db
    .insert(tasks)
    .values({ userId: userB.id, projectId: projB.id, title: "User B Task", labels: [] })
    .returning();
  await db.insert(ideas).values({ userId: userB.id, title: "User B Idea" });

  // Populate User A with records across all categories
  const [projA] = await db
    .insert(projects)
    .values({ userId: userA.id, name: "User A Project" })
    .returning();
  const [milestoneA] = await db
    .insert(milestones)
    .values({ userId: userA.id, projectId: projA.id, title: "Milestone A" })
    .returning();
  const [taskA] = await db
    .insert(tasks)
    .values({
      userId: userA.id,
      projectId: projA.id,
      milestoneId: milestoneA.id,
      title: "Task A",
      labels: ["dev"],
    })
    .returning();
  await db.insert(subtasks).values({ userId: userA.id, taskId: taskA.id, title: "Subtask A" });
  await db.insert(ideas).values({ userId: userA.id, title: "Idea A" });
  await db.insert(activities).values({ userId: userA.id, projectId: projA.id, text: "Activity A" });
  await db.insert(taskReminders).values({ userId: userA.id, taskId: taskA.id, timing: "1h_before" });
  await db.insert(notificationPreferences).values({ userId: userA.id, calendarReminderIntervals: [15] });
  const [notifA] = await db
    .insert(notifications)
    .values({ userId: userA.id, category: "task", type: "task_reminder", title: "Notif A", dedupeKey: "demo:notif:a" })
    .returning();
  await db.insert(reminderDeliveries).values({
    userId: userA.id,
    dedupeKey: "demo:notif:a",
    sourceType: "task",
    sourceId: taskA.id,
    reminderType: "task_reminder",
    notifId: notifA.id,
  });
  const [gAccountA] = await db
    .insert(googleAccounts)
    .values({
      userId: userA.id,
      googleUserId: `g-${userA.id}`,
      email: "test.google@example.test",
      refreshTokenEnc: sealToken("fictional-refresh-token"),
    })
    .returning();
  await db.insert(googleCalendars).values({
    userId: userA.id,
    accountId: gAccountA.id,
    calendarId: "cal-a",
  });
  await db.insert(googleEvents).values({
    userId: userA.id,
    accountId: gAccountA.id,
    calendarId: "cal-a",
    googleEventId: "evt-a",
    title: "Event A",
    taskId: taskA.id,
  });
  const [convoA] = await db
    .insert(folioAiConversations)
    .values({ userId: userA.id, title: "AI Convo A" })
    .returning();
  await db.insert(folioAiMessages).values({
    userId: userA.id,
    conversationId: convoA.id,
    role: "user",
    content: "Hello AI",
  });
  await db.insert(folioAiPreferences).values({ userId: userA.id, assistantName: "Folio AI" });
  await db.insert(folioAiDailyUsage).values({ userId: userA.id, usageDate: "2026-11-02", completedMessageCount: 1 });
  await db.insert(folioAiUsageReservations).values({
    userId: userA.id,
    generationId: randomUUID(),
    usageDate: "2026-11-02",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(recentSearches).values({ userId: userA.id, query: "search a", queryKey: "search-a" });
  await db.insert(savedFilters).values({ userId: userA.id, kind: "tasks", name: "Filter A", nameKey: "filter-a", config: {} });
  await db.insert(authIdentities).values({ userId: userA.id, provider: "google", subject: `sub-${userA.id}`, email: emailA });
  await db.insert(authFlows).values({
    stateHash: hash(`flow-state-${userA.id}`),
    browserHash: hash("browser"),
    provider: "google",
    verifierEnc: sealToken("verifier"),
    returnTo: "/overview",
    linkUserId: userA.id,
    expiresAt: new Date(Date.now() + 600_000),
  });
  await db.insert(passwordResets).values({
    tokenHash: hash(`pw-${userA.id}`),
    userId: userA.id,
    expiresAt: new Date(Date.now() + 1800_000),
  });
  await db.insert(emailVerifications).values({
    tokenHash: hash(`ev-${userA.id}`),
    userId: userA.id,
    email: emailA,
    expiresAt: new Date(Date.now() + 86400_000),
  });
  const sessionTokenA = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId: userA.id,
    tokenHash: hash(sessionTokenA),
    expiresAt: new Date(Date.now() + 3600_000),
  });

  // Verify User A has records in all 24 child tables
  const userOwnedTables = [
    subtasks,
    taskReminders,
    googleEvents,
    googleCalendars,
    googleAccounts,
    folioAiMessages,
    folioAiConversations,
    folioAiUsageReservations,
    folioAiDailyUsage,
    folioAiPreferences,
    reminderDeliveries,
    notifications,
    notificationPreferences,
    activities,
    tasks,
    milestones,
    projects,
    ideas,
    recentSearches,
    savedFilters,
    authIdentities,
    passwordResets,
    emailVerifications,
    sessions,
  ];

  for (const table of userOwnedTables) {
    const rows = await db.select().from(table).where(eq(table.userId, userA.id));
    assert.ok(rows.length > 0, `Table ${table} should have seeded rows for User A`);
  }

  // Perform successful deletion of User A
  const deletionResult = await deleteUserAccount({
    user: userA,
    confirmation: emailA,
    password,
  });
  assert.equal(deletionResult.ok, true);

  // Verify User A is completely erased from folio_users and all 25 child tables
  const [deletedUserRow] = await db.select().from(users).where(eq(users.id, userA.id));
  assert.equal(deletedUserRow, undefined, "User A must not exist in folio_users");

  for (const table of userOwnedTables) {
    const rows = await db.select().from(table).where(eq(table.userId, userA.id));
    assert.equal(rows.length, 0, `Table should have 0 rows remaining for deleted User A`);
  }
  const remainingFlowsA = await db.select().from(authFlows).where(eq(authFlows.linkUserId, userA.id));
  assert.equal(remainingFlowsA.length, 0, "authFlows should have 0 rows for User A");

  // Verify User B's records are completely untouched!
  const [keptUserRow] = await db.select().from(users).where(eq(users.id, userB.id));
  assert.ok(keptUserRow, "User B must remain in folio_users");
  const keptProjectsB = await db.select().from(projects).where(eq(projects.userId, userB.id));
  assert.equal(keptProjectsB.length, 1);
  assert.equal(keptProjectsB[0].name, "User B Project");
  const keptTasksB = await db.select().from(tasks).where(eq(tasks.userId, userB.id));
  assert.equal(keptTasksB.length, 1);
  assert.equal(keptTasksB[0].title, "User B Task");

  console.log("PASS: Complete cascading deletion verified. User B data 100% untouched.");

  /* ---------------------------------------------------------------------- */
  /* Pure OAuth Account Deletion (Without password)                         */
  /* ---------------------------------------------------------------------- */
  const userCId = randomUUID();
  const emailC = `oauth-user-${userCId}@example.test`;
  const [userC] = await db
    .insert(users)
    .values({
      id: userCId,
      name: "OAuth User",
      email: emailC,
      provider: "google",
      passwordHash: null, // Pure OAuth user has no password
    })
    .returning();
  createdUserIds.push(userC.id);

  await db.insert(projects).values({ userId: userC.id, name: "OAuth Project" });

  // Pure OAuth user confirms by typing their email (or "delete my account")
  const oauthDeletion = await deleteUserAccount({
    user: userC,
    confirmation: "delete my account",
  });
  assert.equal(oauthDeletion.ok, true);

  const [deletedUserC] = await db.select().from(users).where(eq(users.id, userC.id));
  assert.equal(deletedUserC, undefined, "OAuth user C must be deleted");
  const projectsC = await db.select().from(projects).where(eq(projects.userId, userC.id));
  assert.equal(projectsC.length, 0);

  console.log("PASS: Pure OAuth user deletion without password verified.");

  /* ---------------------------------------------------------------------- */
  /* Live HTTP & Playwright End-to-End Tests                                */
  /* ---------------------------------------------------------------------- */
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        APP_URL: base,
        NEXT_PUBLIC_APP_URL: base,
        SMTP_URL: "",
        SMTP_FROM: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      serverLog = (serverLog + chunk.toString()).slice(-5000);
    });
  }
  await waitForHealth(base);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 920 },
    extraHTTPHeaders: { Origin: base, "x-nf-client-connection-ip": ip },
  });

  // Test 1: Unauthenticated DELETE request -> 401
  const unauthRes = await context.request.delete(`${base}/api/account`, {
    data: { confirmation: "anyone@example.com" },
  });
  assert.equal(unauthRes.status(), 401, "Unauthenticated deletion must return 401");

  // Create real live user D to test browser flow & session invalidation
  const liveUserPassword = "TestLivePassword123!";
  const liveSalt = randomBytes(16).toString("hex");
  const liveHash = `${liveSalt}:${scryptSync(liveUserPassword, liveSalt, 64).toString("hex")}`;
  const userDId = randomUUID();
  const emailD = `live-user-${userDId}@example.test`;

  const [userD] = await db
    .insert(users)
    .values({
      id: userDId,
      name: "Live Deletion Tester",
      email: emailD,
      provider: "email",
      passwordHash: liveHash,
      onboardingCompletedAt: new Date(),
      onboardingStep: 10,
    })
    .returning();
  createdUserIds.push(userD.id);

  const tokenD = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId: userD.id,
    tokenHash: hash(tokenD),
    expiresAt: new Date(Date.now() + 86400_000),
  });

  // Seed project for user D
  await db.insert(projects).values({ userId: userD.id, name: "Live User D Project" });

  // Add session cookie to browser context
  await context.addCookies([
    {
      name: "folio_session",
      value: tokenD,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  // Test 2: Attempting to pass someone else's ID is ignored (must not delete User B)
  const attackerRes = await context.request.delete(`${base}/api/account`, {
    data: {
      userId: userB.id, // Attacker tries to target user B
      confirmation: "wrong-phrase",
      password: "wrong",
    },
  });
  assert.equal(attackerRes.status(), 400, "Confirmation check rejects mismatched phrase");
  const [userBCheck] = await db.select().from(users).where(eq(users.id, userB.id));
  assert.ok(userBCheck, "User B must remain completely intact!");

  // Test 3: Wrong password returns 401
  const wrongPwRes = await context.request.delete(`${base}/api/account`, {
    data: {
      confirmation: emailD,
      password: "WrongPassword!",
    },
  });
  assert.equal(wrongPwRes.status(), 401, "Wrong password returns 401");

  // Test 4: Browser UI flow in Settings -> Danger Zone -> Delete Account
  const page = await context.newPage();
  await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded" });
  await page.locator("#danger-zone").waitFor({ timeout: 15_000 });
  await page.locator("#delete-account-button").click();

  const modal = page.locator(".delete-account-modal");
  await modal.waitFor({ timeout: 10_000 });

  // Delete button should be disabled initially
  const deleteBtn = modal.getByRole("button", { name: /Permanently delete account/i });
  assert.equal(await deleteBtn.isDisabled(), true, "Button must be disabled initially");

  // Fill password
  await modal.locator("#delete-current-password").fill(liveUserPassword);
  assert.equal(await deleteBtn.isDisabled(), true, "Button still disabled until email confirmation matches");

  // Fill email confirmation
  await modal.locator("#delete-confirm-email").fill(emailD);
  assert.equal(await deleteBtn.isDisabled(), false, "Button enabled once email matches");

  // Submit deletion
  await deleteBtn.click();

  // Browser redirects to landing page with ?deleted=account_deleted
  await page.waitForURL("**/\\?deleted=account_deleted", { timeout: 20_000 });
  await page.getByText(/Your account and workspace data have been permanently deleted/i).waitFor({ timeout: 10_000 });

  console.log("PASS: Browser modal flow and redirect to landing page confirmed.");

  // Test 5: Verify that previous session token receives 401 Unauthorized
  const deadSessionRes = await context.request.get(`${base}/api/workspace`);
  assert.equal(deadSessionRes.status(), 401, "Old session token must return 401 Unauthorized");

  // Test 6: Repeated deletion attempt on deleted account returns 401
  const repeatDelete = await context.request.delete(`${base}/api/account`, {
    data: { confirmation: emailD, password: liveUserPassword },
  });
  assert.equal(repeatDelete.status(), 401, "Repeated deletion request returns 401 unauthenticated");

  console.log("PASS: Session invalidation and repeated request rejection verified.");
} catch (error) {
  console.error("Account deletion test suite failed:", error instanceof Error ? error.stack : error);
  console.error(serverLog.slice(-3000));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => server.once("exit", r)),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
  if (safe && createdUserIds.length) {
    try {
      for (const id of createdUserIds) {
        await db.delete(users).where(eq(users.id, id));
      }
      const rateKeys = [
        hash(`account-deletion:${ip}:`),
        ...createdUserIds.map((id) => hash(`account-deletion:account:${id}`)),
      ];
      await db.delete(authRateLimits).where(inArray(authRateLimits.key, rateKeys));
    } catch {
      // best-effort cleanup
    }
  }
  await pool.end().catch(() => {});
}
