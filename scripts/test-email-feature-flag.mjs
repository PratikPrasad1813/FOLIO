#!/usr/bin/env node
// Verifies the NEXT_PUBLIC_EMAIL_FEATURES_ENABLED frontend flag in BOTH states, against
// fictional accounts in the dedicated loopback folio_screenshots database.
//
// Disabled (default): email UI is hidden or replaced with a calm notice; nothing claims an
// email was sent; the browser never calls verification endpoints; the UI never changes
// email_verified_at; sign-in, OAuth, sessions and protected routes keep working.
// Enabled: the same UI is restored, and failures show generic messages.
// SMTP is unconfigured in this suite, so every delivery attempt must fail generically.
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
    "Email feature flag tests require FOLIO_SCREENSHOT_MODE=local and a dedicated loopback folio_screenshots database.",
  );
}

process.env.DATABASE_URL = screenshotUrl;
process.env.FOLIO_ENCRYPTION_KEY = randomBytes(32).toString("hex");

const load = createRequire(import.meta.url)("./folio-test-loader.cjs");

// Create the dedicated loopback test database if it does not exist yet.
try {
  const { Client } = load("pg");
  for (const fallbackDb of ["postgres", "app_db"]) {
    try {
      const u = new URL(screenshotUrl);
      u.pathname = `/${fallbackDb}`;
      const client = new Client({ connectionString: u.toString() });
      await client.connect();
      const check = await client.query("select 1 from pg_database where datname = $1", [database]);
      if (!check.rows.length) await client.query(`create database ${database}`);
      await client.end();
      break;
    } catch {
      // try the next maintenance database
    }
  }
} catch {
  // best-effort; the schema check below reports any real problem
}

const { db, pool } = load(resolve("src/db/index.ts"));
const { applySchema } = load(resolve("src/db/migrate.ts"));
const { users, sessions, emailVerifications, passwordResets, authRateLimits } = load(resolve("src/db/schema.ts"));

const run = randomUUID();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const PASSWORD = "ThoughtfulPassphrase2026!";
const salt = randomBytes(16).toString("hex");
const PASSWORD_HASH = `${salt}:${scryptSync(PASSWORD, salt, 64).toString("hex")}`;
const ip = `198.21.${parseInt(run.slice(0, 2), 16)}.${parseInt(run.slice(2, 4), 16)}`;
const NOTICE = /temporarily unavailable/i;
const SETUP_NOTICE =
  "Email verification and password recovery are temporarily unavailable while we finish setting up our email services.";
const TECHNICAL = /smtp|SMTP_URL|ECONN|password_hash|nodemailer|stack trace/i;

const accounts = {
  unverified: `flag-unverified+${run}@example.test`,
  verified: `flag-verified+${run}@example.test`,
  google: `flag-google+${run}@example.test`,
  verifyTarget: `flag-verify+${run}@example.test`,
  resetTarget: `flag-reset+${run}@example.test`,
  registration: `flag-register+${run}@example.test`,
};
const emails = Object.values(accounts);
const ids = {};
const SESSION = { unverified: randomBytes(32).toString("hex"), google: randomBytes(32).toString("hex") };
const CONFIRM_TOKEN = randomBytes(32).toString("hex");
const RESET_TOKEN = randomBytes(32).toString("hex");

let safe = false;
let browserStarted = false;

async function freePort() {
  const s = createServer();
  await new Promise((ok, fail) => s.listen(0, "127.0.0.1", ok).on("error", fail));
  const port = s.address().port;
  await new Promise((ok) => s.close(ok));
  return port;
}

async function waitForHealth(base, server) {
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error("Test Next.js server exited prematurely.");
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

async function seed() {
  const now = new Date();
  const rows = [
    { key: "unverified", name: "Unverified Example", email: accounts.unverified, passwordHash: PASSWORD_HASH, provider: "email", emailVerifiedAt: null },
    { key: "verified", name: "Verified Example", email: accounts.verified, passwordHash: PASSWORD_HASH, provider: "email", emailVerifiedAt: now },
    { key: "google", name: "Google Example", email: accounts.google, passwordHash: null, provider: "google", emailVerifiedAt: now },
    { key: "verifyTarget", name: "Verify Target", email: accounts.verifyTarget, passwordHash: PASSWORD_HASH, provider: "email", emailVerifiedAt: null },
    { key: "resetTarget", name: "Reset Target", email: accounts.resetTarget, passwordHash: PASSWORD_HASH, provider: "email", emailVerifiedAt: null },
  ];
  for (const row of rows) {
    const [user] = await db
      .insert(users)
      .values({
        name: row.name,
        email: row.email,
        passwordHash: row.passwordHash,
        provider: row.provider,
        emailVerifiedAt: row.emailVerifiedAt,
        onboardingCompletedAt: now,
        onboardingStep: 10,
      })
      .returning();
    ids[row.key] = user.id;
  }
  await db.insert(sessions).values([
    { userId: ids.unverified, tokenHash: hash(SESSION.unverified), expiresAt: new Date(Date.now() + 86_400_000) },
    { userId: ids.google, tokenHash: hash(SESSION.google), expiresAt: new Date(Date.now() + 86_400_000) },
  ]);
  await db.insert(emailVerifications).values({
    tokenHash: hash(CONFIRM_TOKEN),
    userId: ids.verifyTarget,
    email: accounts.verifyTarget,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(passwordResets).values({
    tokenHash: hash(RESET_TOKEN),
    userId: ids.resetTarget,
    expiresAt: new Date(Date.now() + 1_800_000),
  });
}

function newContext(browser, base) {
  return browser.newContext({
    viewport: { width: 1360, height: 920 },
    extraHTTPHeaders: { Origin: base, "x-nf-client-connection-ip": ip },
  });
}

// Wait until React has attached its handlers, so the form submits through the app (not natively).
async function waitForHydrated(page, selector) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el) && Object.keys(el).some((key) => key.startsWith("__reactProps"));
    },
    selector,
    { timeout: 90_000 },
  );
}

async function signInUi(page, base, email) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitForHydrated(page, "form#auth-email-form");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /Sign in to Folio/ }).click();
  try {
    await page.waitForURL("**/overview", { timeout: 60_000 });
  } catch {
    const alerts = await page.locator('[role="alert"]').allInnerTexts();
    throw new Error(`Sign-in did not reach /overview (url ${page.url()}, alerts: ${alerts.join(" | ") || "none"})`);
  }
}

function assertNoTechnicalDetails(text) {
  assert.ok(!TECHNICAL.test(text), `Response exposed technical detail: ${text.slice(0, 160)}`);
}

async function checksDisabled(base, browser) {
  console.log("-- Flag DISABLED --");
  const ctx = await newContext(browser, base);
  const page = await ctx.newPage();

  // Sign-in page: no recovery link; provider buttons and email sign-in still present.
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByRole("button", { name: /Continue with Google/ }).waitFor({ timeout: 90_000 });
  assert.equal(await page.getByText("Forgot your password?").count(), 0, "Recovery link hidden");
  assert.equal(await page.getByRole("button", { name: /Continue with GitHub/ }).count(), 1, "GitHub sign-in still offered");

  // Recovery page: no form and no fake success; calm notice only.
  await page.goto(`${base}/recover`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator(".folio-notice").waitFor({ timeout: 90_000 });
  assert.ok((await page.locator(".folio-notice").textContent()).includes(SETUP_NOTICE), "Recovery notice shown");
  assert.equal(await page.getByLabel("Email address", { exact: true }).count(), 0, "No recovery request form");

  // Verify link: unavailable, and the browser never calls the verification API.
  const verifyCalls = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/auth/verify")) verifyCalls.push(request.url());
  });
  await page.goto(`${base}/verify-email#token=${"a".repeat(64)}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator(".folio-notice").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(800);
  assert.equal(verifyCalls.length, 0, "Verify page makes no API call while disabled");
  assert.equal(await page.getByRole("heading", { name: /Your email is verified|Link couldn/ }).count(), 0);

  // Unverified email account: calm notice, no verification action, no false "sent" claim.
  await signInUi(page, base, accounts.unverified);
  await page.locator(".vip-concierge").waitFor({ timeout: 90_000 });
  assert.equal(await page.getByRole("button", { name: /Send verification link/ }).count(), 0, "No send button");
  assert.ok((await page.locator(".vip-concierge .folio-notice").textContent()).includes(SETUP_NOTICE), "Concierge notice shown");
  assert.equal(await page.getByText(/verification link sent/i).count(), 0, "No false 'sent' message");

  // Settings: no verify control, no 'Email unverified' chip; provider linking still available.
  await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByText("Sign-in method").waitFor({ timeout: 90_000 });
  assert.equal(await page.getByRole("button", { name: /Verify email address/ }).count(), 0, "No settings verify button");
  assert.equal(await page.getByText("Email unverified").count(), 0, "No unverified chip");
  assert.ok((await page.locator(".folio-notice").first().textContent()).includes(SETUP_NOTICE), "Settings notice shown");
  assert.equal(await page.getByRole("link", { name: /Link Google/ }).count(), 1, "Google linking still available");

  // Backend stays live but reports generic, non-technical messages.
  const recoveryApi = await ctx.request.post(`${base}/api/auth/recovery`, { data: { action: "request", email: accounts.unverified } });
  assert.equal(recoveryApi.status(), 503, "Recovery request is refused when delivery is unconfigured");
  const recoveryBody = await recoveryApi.text();
  assertNoTechnicalDetails(recoveryBody);
  const verifyApi = await ctx.request.post(`${base}/api/auth/verify`, { data: { action: "request" } });
  assert.equal(verifyApi.status(), 503, "Verification request is refused when delivery is unconfigured");
  assertNoTechnicalDetails(await verifyApi.text());

  // Sign-in and sessions: an existing session still reaches the workspace (Google account).
  const googleCtx = await newContext(browser, base);
  await googleCtx.addCookies([{ name: "folio_session", value: SESSION.google, url: base, httpOnly: true, sameSite: "Lax" }]);
  const googlePage = await googleCtx.newPage();
  await googlePage.goto(`${base}/overview`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await googlePage.locator(".dash-hero").waitFor({ timeout: 90_000 });
  assert.ok(googlePage.url().endsWith("/overview"), "Existing Google session stays signed in");
  assert.equal(await googlePage.locator(".vip-concierge .folio-notice").count(), 0, "Verified account sees no email notice");
  assert.equal(await googlePage.getByRole("button", { name: /Send verification link/ }).count(), 0);
  await googleCtx.close();

  // OAuth start still redirects to the real providers.
  const google = await ctx.request.get(`${base}/api/auth/oauth/google?next=%2Foverview`, { maxRedirects: 0 });
  assert.equal(google.status(), 302, "Google OAuth starts");
  assert.ok(google.headers().location.startsWith("https://accounts.google.com/"));
  const github = await ctx.request.get(`${base}/api/auth/oauth/github?next=%2Fprojects`, { maxRedirects: 0 });
  assert.equal(github.status(), 302, "GitHub OAuth starts");
  assert.ok(github.headers().location.startsWith("https://github.com/login/oauth/authorize"));

  // Protected routes stay protected for anonymous visitors.
  const anon = await newContext(browser, base);
  const protectedPage = await anon.request.get(`${base}/projects`, { maxRedirects: 0 });
  assert.ok([302, 307].includes(protectedPage.status()), "Protected page redirects");
  assert.ok(protectedPage.headers().location.includes("/login"), "Redirect goes to sign-in");
  assert.equal((await anon.request.get(`${base}/api/workspace`)).status(), 401, "Workspace API stays protected");
  await anon.close();

  // Registration still works and the new account is honestly unverified.
  const registered = await ctx.request.post(`${base}/api/auth`, {
    data: { action: "register", name: "Registration Check", email: accounts.registration, password: PASSWORD, next: "/overview" },
  });
  assert.equal(registered.status(), 200, "Email registration works");
  const registeredBody = await registered.json();
  assert.equal(registeredBody.user.emailVerified, false, "New email account is not marked verified");

  // Backend confirmation still works: a valid, fresh token verifies the address, and only that.
  const confirm = await ctx.request.post(`${base}/api/auth/verify`, { data: { action: "confirm", token: CONFIRM_TOKEN } });
  assert.equal(confirm.status(), 200, "Backend verification still validates tokens");
  const [confirmed] = await db.select().from(users).where(eq(users.id, ids.verifyTarget));
  assert.ok(confirmed.emailVerifiedAt, "Valid token sets email_verified_at");
  const replay = await ctx.request.post(`${base}/api/auth/verify`, { data: { action: "confirm", token: CONFIRM_TOKEN } });
  assert.equal(replay.status(), 400, "Verification tokens are single-use");

  // Backend reset: single-use, and it must NOT mark the address verified.
  const reset = await ctx.request.post(`${base}/api/auth/recovery`, {
    data: { action: "reset", token: RESET_TOKEN, password: "NewThoughtfulPassphrase2026!" },
  });
  assert.equal(reset.status(), 200, "Backend reset still validates tokens");
  const [afterReset] = await db.select().from(users).where(eq(users.id, ids.resetTarget));
  assert.equal(afterReset.emailVerifiedAt, null, "A password reset never marks the email verified");
  const resetReplay = await ctx.request.post(`${base}/api/auth/recovery`, {
    data: { action: "reset", token: RESET_TOKEN, password: "NewThoughtfulPassphrase2026!" },
  });
  assert.equal(resetReplay.status(), 400, "Reset tokens are single-use");

  // The email-password account still signs in through the UI.
  const verifiedCtx = await newContext(browser, base);
  const verifiedPage = await verifiedCtx.newPage();
  await signInUi(verifiedPage, base, accounts.verified);
  await verifiedPage.locator(".dash-hero").waitFor({ timeout: 90_000 });
  await verifiedCtx.close();

  await ctx.close();
  console.log("PASS: flag disabled: hidden UI, no false claims, no UI-driven verification changes, generic backend errors, auth and OAuth intact.");
}

async function checksEnabled(base, browser) {
  console.log("-- Flag ENABLED (re-enabled) --");
  const ctx = await newContext(browser, base);
  const page = await ctx.newPage();

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByText("Forgot your password?").waitFor({ timeout: 90_000 });

  await page.goto(`${base}/recover`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByLabel("Email address", { exact: true }).waitFor({ timeout: 90_000 });
  assert.equal(await page.locator(".folio-notice").count(), 0, "Recovery form is restored");
  await page.getByLabel("Email address", { exact: true }).fill(accounts.resetTarget);
  await page.getByRole("button", { name: /Send recovery link/ }).click();
  await page.getByRole("alert").waitFor({ timeout: 90_000 });
  assertNoTechnicalDetails(await page.getByRole("alert").innerText());

  // Unverified account: the verification action is back; delivery is unconfigured here,
  // so the user sees a generic failure and never a false "sent" message.
  await signInUi(page, base, accounts.unverified);
  await page.getByRole("button", { name: /Send verification link/ }).click();
  await page.locator(".vip-verify-feedback").waitFor({ timeout: 90_000 });
  const feedback = await page.locator(".vip-verify-feedback").innerText();
  assertNoTechnicalDetails(feedback);
  assert.ok(feedback.length > 0 && !/sent to/i.test(feedback), "Failure is reported honestly");

  await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByRole("button", { name: /Verify email address/ }).waitFor({ timeout: 90_000 });

  // Verified account: no verification prompt.
  const verifiedCtx = await newContext(browser, base);
  const verifiedPage = await verifiedCtx.newPage();
  await signInUi(verifiedPage, base, accounts.verified);
  await verifiedPage.locator(".vip-concierge").waitFor({ timeout: 90_000 });
  assert.equal(await verifiedPage.locator(".vip-verify-strip").count(), 0, "Verified account has no prompt");
  await verifiedCtx.close();

  // Verification page: an invalid token shows the calm, specific error.
  await page.goto(`${base}/verify-email#token=${"b".repeat(64)}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByRole("heading", { name: /Link couldn/ }).waitFor({ timeout: 90_000 });

  await ctx.close();
  console.log("PASS: flag re-enabled: recovery, verification prompts and actions are restored; failures stay generic.");
}

async function runMode(enabled, browser) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        APP_URL: base,
        NEXT_PUBLIC_APP_URL: base,
        NEXT_PUBLIC_EMAIL_FEATURES_ENABLED: enabled ? "true" : "false",
        SMTP_URL: "",
        SMTP_FROM: "",
        GOOGLE_CLIENT_ID: "test-google-client",
        GOOGLE_CLIENT_SECRET: "test-google-secret",
        GITHUB_CLIENT_ID: "test-github-client",
        GITHUB_CLIENT_SECRET: "test-github-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      log = (log + chunk.toString()).slice(-5000);
    });
  }
  try {
    await waitForHealth(base, server);
    if (enabled) await checksEnabled(base, browser);
    else await checksDisabled(base, browser);
  } catch (error) {
    console.error(log.slice(-3000));
    throw error;
  } finally {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => server.once("exit", r)),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
}

try {
  const { rows: [actual] } = await pool.query("select current_database() as db, inet_server_addr()::text as address");
  assert.equal(actual.db, database);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::1/128"].includes(actual.address));
  safe = true;
  await applySchema();
  await seed();

  const browser = await chromium.launch({ headless: true });
  browserStarted = true;
  try {
    await runMode(false, browser);
    await runMode(true, browser);
  } finally {
    await browser.close();
  }
  console.log("PASS: email feature flag verified in both states.");
} catch (error) {
  console.error("Email feature flag test failed:", error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (safe) {
    try {
      for (const email of emails) {
        const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
        for (const row of rows) await db.delete(users).where(and(eq(users.id, row.id), eq(users.email, email)));
      }
      const keys = [
        ...["credentials", "recovery", "email-verify", "oauth"].map((p) => hash(`${p}:${ip}:`)),
        ...["credentials-email", "recovery-email", "email-verify-account"].flatMap((p) =>
          emails.map((e) => hash(`${p}:account:${e}`)),
        ),
      ];
      await db.delete(authRateLimits).where(inArray(authRateLimits.key, keys));
      const leftover = await db.select({ id: users.id }).from(users).where(inArray(users.email, emails));
      assert.equal(leftover.length, 0, "Test accounts removed");
      console.log("PASS: scoped email-flag test accounts and data cleaned up.");
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError);
      process.exitCode = 1;
    }
  }
  await pool.end().catch(() => {});
  if (!browserStarted) console.error("Browser did not start.");
}
