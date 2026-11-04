#!/usr/bin/env node
// Comprehensive automated verification for Folio's VIP Email Design System,
// Email Verification, Failure Resilience, Preview Studio, Notifications, and First-Login Concierge.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  throw new Error("VIP tests require FOLIO_SCREENSHOT_MODE=local and a dedicated loopback folio_screenshots database.");
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
const templates = load(resolve("src/lib/email/templates.ts"));
const mailer = load(resolve("src/lib/email/mailer.ts"));
const accountEvents = load(resolve("src/lib/account-events.ts"));

const { users, emailVerifications, passwordResets, notifications, authRateLimits } = schema;
const runId = randomUUID();
const hash = (v) => createHash("sha256").update(v).digest("hex");
const createdUserEmails = [];
const ip = `198.19.${parseInt(runId.slice(0, 2), 16)}.${parseInt(runId.slice(2, 4), 16)}`;

let safe = false;
let server;
let browser;
let serverLog = "";

async function freePort() {
  const s = createServer();
  await new Promise((ok, fail) => s.listen(0, "127.0.0.1", ok).on("error", fail));
  const p = s.address().port;
  await new Promise((ok) => s.close(ok));
  return p;
}

async function waitForHealth(base) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("Test Next.js server exited prematurely.");
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Test Next.js server did not become healthy.");
}

try {
  const { rows: [actual] } = await pool.query("select current_database() as db, inet_server_addr()::text as address");
  assert.equal(actual.db, database);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::1/128"].includes(actual.address));
  safe = true;
  await applySchema();

  /* ---------------------------------------------------------------------- */
  /* 1. Email Design System: All 6 templates, Gmail/Outlook, CTAs & Names   */
  /* ---------------------------------------------------------------------- */
  const origin = "https://folio.example.com";
  const sampleToken = randomBytes(32).toString("hex");

  const allSix = [
    {
      rendered: templates.buildWelcomeEmail({
        name: "Elena Rostova",
        email: "elena@example.test",
        appOrigin: origin,
        provider: "email",
        weeklyGoal: 14,
        workUses: ["Managing projects"],
      }),
      expectedCta: `${origin}/overview`,
    },
    {
      rendered: templates.buildEmailVerificationEmail({
        name: "Elena Rostova",
        email: "elena@example.test",
        token: sampleToken,
        expiresInHours: 24,
        appOrigin: origin,
      }),
      expectedCta: `${origin}/verify-email#token=${sampleToken}`,
    },
    {
      rendered: templates.buildPasswordResetEmail({
        name: "Elena Rostova",
        email: "elena@example.test",
        token: sampleToken,
        expiresInMinutes: 30,
        appOrigin: origin,
      }),
      expectedCta: `${origin}/recover#token=${sampleToken}`,
    },
    {
      rendered: templates.buildPasswordChangedEmail({
        name: "Elena Rostova",
        email: "elena@example.test",
        appOrigin: origin,
      }),
      expectedCta: `${origin}/recover`,
    },
    {
      rendered: templates.buildProviderLinkedEmail({
        name: "Elena Rostova",
        email: "elena@example.test",
        provider: "github",
        providerEmail: "elena@example.test",
        appOrigin: origin,
      }),
      expectedCta: `${origin}/settings`,
    },
    {
      rendered: templates.buildCalendarConnectedEmail({
        name: "Elena Rostova",
        email: "elena@example.test",
        googleEmail: "elena.calendar@example.test",
        writeEnabled: true,
        appOrigin: origin,
      }),
      expectedCta: `${origin}/calendar`,
    },
  ];

  for (const { rendered, expectedCta } of allSix) {
    assert.equal(rendered.ctaUrl, expectedCta, `${rendered.id} CTA route must match`);
    assert.ok(rendered.html.includes("<!DOCTYPE html>"), `${rendered.id} must have HTML5 doctype`);
    assert.ok(rendered.html.includes('role="presentation"'), `${rendered.id} must use presentation tables`);
    assert.ok(rendered.html.includes("@media only screen and (max-width: 620px)"), `${rendered.id} must include mobile responsive styles`);
    assert.ok(rendered.html.includes("v:roundrect") && rendered.html.includes("OfficeDocumentSettings"), `${rendered.id} must include Outlook VML button and DPI settings`);
    assert.ok(!/<img\b/i.test(rendered.html), `${rendered.id} must remain 100% readable when images are blocked`);
    assert.ok(Buffer.byteLength(rendered.html, "utf8") < 102_000, `${rendered.id} must stay well below Gmail 102KB clip limit`);
    assert.ok(rendered.html.includes(expectedCta), `${rendered.id} HTML must contain exact CTA URL`);
    assert.ok(rendered.text.includes(expectedCta), `${rendered.id} plain-text must contain exact CTA URL`);
  }

  // Edge cases: missing user name, 95-char long user name, and special HTML characters
  const missingNameMail = templates.buildWelcomeEmail({ name: "   ", email: "nameless@example.test", appOrigin: origin });
  assert.ok(missingNameMail.html.includes("Hello,"), "Missing user name falls back cleanly to 'Hello,'");
  assert.ok(!missingNameMail.html.includes("undefined") && !missingNameMail.subject.includes("undefined"));

  const veryLongName = "Alexandrina Bartholomew-Featherstonehaugh-Montgomery-Winchester-Sutherland IV";
  const longNameMail = templates.buildWelcomeEmail({ name: veryLongName, email: "long@example.test", appOrigin: origin });
  assert.ok(longNameMail.html.includes("…,"), "Long user name is gracefully truncated with ellipsis");
  assert.ok(!longNameMail.html.includes(veryLongName), "Raw 80+ char name does not overflow mobile header");

  const xssMail = templates.buildWelcomeEmail({ name: '<script>alert("xss")</script> & Studio', email: "xss@example.test", appOrigin: origin });
  assert.ok(!xssMail.html.includes("<script>"), "User names are strictly HTML-escaped");
  assert.ok(xssMail.html.includes("&lt;script&gt;"));
  console.log("PASS: All 6 email templates verified (Desktop, Mobile, Gmail, Outlook VML, blocked images, CTA routes, missing/long/XSS names).");

  /* ---------------------------------------------------------------------- */
  /* 2. Mailer Resilience: Missing Env, SMTP Failures & Single-Send Welcome */
  /* ---------------------------------------------------------------------- */
  const unitEmail = `vip-mailer+${runId}@example.test`;
  createdUserEmails.push(unitEmail);

  // Pre-creation safety: never send welcome email before account exists
  const sentMessages = [];
  mailer.setEmailTransportFactoryForTests(() => ({
    sendMail: async (msg) => {
      sentMessages.push(msg);
      return { messageId: randomUUID() };
    },
  }));
  const preCreation = await mailer.sendWelcomeEmailOnce({ userId: randomUUID(), appOrigin: origin });
  assert.equal(preCreation.sent, false);
  assert.equal(preCreation.skipped, "missing_user");
  assert.equal(sentMessages.length, 0, "Zero emails sent before user exists in DB");

  const [mailerUser] = await db
    .insert(users)
    .values({ name: "Mailer Tester", email: unitEmail, provider: "email" })
    .returning();

  // Missing env vars when test transport is disabled
  mailer.setEmailTransportFactoryForTests(null);
  const oldSmtpUrl = process.env.SMTP_URL;
  const oldSmtpFrom = process.env.SMTP_FROM;
  delete process.env.SMTP_URL;
  delete process.env.SMTP_FROM;
  const unconfiguredOutcome = await mailer.sendWelcomeEmailOnce({ userId: mailerUser.id, appOrigin: origin });
  assert.equal(unconfiguredOutcome.sent, false);
  assert.equal(unconfiguredOutcome.skipped, "unconfigured");

  // SMTP transport failure rolls back welcomeEmailSentAt and never falsely claims delivery
  mailer.setEmailTransportFactoryForTests(() => ({
    sendMail: async () => {
      throw new Error("ECONNREFUSED simulated SMTP outage");
    },
  }));
  const failedOutcome = await mailer.sendWelcomeEmailOnce({ userId: mailerUser.id, appOrigin: origin });
  assert.equal(failedOutcome.sent, false);
  const [afterFailure] = await db.select().from(users).where(eq(users.id, mailerUser.id));
  assert.equal(afterFailure.welcomeEmailSentAt, null, "Failed SMTP send must NOT mark welcomeEmailSentAt");

  // Working transport: concurrent calls send strictly ONE welcome email
  mailer.setEmailTransportFactoryForTests(() => ({
    sendMail: async (msg) => {
      sentMessages.push(msg);
      return { messageId: randomUUID() };
    },
  }));
  const [sendA, sendB] = await Promise.all([
    mailer.sendWelcomeEmailOnce({ userId: mailerUser.id, appOrigin: origin }),
    mailer.sendWelcomeEmailOnce({ userId: mailerUser.id, appOrigin: origin }),
  ]);
  assert.equal( Number(sendA.sent) + Number(sendB.sent), 1, "Concurrent welcome calls send strictly once");
  assert.equal(sentMessages.length, 1);

  // Account lifecycle notifications do not duplicate on repeat calls
  await accountEvents.onAccountCreated({ user: mailerUser, appOrigin: origin });
  await accountEvents.onAccountCreated({ user: mailerUser, appOrigin: origin });
  const welcomeNotifs = await db.select().from(notifications).where(eq(notifications.userId, mailerUser.id));
  assert.equal(welcomeNotifs.length, 1, "Welcome in-app notification is strictly deduplicated");

  mailer.setEmailTransportFactoryForTests(null);
  if (oldSmtpUrl !== undefined) process.env.SMTP_URL = oldSmtpUrl;
  if (oldSmtpFrom !== undefined) process.env.SMTP_FROM = oldSmtpFrom;
  console.log("PASS: Missing env handling, SMTP outage rollback, pre-creation block, and duplicate welcome prevention.");

  /* ---------------------------------------------------------------------- */
  /* 3. Live Server + Playwright Browser: Preview, Verification & Concierge */
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
        // This suite exercises the email verification UI, so the frontend flag is on.
        NEXT_PUBLIC_EMAIL_FEATURES_ENABLED: "true",
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

  // A. Preview every email template locally at /dev/emails (Desktop, Mobile, Missing/Long names, Audit)
  const previewPage = await context.newPage();
  await previewPage.goto(`${base}/dev/emails`, { waitUntil: "domcontentloaded" });
  await previewPage.getByText("Folio Email Design System").waitFor({ timeout: 60_000 });
  for (const label of ["Welcome Email", "Email Verification", "Password Reset", "Password Changed", "Provider Linked", "Calendar Connected"]) {
    await previewPage.getByRole("tab", { name: new RegExp(label) }).click();
    await previewPage.getByRole("button", { name: "Client & CTA audit" }).click();
    await previewPage.getByText("5 / 5 checks passing").waitFor({ timeout: 10_000 });
  }
  await previewPage.getByRole("button", { name: /Missing name/ }).click();
  await previewPage.getByRole("button", { name: "Mobile (375px)" }).click();
  const iframeWidth = await previewPage.locator("iframe").evaluate((el) => el.getBoundingClientRect().width);
  assert.equal(Math.round(iframeWidth), 375, "Mobile preview renders 375px viewport");
  await previewPage.close();
  console.log("PASS: Local /dev/emails preview studio verified across all 6 templates, mobile viewport, and compatibility audit.");

  // B. Complete First-Login Onboarding, Concierge Checklist, Email Verification & Expired/Invalid Links
  const journeyEmail = `vip-journey+${runId}@example.test`;
  createdUserEmails.push(journeyEmail);
  const page = await context.newPage();
  await page.goto(`${base}/signup`, { waitUntil: "domcontentloaded" });
  // Submit only after React has attached its handlers (dev-mode hydration can lag the DOM).
  await page.waitForFunction(
    () => {
      const form = document.querySelector("form#auth-email-form");
      return Boolean(form) && Object.keys(form).some((key) => key.startsWith("__reactProps"));
    },
    undefined,
    { timeout: 90_000 },
  );
  await page.getByLabel("Your name").fill("Elena Rostova");
  await page.getByLabel("Email address").fill(journeyEmail);
  await page.getByLabel("Password", { exact: true }).fill("ThoughtfulPassphrase2026!");
  await page.getByRole("button", { name: /Create my workspace/ }).click();

  // Lands on personalized /onboarding welcome with one-click smart-default quick entry
  await page.waitForURL("**/onboarding**", { timeout: 60_000 });
  await page.getByRole("heading", { name: /Welcome to Folio, Elena\./ }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /Use smart defaults & open workspace/ }).click();

  // Lands on /overview with First-Login Workspace Concierge
  await page.waitForURL("**/overview", { timeout: 60_000 });
  await page.getByRole("heading", { name: /Welcome to your Folio workspace, Elena\./ }).waitFor({ timeout: 60_000 });
  await page.getByText("1 of 4 completed").waitFor({ timeout: 10_000 });

  // Notification Center displays the personalized Welcome notification
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.getByText("Welcome to Folio, Elena").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Close notification center" }).click();

  // Create first project via Concierge CTA and verify live progress -> 2 of 4 completed
  await page.locator(".vip-concierge").getByRole("button", { name: "Create project" }).click();
  const projectDialog = page.getByRole("dialog");
  await projectDialog.waitFor({ timeout: 10_000 });
  await projectDialog.locator('input[type="text"], input:not([type])').first().fill("Q4 Product Architecture");
  await projectDialog.getByRole("button", { name: /Create project/i }).click();
  await page.getByText("2 of 4 completed").waitFor({ timeout: 15_000 });

  // Dismiss Concierge and confirm persistence across reload
  await page.getByRole("button", { name: "Dismiss guide" }).click();
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".dash-hero").waitFor({ timeout: 15_000 });
  assert.equal(await page.locator(".vip-concierge").count(), 0, "Dismissed onboarding guide stays dismissed after reload");

  // Unconfigured SMTP honestly reports 503 on email verification request
  const verifyReqRes = await context.request.post(`${base}/api/auth/verify`, { data: { action: "request" } });
  assert.equal(verifyReqRes.status(), 503);

  // Test invalid, expired, and valid email verification links + replay rejection
  const [journeyUser] = await db.select().from(users).where(eq(users.email, journeyEmail));
  const invalidToken = "f".repeat(64);
  const expiredVerifyToken = randomBytes(32).toString("hex");
  const validVerifyToken = randomBytes(32).toString("hex");

  await db.insert(emailVerifications).values([
    {
      tokenHash: hash(expiredVerifyToken),
      userId: journeyUser.id,
      email: journeyEmail,
      expiresAt: new Date(Date.now() - 60_000),
    },
    {
      tokenHash: hash(validVerifyToken),
      userId: journeyUser.id,
      email: journeyEmail,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  ]);

  const invalidRes = await context.request.post(`${base}/api/auth/verify`, {
    data: { action: "confirm", token: invalidToken },
  });
  assert.equal(invalidRes.status(), 400);
  assert.equal((await invalidRes.json()).code, "invalid");

  await page.goto(`${base}/verify-email#token=${expiredVerifyToken}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /This link has expired\./ }).waitFor({ timeout: 15_000 });

  await page.goto(`${base}/verify-email#token=${validVerifyToken}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Your email is verified\./ }).waitFor({ timeout: 15_000 });

  const replayRes = await context.request.post(`${base}/api/auth/verify`, {
    data: { action: "confirm", token: validVerifyToken },
  });
  assert.equal(replayRes.status(), 400, "Used verification link cannot be replayed");

  // Test expired & invalid password reset links
  const expiredResetToken = randomBytes(32).toString("hex");
  await db.insert(passwordResets).values({
    tokenHash: hash(expiredResetToken),
    userId: journeyUser.id,
    expiresAt: new Date(Date.now() - 60_000),
  });
  const expiredResetRes = await context.request.post(`${base}/api/auth/recovery`, {
    data: { action: "reset", token: expiredResetToken, password: "NewValidPassword2026!" },
  });
  assert.equal(expiredResetRes.status(), 400);
  const invalidResetRes = await context.request.post(`${base}/api/auth/recovery`, {
    data: { action: "reset", token: "a".repeat(64), password: "NewValidPassword2026!" },
  });
  assert.equal(invalidResetRes.status(), 400);

  console.log("PASS: Complete first-login journey, live checklist progress, persistent dismissal, notifications, and valid/expired/invalid verification & reset links.");
} catch (error) {
  console.error("VIP test suite failed:", error instanceof Error ? error.stack : error);
  console.error(serverLog.slice(-3500));
  process.exitCode = 1;
} finally {
  mailer.setEmailTransportFactoryForTests(null);
  if (browser) await browser.close().catch(() => {});
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => server.once("exit", r)),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
  if (safe && createdUserEmails.length) {
    try {
      for (const email of createdUserEmails) {
        const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
        for (const row of rows) {
          await db.delete(users).where(and(eq(users.id, row.id), eq(users.email, email)));
        }
      }
      const rateKeys = [
        hash(`credentials:${ip}:`),
        hash(`email-verify:${ip}:`),
        hash(`recovery:${ip}:`),
        ...createdUserEmails.flatMap((email) => [
          hash(`credentials-email:account:${email}`),
          hash(`email-verify-account:account:${email}`),
        ]),
      ];
      await db.delete(authRateLimits).where(inArray(authRateLimits.key, rateKeys));
      const leftover = await db.select({ id: users.id }).from(users).where(inArray(users.email, createdUserEmails));
      assert.equal(leftover.length, 0);
      console.log("PASS: Scoped VIP test records cleaned up.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr);
      process.exitCode = 1;
    }
  }
  await pool.end().catch(() => {});
}
