#!/usr/bin/env node
// On-demand, LOCAL-ONLY capture of real Folio screens with a disposable account.
import { createRequire } from "node:module";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import sharp from "sharp";
import { and, eq, getTableColumns, isTable } from "drizzle-orm";
import { loadFolioEnv } from "./lib/env.mjs";

loadFolioEnv();
const mode = process.env.FOLIO_SCREENSHOT_MODE;
const screenshotUrl = process.env.SCREENSHOT_DATABASE_URL;
function failSafety(message) { throw new Error(`Screenshot safety check failed: ${message}`); }
if (mode !== "local") failSafety("set FOLIO_SCREENSHOT_MODE=local explicitly.");
if (process.env.NODE_ENV === "production" || process.env.NETLIFY || process.env.VERCEL || process.env.CONTEXT === "production" || process.env.APP_ENV === "production") failSafety("production/deployment environments are forbidden.");
if (!screenshotUrl) failSafety("set SCREENSHOT_DATABASE_URL to a dedicated local folio_screenshots database.");
let target;
try { target = new URL(screenshotUrl); } catch { failSafety("SCREENSHOT_DATABASE_URL is invalid."); }
const database = decodeURIComponent(target.pathname.slice(1));
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !/^folio_screenshots(?:_[a-z0-9_]+)?$/.test(database)) failSafety("only loopback PostgreSQL databases named folio_screenshots (or folio_screenshots_*) are permitted; remote Neon/production targets are refused.");
if (process.env.DATABASE_URL) {
  try { if (decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) === database) failSafety("SCREENSHOT_DATABASE_URL must use a different database from DATABASE_URL."); }
  catch (error) { if (error.message.startsWith("Screenshot safety")) throw error; failSafety("DATABASE_URL cannot be verified."); }
}
process.env.DATABASE_URL = screenshotUrl;
process.env.FOLIO_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const load = createRequire(import.meta.url)("./folio-test-loader.cjs");
const { db, pool } = load(resolve("src/db/index.ts"));
const schema = load(resolve("src/db/schema.ts"));
const { applySchema } = load(resolve("src/db/migrate.ts"));
const { seedWorkspace } = load(resolve("src/lib/seed.ts"));
const { DEFAULT_PERSONAL } = load(resolve("src/lib/personalization.ts"));
const { DEFAULT_NOTIFICATION_PREFERENCES } = load(resolve("src/lib/notifications.ts"));
const { sealToken } = load(resolve("src/lib/crypto.ts"));
const { users, sessions, projects, tasks, ideas, notifications, notificationPreferences, googleAccounts, googleCalendars, googleEvents, folioAiPreferences, folioAiConversations, folioAiMessages } = schema;
const userId = randomUUID();
const email = `screenshots+${userId}@example.invalid`;
const token = randomBytes(32).toString("hex");
const hash = value => createHash("sha256").update(value).digest("hex");
let browser, server, staging;
let cleanupSucceeded = false, captured = false, interrupted = false, databaseVerified = false, mayHaveUser = false;
const files = [];
const stop = () => { interrupted = true; if (browser) void browser.close(); if (server) server.kill("SIGTERM"); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
async function freePort() {
  const listener = createServer();
  await new Promise((res, rej) => listener.listen(0, "127.0.0.1", res).on("error", rej));
  const port = listener.address().port;
  await new Promise(res => listener.close(res));
  return port;
}
async function waitForServer(base) {
  for (let n = 0; n < 180; n++) {
    if (interrupted || server.exitCode !== null) throw new Error("Isolated Folio server stopped before becoming healthy.");
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return; } catch { /* wait */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("Isolated Folio server did not become healthy.");
}
function dateOffset(days) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
try {
  // An SSH tunnel to a remote database is not considered local just because its URL is loopback.
  const verification = await pool.query("select current_database() as db, inet_server_addr()::text as address");
  const actual = verification.rows[0];
  if (actual.db !== database || !['127.0.0.1', '::1', '127.0.0.1/32', '::1/128'].includes(actual.address)) failSafety("PostgreSQL did not report a loopback server and the expected dedicated database.");
  databaseVerified = true;
  console.log(`Verified dedicated local screenshot database: ${database}`);
  await applySchema(); // additive Folio schema only, in the explicitly isolated database
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const childEnv = { ...process.env, NODE_ENV: "development", APP_URL: base, NEXT_PUBLIC_APP_URL: base, GOOGLE_CLIENT_ID: "screenshot-placeholder", GOOGLE_CLIENT_SECRET: "screenshot-placeholder", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", SMTP_URL: "", SMTP_FROM: "", PORT: String(port) };
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = ""; for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { serverLog = (serverLog + chunk.toString()).slice(-4000); });
  try { await waitForServer(base); } catch (error) { console.error(serverLog); throw error; }
  mayHaveUser = true; // Set before insertion to handle an uncertain database response.
  await db.insert(users).values({ id: userId, name: "Alex Morgan", email, provider: "demo", weeklyGoal: 14, onboardingCompletedAt: new Date(), onboardingStep: 10, personal: { ...DEFAULT_PERSONAL, theme: "light" } });
  console.log(`Created temporary demo profile ${userId}`);
  await db.insert(sessions).values({ userId, tokenHash: hash(token), expiresAt: new Date(Date.now() + 60 * 60_000) });
  await db.insert(notificationPreferences).values({ userId, ...DEFAULT_NOTIFICATION_PREFERENCES, timezone: "UTC", timezoneAutoDetected: true });
  await db.insert(folioAiPreferences).values({ userId, assistantName: "Folio AI", presentation: "neutral", style: "friendly", modelPreference: "automatic" });
  await seedWorkspace(userId);
  const demoProjects = await db.select().from(projects).where(eq(projects.userId, userId));
  const demoTasks = await db.select().from(tasks).where(eq(tasks.userId, userId));
  const demoIdeas = await db.select().from(ideas).where(eq(ideas.userId, userId));
  assert.ok(demoProjects.length >= 4 && demoTasks.length >= 10 && demoIdeas.length >= 3, "Demo seed was incomplete.");
  await db.insert(notifications).values([
    { userId, category: "task", type: "task_due", title: "A little progress for today", description: "The design system review is ready for your attention.", dedupeKey: "demo-task" },
    { userId, category: "project", type: "project_update", title: "A milestone worth celebrating", description: "Foundations are complete for Folio Design System.", dedupeKey: "demo-project" },
    { userId, category: "calendar", type: "calendar_event", title: "Coming up next", description: "Your creative planning session is tomorrow.", dedupeKey: "demo-calendar" },
  ]);
  // Fictional mirror records only: no real Google account, access token or network call.
  const [account] = await db.insert(googleAccounts).values({ userId, googleUserId: `demo-${userId}`, email: "alex@example.test", name: "Alex Morgan", refreshTokenEnc: sealToken("fictional-noncredential"), scopes: ["https://www.googleapis.com/auth/calendar.readonly"], lastSyncAt: new Date(), lastSyncStatus: "success" }).returning();
  await db.insert(googleCalendars).values({ userId, accountId: account.id, calendarId: "fictional-primary", summary: "Creative studio", primary: true, visible: true, selected: true, backgroundColor: "#ad98cf" });
  await db.insert(googleEvents).values([0, 1, 3, 6].map((day, index) => ({ userId, accountId: account.id, calendarId: "fictional-primary", googleEventId: `example-${index}`, title: ["Creative planning", "Design review", "Studio focus time", "Campaign check-in"][index], startDate: dateOffset(day), endDate: dateOffset(day), startAt: new Date(`${dateOffset(day)}T10:00:00Z`), endAt: new Date(`${dateOffset(day)}T11:00:00Z`), timezone: "UTC" })));
  const [conversation] = await db.insert(folioAiConversations).values({ userId, title: "Plan a calmer week", messageCount: 2 }).returning();
  await db.insert(folioAiMessages).values([{ userId, conversationId: conversation.id, role: "user", content: "Help me make a thoughtful plan for this week." }, { userId, conversationId: conversation.id, role: "assistant", content: "Absolutely. Let’s start with your most important priorities, make room for focused work, and leave a little breathing space between tasks.", generationStatus: "complete", createdAt: new Date(Date.now() + 1000) }]);
  if (process.env.FOLIO_SCREENSHOT_FAIL_AFTER_SEED === "1") throw new Error("Intentional failure after seed, for cleanup verification.");
  staging = await mkdtemp(join(tmpdir(), "folio-capture-"));
  // SwiftShader provides an actual software WebGPU adapter in headless Chromium;
  // no AI model is downloaded or run during capture.
  browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", timezoneId: "UTC", locale: "en-US" });
  await context.addCookies([{ name: "folio_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(() => { localStorage.setItem("folio-theme", "light"); localStorage.setItem("folio.tasks.view", "board"); localStorage.setItem("folio.tasks.insights", "open"); });
  const page = await context.newPage();
  const project = demoProjects.find(p => p.name === "Folio Design System");
  assert.ok(project, "Expected seeded project was not found.");
  const screens = [
    { name: "dashboard", path: "/overview", ready: ".dash" },
    { name: "projects", path: "/projects", ready: ".pj-card" },
    { name: "project-details", path: `/projects/${project.id}`, ready: ".pw" },
    { name: "tasks-board", path: "/tasks", ready: ".tk-card", view: "Board" },
    { name: "tasks-list", path: "/tasks", ready: ".tk-list", view: "List" },
    { name: "tasks-calendar", path: "/tasks", ready: ".tk-cal", view: "Calendar" },
    { name: "ideas", path: "/ideas", ready: ".idea-card", board: true },
    { name: "calendar", path: "/calendar", ready: ".tk-cal", calendar: true },
    { name: "analytics", path: "/tasks", ready: ".tk-insights", view: "List" },
    { name: "folio-ai", path: "/ai", ready: ".fa-message", ai: true },
  ];
  for (const screen of screens) {
    if (interrupted) throw new Error("Capture interrupted.");
    await page.goto(`${base}${screen.path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    if (screen.view) { await page.locator(".tk-views").waitFor({ timeout: 60_000 }); await page.locator(".tk-views").getByRole("button", { name: screen.view, exact: true }).click(); }
    if (screen.board) { await page.locator(".idea-card").first().waitFor({ timeout: 60_000 }); await page.getByRole("button", { name: "Idea board view" }).click(); }
    await page.locator(screen.ready).first().waitFor({ timeout: 60_000 });
    if (screen.calendar) await page.locator(".gcal-card.is-compact").waitFor({ timeout: 30_000 });
    if (screen.ai) {
      await page.getByText("Help me make a thoughtful plan for this week.").waitFor({ timeout: 30_000 });
      await page.locator(".fa-compatibility.is-supported, .fa-compatibility.is-caution").waitFor({ timeout: 30_000 });
    }
    if (screen.path === "/tasks" || screen.path === "/projects") await page.waitForFunction(() => !document.querySelector('.sf-results-pending') && document.querySelector('.pj-results-count')?.textContent?.includes('matching'), { timeout: 30_000 });
    await page.waitForFunction(() => !document.querySelector('.pj-skeleton, .gcal-card.is-loading, .modal-backdrop, .sf-popover'), { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const text = await page.locator('body').innerText();
    assert.ok(!text.includes(email) && !text.includes(token), "Private fixture credentials appeared in the UI.");
    const alerts = (await page.locator('[role="alert"]:visible').allTextContents()).map(text => text.trim()).filter(Boolean);
    assert.equal(alerts.length, 0, `Visible error on ${screen.name}: ${alerts.map(text => text.slice(0, 180)).join("; ")}`);
    const png = await page.screenshot({ animations: "disabled" });
    const output = join(staging, `${screen.name}.png`);
    await sharp(png).png({ palette: true, colours: 256, effort: 8, quality: 95 }).toFile(output);
    const info = await sharp(output).metadata(); assert.equal(info.width, 1440); assert.equal(info.height, 1000);
    files.push(`${screen.name}.png`); console.log(`Captured ${screen.name}.png`);
  }
  await context.close();
  captured = true;
} catch (error) {
  console.error("Screenshot generation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) { server.kill("SIGTERM"); await Promise.race([new Promise(r => server.once("exit", r)), new Promise(r => setTimeout(r, 3000))]); }
  if (databaseVerified && mayHaveUser) {
    try {
      // All three conditions are required. Cascades are limited to this exact new user.
      await db.delete(users).where(and(eq(users.id, userId), eq(users.email, email), eq(users.provider, "demo")));
      const tables = Object.values(schema).filter(table => isTable(table) && getTableColumns(table).userId);
      for (const table of [users, ...tables]) {
        const column = table === users ? users.id : getTableColumns(table).userId;
        const remaining = await db.select().from(table).where(eq(column, userId)).limit(1);
        if (remaining.length) throw new Error("A demo-owned record remains after cleanup.");
      }
      const linkedFlows = await db.select().from(schema.authFlows).where(eq(schema.authFlows.linkUserId, userId)).limit(1);
      if (linkedFlows.length) throw new Error("A demo-owned authentication flow remains after cleanup.");
      cleanupSucceeded = true; console.log(`Cleanup verified for temporary demo profile ${userId}.`);
    } catch (error) { console.error(`Cleanup FAILED for temporary demo profile ${userId}:`, error instanceof Error ? error.message : error); process.exitCode = 1; }
  } else {
    console.log("No verified demo profile was created; no database cleanup was attempted.");
  }
  await pool.end().catch(() => {});
  const temporaryOutputs = [];
  try {
    if (captured && cleanupSucceeded && !interrupted) {
      const outputDir = resolve("public/screenshots"); await mkdir(outputDir, { recursive: true });
      for (const file of files) {
        const temporary = join(outputDir, `.${file}.${userId}.tmp`); temporaryOutputs.push(temporary);
        await copyFile(join(staging, file), temporary);
        await rename(temporary, join(outputDir, file));
      }
      console.log(`Published ${files.length} optimized screenshots to public/screenshots/.`);
    }
  } catch (error) { console.error("Publishing screenshots failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
  finally {
    for (const file of temporaryOutputs) await rm(file, { force: true }).catch(() => {});
    if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  if (interrupted) process.exitCode = 1;
}
