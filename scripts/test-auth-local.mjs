#!/usr/bin/env node
// Local-only integration tests. No real provider credentials or accounts are used.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash, scryptSync } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { and, eq, inArray } from "drizzle-orm";
import { loadFolioEnv } from "./lib/env.mjs";
loadFolioEnv();
const url = process.env.SCREENSHOT_DATABASE_URL;
const target = url ? new URL(url) : null;
const database = target && decodeURIComponent(target.pathname.slice(1));
if (process.env.FOLIO_SCREENSHOT_MODE !== "local" || process.env.NODE_ENV === "production" || process.env.NETLIFY || process.env.VERCEL || process.env.CONTEXT === "production" || !target || !['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !/^folio_screenshots(?:_[a-z0-9_]+)?$/.test(database) || (process.env.DATABASE_URL && decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) === database)) throw new Error("Tests require local mode and a separate loopback folio_screenshots database.");
process.env.DATABASE_URL = url;
process.env.FOLIO_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.GOOGLE_CLIENT_ID = "test-google-client"; process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
process.env.GITHUB_CLIENT_ID = "test-github-client"; process.env.GITHUB_CLIENT_SECRET = "test-github-secret";
const load = createRequire(import.meta.url)("./folio-test-loader.cjs");
const { db, pool } = load(resolve("src/db/index.ts"));
const { applySchema } = load(resolve("src/db/migrate.ts"));
const schema = load(resolve("src/db/schema.ts"));
const { resolveOAuthIdentity, exchangeProviderCode } = load(resolve("src/lib/oauth.ts"));
const { users, sessions, projects, passwordResets, authRateLimits, authFlows } = schema;
const run = randomUUID();
const emailA = `auth-test+${run}-a@example.test`, emailB = `auth-test+${run}-b@example.test`, emailLegacy = `auth-test+${run}-legacy@example.test`, emailManaged = `auth-test+${run}-managed@example.test`;
const emails = [emailA, emailB, emailLegacy, emailManaged];
const hash = value => createHash("sha256").update(value).digest("hex");
const ip = `198.18.${parseInt(run.slice(0, 2), 16)}.${parseInt(run.slice(2, 4), 16)}`;
const stateHashes = [];
let safe = false, server, browser, serverLog = "";
async function port() { const s = createServer(); await new Promise((ok, fail) => s.listen(0, "127.0.0.1", ok).on("error", fail)); const p = s.address().port; await new Promise(ok => s.close(ok)); return p; }
async function health(base) { for (let i = 0; i < 120; i++) { if (server.exitCode !== null) throw new Error("Test server exited."); try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1200) })).ok) return; } catch {} await new Promise(r => setTimeout(r, 1000)); } throw new Error("Test server did not start."); }
async function body(response, expected) { assert.equal(response.status(), expected, `${response.url()} returned ${response.status()}`); return response.json(); }
try {
  const { rows: [actual] } = await pool.query("select current_database() as db, inet_server_addr()::text as address");
  assert.equal(actual.db, database); assert.ok(['127.0.0.1', '127.0.0.1/32', '::1', '::1/128'].includes(actual.address)); safe = true;
  await applySchema();
  const p = await port(), base = `http://127.0.0.1:${p}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(p)], { env: { ...process.env, NODE_ENV: "development", APP_URL: base, NEXT_PUBLIC_APP_URL: base, SMTP_URL: "", SMTP_FROM: "" }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { serverLog = (serverLog + chunk.toString()).slice(-5000); });
  await health(base);
  browser = await chromium.launch({ headless: true });
  const makeContext = () => browser.newContext({ extraHTTPHeaders: { Origin: base, "x-nf-client-connection-ip": ip } });
  const a = await makeContext(), b = await makeContext(), social = await makeContext();
  const post = (ctx, path, data, extra = {}) => ctx.request.post(`${base}${path}`, { data, ...extra });
  const get = (ctx, path, extra = {}) => ctx.request.get(`${base}${path}`, extra);
  const pass = "a fictional strong passphrase";
  const first = await body(await post(a, "/api/auth", { action: "register", name: "Example One", email: emailA, password: pass }), 200);
  const second = await body(await post(b, "/api/auth", { action: "register", name: "Example Two", email: emailB, password: pass }), 200);
  assert.notEqual(first.user.id, second.user.id);
  assert.equal(first.user.onboardingCompleted, false);
  const cookie = (await a.cookies()).find(c => c.name === "folio_session");
  assert.ok(cookie?.httpOnly); assert.equal(cookie.sameSite, "Lax");
  const project = await body(await post(a, "/api/workspace", { kind: "projects", data: { name: "A private test project" } }), 201);
  const idea = await body(await post(a, "/api/workspace", { kind: "ideas", data: { title: "A private test idea" } }), 201);
  const aWorkspace = await body(await get(a, "/api/workspace"), 200);
  assert.ok(aWorkspace.projects.some(x => x.id === project.item.id));
  assert.ok(aWorkspace.ideas.some(x => x.id === idea.item.id));
  assert.ok(!JSON.stringify(aWorkspace).includes("passwordHash"));
  const bWorkspace = await body(await get(b, "/api/workspace"), 200);
  assert.ok(!bWorkspace.projects.some(x => x.id === project.item.id));
  const forbidden = await b.request.patch(`${base}/api/workspace`, { data: { kind: "projects", id: project.item.id, data: { name: "Stolen" } } });
  assert.equal(forbidden.status(), 404);
  const csrf = await a.request.patch(`${base}/api/workspace`, { headers: { Origin: "https://attacker.example", "sec-fetch-site": "cross-site" }, data: { kind: "projects", id: project.item.id, data: { name: "Stolen" } } });
  assert.equal(csrf.status(), 403);
  assert.equal((await post(a, "/api/auth/session", {})).status(), 200);
  assert.equal((await get(a, "/api/workspace")).status(), 200);
  await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, first.user.id));
  assert.equal((await get(a, "/api/workspace")).status(), 401);
  assert.equal((await post(a, "/api/auth/session", {})).status(), 401);
  assert.equal((await post(a, "/api/auth", { action: "login", email: emailA, password: "incorrect password" })).status(), 401);
  await body(await post(a, "/api/auth", { action: "login", email: emailA, password: pass }), 200);
  const preserved = await body(await get(a, "/api/workspace"), 200); assert.equal(preserved.user.id, first.user.id); assert.ok(preserved.projects.some(x => x.id === project.item.id));
  assert.equal((await a.request.delete(`${base}/api/auth`)).status(), 200);
  assert.equal((await get(a, "/api/workspace")).status(), 401);
  const protectedPage = await get(a, "/projects", { maxRedirects: 0 }); assert.ok([302, 307].includes(protectedPage.status())); assert.ok(protectedPage.headers().location.includes("/login"));
  assert.equal((await post(a, "/api/auth", { action: "register", name: "Duplicate", email: emailA, password: pass })).status(), 409);
  await body(await post(a, "/api/auth", { action: "login", email: emailA, password: pass }), 200);
  console.log("PASS: registration, scrypt login, persistence, renewal, expiry, logout, CSRF, protected routes and user isolation.");

  const legacyId = randomUUID(), managedId = randomUUID(), salt = randomBytes(16).toString("hex");
  const oldHash = `${salt}:${scryptSync(pass, salt, 64).toString("hex")}`;
  await db.insert(users).values([{ id: legacyId, name: "Legacy Example", email: emailLegacy, provider: "google", passwordHash: oldHash, onboardingCompletedAt: new Date() }, { id: managedId, name: "Managed Example", email: emailManaged, provider: "neon", authUserId: `managed-${run}`, onboardingCompletedAt: new Date() }]);
  await db.insert(projects).values({ userId: managedId, name: "Existing managed workspace" });
  const google = { provider: "google", subject: `google-${run}`, email: emailLegacy, name: "Legacy Example" };
  const github = { provider: "github", subject: `github-${run}`, email: emailLegacy, name: "Legacy Example" };
  assert.equal((await resolveOAuthIdentity(google, null)).id, legacyId);
  await assert.rejects(() => resolveOAuthIdentity(github, null), /Sign in or recover/);
  assert.equal((await resolveOAuthIdentity(github, legacyId)).id, legacyId);
  assert.equal((await resolveOAuthIdentity(github, null)).id, legacyId);
  await assert.rejects(() => resolveOAuthIdentity(github, first.user.id), /another workspace/);
  await assert.rejects(() => resolveOAuthIdentity({ ...github, subject: `other-${run}`, email: emailB }, legacyId), /verified email/);
  await assert.rejects(() => resolveOAuthIdentity({ ...github, subject: `other-${run}` }, legacyId), /different account/);
  await assert.rejects(() => resolveOAuthIdentity({ ...google, subject: `managed-${run}`, email: emailManaged }, null), /Sign in or recover/);
  await body(await post(social, "/api/auth", { action: "login", email: emailLegacy, password: pass }), 200);
  assert.equal((await body(await get(social, "/api/workspace"), 200)).user.id, legacyId);
  await social.request.delete(`${base}/api/auth`);
  const staleSession = randomBytes(32).toString("hex");
  await db.insert(sessions).values({ userId: managedId, tokenHash: hash(staleSession), expiresAt: new Date(Date.now() + 60_000) });
  await social.addCookies([{ name: "folio_session", value: staleSession, url: base, httpOnly: true, sameSite: "Lax" }]);
  const recovery = randomBytes(32).toString("hex");
  await db.insert(passwordResets).values({ tokenHash: hash(recovery), userId: managedId, expiresAt: new Date(Date.now() + 60_000) });
  assert.equal((await post(social, "/api/auth/recovery", { action: "reset", token: recovery, password: pass })).status(), 200);
  assert.equal((await post(social, "/api/auth/recovery", { action: "reset", token: recovery, password: pass })).status(), 400);
  assert.equal((await get(social, "/api/workspace")).status(), 401);
  await body(await post(social, "/api/auth", { action: "login", email: emailManaged, password: pass }), 200);
  const recovered = await body(await get(social, "/api/workspace"), 200);
  assert.equal(recovered.user.id, managedId); assert.ok(recovered.projects.some(x => x.name === "Existing managed workspace"));
  assert.equal((await db.select().from(users).where(eq(users.id, managedId)))[0].authUserId, `managed-${run}`);
  await social.request.delete(`${base}/api/auth`);
  console.log("PASS: original scrypt compatibility, safe provider linking, managed UUID/data preservation and single-use recovery.");

  const startGoogle = await get(social, "/api/auth/oauth/google?next=%2Fprojects", { maxRedirects: 0 });
  assert.equal(startGoogle.status(), 302); const googleUrl = new URL(startGoogle.headers().location); assert.equal(googleUrl.hostname, "accounts.google.com"); assert.equal(googleUrl.searchParams.get("code_challenge_method"), "S256"); assert.equal(googleUrl.searchParams.get("prompt"), "select_account");
  stateHashes.push(hash(googleUrl.searchParams.get("state")));
  const startGithub = await get(social, "/api/auth/oauth/github?next=%2Ftasks", { maxRedirects: 0 });
  assert.equal(startGithub.status(), 302); const githubUrl = new URL(startGithub.headers().location); assert.equal(githubUrl.hostname, "github.com"); assert.equal(githubUrl.searchParams.get("code_challenge_method"), "S256");
  stateHashes.push(hash(githubUrl.searchParams.get("state")));
  const mismatched = await get(social, `/api/auth/oauth/google/callback?code=fake&state=${encodeURIComponent(googleUrl.searchParams.get("state"))}`, { maxRedirects: 0 });
  assert.equal(mismatched.status(), 302); assert.ok(mismatched.headers().location.includes("/login?error="));
  assert.equal((await get(social, "/api/workspace")).status(), 401);
  await body(await post(social, "/api/auth", { action: "login", email: emailA, password: pass }), 200);
  await social.request.delete(`${base}/api/auth`);
  const againGoogle = await get(social, "/api/auth/oauth/google", { maxRedirects: 0 });
  assert.equal(new URL(againGoogle.headers().location).hostname, "accounts.google.com");
  stateHashes.push(hash(new URL(againGoogle.headers().location).searchParams.get("state")));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (target, options = {}) => {
      const path = String(target);
      if (path.includes("/token") || path.includes("access_token")) { assert.equal(new URLSearchParams(options.body).get("code_verifier"), "test-verifier"); return Response.json({ access_token: "fictional-token" }); }
      if (path.includes("openidconnect")) return Response.json({ sub: "verified-google-sub", email: "verified@example.test", email_verified: true, name: "Example" });
      if (path.endsWith("/user/emails")) return Response.json([{ email: "verified@example.test", primary: true, verified: true }]);
      if (path.endsWith("/user")) return Response.json({ id: 123456, login: "example", email: "unverified-public@example.test" });
      throw new Error("Unexpected mocked provider request");
    };
    assert.equal((await exchangeProviderCode("google", new Request(`${base}/api/auth/oauth/google/callback`), "code", "test-verifier")).subject, "verified-google-sub");
    const identity = await exchangeProviderCode("github", new Request(`${base}/api/auth/oauth/github/callback`), "code", "test-verifier");
    assert.equal(identity.subject, "123456"); assert.equal(identity.email, "verified@example.test");
    globalThis.fetch = async target => String(target).includes("/token") ? Response.json({ access_token: "fictional-token" }) : Response.json({ sub: "unverified", email: "no@example.test", email_verified: false });
    await assert.rejects(() => exchangeProviderCode("google", new Request(`${base}/api/auth/oauth/google/callback`), "code", "test-verifier"), /verified email/);
  } finally { globalThis.fetch = originalFetch; }
  console.log("PASS: provider-specific redirects, PKCE, mismatched state rejection and mocked verified profile exchanges.");

  const page = await b.newPage(); await page.goto(base, { waitUntil: "domcontentloaded" });
  const tabNames = [["Overview", "dashboard"], ["Projects", "projects"], ["Project details", "project-details"], ["Task board", "tasks-board"], ["Task list", "tasks-list"], ["Task calendar", "tasks-calendar"], ["Calendar", "calendar"], ["Ideas", "ideas"], ["Insights", "analytics"], ["Folio AI", "folio-ai"]];
  for (const [label, name] of tabNames) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await page.waitForFunction(expected => { const image = document.querySelector('#showcase-screen img'); return image && image.getAttribute('src') === `/screenshots/${expected}.png` && image.complete && image.naturalWidth === 1440; }, name, { timeout: 15_000 });
  }
  const fallbackContext = await makeContext(), fallback = await fallbackContext.newPage();
  await fallback.route("**/screenshots/dashboard.png", route => route.abort());
  await fallback.goto(base, { waitUntil: "domcontentloaded" });
  await fallback.locator(".lp-hero .lp-image-fallback").waitFor({ timeout: 15_000 });
  await fallbackContext.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), "Mobile landing page overflows horizontally.");
  console.log("PASS: all ten landing-page captures load; fallback and mobile layout render.");
} catch (error) {
  console.error("Local integration test failed:", error instanceof Error ? error.stack : error);
  console.error(serverLog.slice(-3000)); process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) { server.kill("SIGTERM"); await Promise.race([new Promise(r => server.once("exit", r)), new Promise(r => setTimeout(r, 3000))]); }
  if (safe) {
    try {
      for (const email of emails) {
        const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
        for (const row of rows) await db.delete(users).where(and(eq(users.id, row.id), eq(users.email, email)));
      }
      if (stateHashes.length) await db.delete(authFlows).where(inArray(authFlows.stateHash, stateHashes));
      const keys = [hash(`credentials:${ip}:`), hash(`oauth:${ip}:`), hash(`recovery:${ip}:`), ...emails.map(email => hash(`credentials-email:account:${email}`))];
      await db.delete(authRateLimits).where(inArray(authRateLimits.key, keys));
      const remains = await db.select({ id: users.id }).from(users).where(inArray(users.email, emails)); assert.equal(remains.length, 0);
      console.log("PASS: uniquely scoped local test accounts and data cleaned up.");
    } catch (error) { console.error("Test cleanup failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
  }
  await pool.end().catch(() => {});
}
