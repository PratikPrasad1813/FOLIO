import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = (process.env.PATH || "").split(delimiter).map(bin => resolve(bin, "..", "playwright", "index.mjs")).find(existsSync);
if (!modulePath) throw new Error("Run with: npx --yes --package=@playwright/test -c 'node scripts/test-folio-ai-browser.mjs'");
const { chromium } = await import(pathToFileURL(modulePath).href);
const BASE = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const ids = [];
let browser;
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };

async function createUser() {
  const { rows: [user] } = await db.execute(sql`insert into folio_users (name, email, provider) values ('Folio AI browser test', ${`folio-ai-browser-${randomUUID()}@example.invalid`}, 'test') returning id`);
  ids.push(user.id);
  await db.execute(sql`update folio_users set onboarding_completed_at = now(), onboarding_step = 10 where id = ${user.id}`);
  const tokens = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];
  for (const token of tokens) await db.execute(sql`insert into folio_sessions (user_id, token_hash, expires_at) values (${user.id}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 day')`);
  return { id: user.id, tokens };
}

try {
  ok((await fetch(`${BASE}/api/health`)).status === 200, "Start Folio first");
  const user = await createUser();
  browser = await chromium.launch({ headless: true });
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const contextB = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  await contextA.addCookies([{ name: "folio_session", value: user.tokens[0], url: BASE, httpOnly: true, sameSite: "Lax" }]);
  await contextB.addCookies([{ name: "folio_session", value: user.tokens[1], url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const browserErrors = [];
  pageA.on("pageerror", error => browserErrors.push(error.message));
  await pageA.goto(`${BASE}/ai`);
  await pageA.getByRole("heading", { name: "Folio AI", exact: true }).waitFor();
  // Fresh account shows the personalization onboarding; complete it if present.
  const onboarding = pageA.getByRole("dialog", { name: "Make Folio AI feel like yours" });
  try { await onboarding.waitFor({ state: "visible", timeout: 5000 }); } catch { /* already completed or not shown */ }
  if (await onboarding.count()) {
    await onboarding.getByLabel("Assistant name").fill("Ada");
    await onboarding.getByRole("button", { name: "concise", exact: true }).click();
    await onboarding.getByRole("button", { name: /Start with Ada/ }).click();
    await onboarding.waitFor({ state: "detached" });
  }
  // If any modal remains (e.g. onboarding re-opened), close it via its explicit close button.
  const lingering = pageA.locator(".fa-onboarding-modal .close-button");
  if (await lingering.count()) await lingering.first().click().catch(() => {});
  await pageA.getByRole("heading", { name: "AI usage", exact: true }).waitFor();
  await pageA.getByText(/% used today/).waitFor();
  const privacy = pageA.locator(".fa-chat-foot");
  await privacy.waitFor();
  ok((await privacy.innerText()).includes("processed by Google AI Studio"), "Hosted Gemini processing and account history are explained");
  ok((await pageA.locator(".fa-phase-note").innerText()).includes("wait for your review"), "Preview explains that Folio changes require review");
  ok((await pageA.locator(".fa-model-state").innerText()).includes("Folio AI"), "Hosted assistant identity is displayed");
  ok(await pageA.locator(".fa-compatibility,.fa-model-stats,.fa-recommend").count() === 0, "AI page has no local-model compatibility or download UI");
  await pageA.locator(".fa-usage-track").waitFor();

  // Two authenticated sessions for one Neon account share metadata-only usage.
  const generationId = randomUUID();
  const reservation = await pageA.evaluate(async id => {
    const response = await fetch("/api/ai/usage/reservations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: id, inputCharacters: 6 }) });
    return { status: response.status, body: await response.json() };
  }, generationId);
  assert.equal(reservation.status, 201, JSON.stringify(reservation.body));
  checks++;
  // Sync another open AI page using the existing same-origin usage channel.
  await pageB.goto(`${BASE}/ai`);
  await pageB.getByRole("heading", { name: "Folio AI", exact: true }).waitFor();
  await pageB.getByRole("heading", { name: "AI usage", exact: true }).waitFor();
  await pageA.evaluate(() => { const channel = new BroadcastChannel("folio-ai-account-usage"); channel.postMessage({ updated: true }); channel.close(); });
  await pageB.waitForFunction(() => document.querySelector(".fa-usage-top strong")?.textContent?.trim().startsWith("12"));
  checks++;
  const cancelled = await pageB.evaluate(async id => {
    const response = await fetch(`/api/ai/usage/reservations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "cancelled" }) });
    return { status: response.status, body: await response.json() };
  }, reservation.body.reservation.id);
  assert.equal(cancelled.status, 200);
  checks++;
  await pageA.evaluate(() => { const channel = new BroadcastChannel("folio-ai-account-usage"); channel.postMessage({ updated: true }); channel.close(); });
  await pageA.waitForFunction(() => document.querySelector(".fa-usage-top strong")?.textContent?.trim().startsWith("0"));
  checks++;
  const usage = await pageA.evaluate(async () => (await (await fetch("/api/ai/usage")).json()).usage);
  assert.equal(usage.usedPercent, 0);
  assert.ok(!["usedTokens", "reservedTokens", "available", "completed", "reserved", "limit"].some(key => key in usage));
  checks += 2;
  ok(browserErrors.length === 0, `No UI exceptions: ${browserErrors.join("; ")}`);

  await pageA.locator(".theme-toggle").click();
  ok(await pageA.locator("html").getAttribute("data-theme") === "dark", "AI page supports Folio dark theme");
  await pageA.screenshot({ path: "artifacts/folio-ai-dark.png", fullPage: true });
  await pageA.setViewportSize({ width: 390, height: 844 });
  const pageBounds = await pageA.locator(".folio-ai-page").boundingBox();
  ok(pageBounds.x >= 0 && pageBounds.x + pageBounds.width <= 390, "AI interface stays within mobile viewport");
  await pageA.screenshot({ path: "artifacts/folio-ai-mobile.png", fullPage: true });
  console.log(`PASS: ${checks} Folio AI browser checks. The model was deliberately not downloaded in this browser test.`);
} finally {
  if (browser) await browser.close();
  for (const id of ids) await db.execute(sql`delete from folio_users where id = ${id}`);
  await pool.end();
}
