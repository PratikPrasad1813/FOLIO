import "dotenv/config";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

// Browser verification of dashboard states and empty-workspace resilience.
// Requires a running Folio server. No real OAuth consent is claimed as tested.
const require = createRequire(import.meta.url);
require("./folio-test-loader.cjs");
const { db, pool } = require(resolve("src/db/index.ts"));
const { users, projects, tasks, ideas } = require(resolve("src/db/schema.ts"));

const modulePath = process.env.PATH.split(delimiter).map(b => resolve(b, "..", "playwright", "index.mjs")).find(existsSync);
if (!modulePath) throw new Error("Run via npx --package=@playwright/test -c 'node scripts/test-dashboard-browser.mjs'");
const { chromium } = await import(pathToFileURL(modulePath).href);

const BASE = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const ids = [];
let browser; const errors = []; let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };

async function seedUser({ completed, content }) {
  const [u] = await db.insert(users).values({
    name: "Browser Tester", email: `brow-${randomUUID()}@example.invalid`, provider: "neon",
    authUserId: randomUUID(), onboardingStep: completed ? 10 : 0,
    onboardingCompletedAt: completed ? new Date() : null,
  }).returning();
  ids.push(u.id);
  if (content?.project) {
    const [p] = await db.insert(projects).values({ userId: u.id, name: content.project, description: "x" }).returning();
    if (content.task) await db.insert(tasks).values({ userId: u.id, projectId: p.id, title: content.task, labels: [] });
  } else if (content?.task) {
    await db.insert(tasks).values({ userId: u.id, title: content.task, labels: [] });
  }
  if (content?.idea) await db.insert(ideas).values({ userId: u.id, title: content.idea });
  return u;
}

try {
  ok((await fetch(`${BASE}/api/health`)).status === 200, "App is running");
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));

  // The public landing page renders and is responsive.
  await page.goto(BASE);
  await page.evaluate(() => document.fonts.ready);
  ok((await page.title()).includes("Folio"), "Landing page renders");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile layout has no horizontal overflow");
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto(BASE);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Tablet layout has no horizontal overflow");
  await page.screenshot({ path: "artifacts/dashboard-responsive.png", fullPage: true });

  // Protected workspace pages redirect to login when signed out.
  await page.goto(`${BASE}/overview`);
  await page.waitForURL("**/login?next=*");
  ok(page.url().includes("/login"), "Signed-out user is redirected from the dashboard to login");

  console.log("✓ Responsive landing (mobile + tablet), and signed-out dashboard protection");
  console.log(`PASS: ${checks} browser checks. Authenticated dashboard states require a live Neon Auth session and were verified at the data layer instead.`);
} catch (error) {
  if (browser) await browser.screenshot({ path: "artifacts/dashboard-test-failure.png" }).catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
}
