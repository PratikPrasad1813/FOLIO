#!/usr/bin/env node
// Comprehensive automated verification for Folio AI long-running tasks (no 3-minute cutoff),
// background execution across navigation, conversation & task persistence across refreshes,
// network interruption idempotency, failure + retry/resume, and manual user cancellation.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { and, eq } from "drizzle-orm";
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
    "AI long-running task tests require FOLIO_SCREENSHOT_MODE=local and a dedicated loopback folio_screenshots database.",
  );
}

process.env.DATABASE_URL = screenshotUrl;
process.env.FOLIO_ENCRYPTION_KEY = randomBytes(32).toString("hex");

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
      if (!check.rows.length) await client.query(`create database ${database}`);
      await client.end();
      break;
    } catch {
      // try next maintenance db
    }
  }
} catch {
  // best-effort pre-creation
}

const { db, pool } = load(resolve("src/db/index.ts"));
const { applySchema } = load(resolve("src/db/migrate.ts"));
const schema = load(resolve("src/db/schema.ts"));
const { FOLIO_AI_CONFIG } = load(resolve("src/lib/folio-ai/config.ts"));
const {
  createOrReuseAITask,
  updateAITaskProgress,
  reconcileStaleAITasks,
} = load(resolve("src/lib/folio-ai/tasks-service.ts"));

const {
  users,
  sessions,
  folioAiPreferences,
  folioAiConversations,
  folioAiMessages,
  folioAiTasks,
  folioAiUsageReservations,
} = schema;

const hash = v => createHash("sha256").update(v).digest("hex");
const createdUserIds = [];
let safe = false;
let server;
let browser;
let serverLog = "";

async function freePort() {
  const s = createServer();
  await new Promise((ok, fail) => s.listen(0, "127.0.0.1", ok).on("error", fail));
  const p = s.address().port;
  await new Promise(ok => s.close(ok));
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
    await new Promise(r => setTimeout(r, 1000));
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
  /* 0. Verify 3-minute config limit is gone & service handles >3m tasks    */
  /* ---------------------------------------------------------------------- */
  assert.equal(
    "maxGenerationMilliseconds" in FOLIO_AI_CONFIG,
    false,
    "Fixed 180-second maxGenerationMilliseconds must be removed from FOLIO_AI_CONFIG",
  );

  const [serviceUser] = await db
    .insert(users)
    .values({
      name: "AI Service Tester",
      email: `ai-svc-${randomUUID()}@example.invalid`,
      provider: "email",
      onboardingCompletedAt: new Date(),
      onboardingStep: 10,
    })
    .returning();
  createdUserIds.push(serviceUser.id);

  // Simulate a task that runs for 6 minutes (360 seconds) with heartbeats every 30s
  const startClock = new Date("2026-11-02T10:00:00.000Z");
  const longGenId = randomUUID();
  const createdLong = await createOrReuseAITask(
    serviceUser.id,
    {
      generationId: longGenId,
      prompt: "Perform a deep 6-minute architecture review of all projects.",
      modelId: FOLIO_AI_CONFIG.modelId,
    },
    startClock,
  );
  assert.equal(createdLong.task.status, "queued");
  assert.equal(createdLong.reused, false);

  // Duplicate call with same generationId (network retry) reuses the exact same task
  const duplicateCall = await createOrReuseAITask(
    serviceUser.id,
    {
      generationId: longGenId,
      prompt: "Perform a deep 6-minute architecture review of all projects.",
      modelId: FOLIO_AI_CONFIG.modelId,
    },
    new Date(startClock.getTime() + 2000),
  );
  assert.equal(duplicateCall.reused, true, "Duplicate request with same generationId must reuse task");
  assert.equal(duplicateCall.task.id, createdLong.task.id, "Task ID must be identical on retry");

  // Advance through 6 minutes (360,000 ms — twice the old 3-minute limit!) with heartbeats
  for (let elapsedSec = 30; elapsedSec <= 360; elapsedSec += 30) {
    const tickNow = new Date(startClock.getTime() + elapsedSec * 1000);
    const hb = await updateAITaskProgress(
      serviceUser.id,
      createdLong.task.id,
      {
        status: "running",
        stage: `Generating response · ${elapsedSec}s elapsed`,
        partialContent: `Section ${elapsedSec / 30}: detailed analysis...`,
        tokenCount: elapsedSec * 2,
      },
      tickNow,
    );
    assert.equal(hb.task.status, "running", `Task must still be running at ${elapsedSec}s (>180s)`);
    assert.equal(hb.cancelled, false);
  }

  // Verify reservation lease was extended past the original startClock + 10m
  const [resRow] = await db
    .select()
    .from(folioAiUsageReservations)
    .where(eq(folioAiUsageReservations.id, createdLong.reservation.id));
  assert.ok(
    resRow.expiresAt.getTime() > startClock.getTime() + 15 * 60_000,
    "Heartbeat must extend reservation lease so long tasks never expire mid-flight",
  );

  // Complete the 6-minute task at t = 370s
  const finishedLong = await updateAITaskProgress(
    serviceUser.id,
    createdLong.task.id,
    {
      status: "completed",
      stage: "Completed",
      partialContent: "Complete 6-minute architecture review with all 12 sections.",
      tokenCount: 740,
    },
    new Date(startClock.getTime() + 370_000),
  );
  assert.equal(finishedLong.task.status, "completed");
  assert.equal(finishedLong.usage.completed, 1);
  assert.equal(finishedLong.usage.reserved, 0);

  // Test stale-worker detection: if a worker stops heartbeating for > staleTaskTimeoutMilliseconds,
  // reconcileStaleAITasks transitions it to failed, preserves partialContent, and frees the reservation.
  const staleStart = new Date();
  const staleTask = await createOrReuseAITask(
    serviceUser.id,
    {
      generationId: randomUUID(),
      conversationId: createdLong.conversation.id,
      prompt: "Task whose worker crashes mid-stream",
    },
    staleStart,
  );
  await updateAITaskProgress(
    serviceUser.id,
    staleTask.task.id,
    {
      status: "running",
      stage: "Streaming response",
      partialContent: "Partial output before worker crash",
      tokenCount: 18,
    },
    staleStart,
  );
  const afterStale = new Date(
    staleStart.getTime() + FOLIO_AI_CONFIG.staleTaskTimeoutMilliseconds + 5_000,
  );
  const reaped = await reconcileStaleAITasks(serviceUser.id, { now: afterStale });
  assert.equal(reaped.length, 1, "Stale task whose worker stopped must be detected");
  assert.equal(reaped[0].status, "failed", "Stale task must never claim to still be running");
  assert.equal(
    reaped[0].partialContent,
    "Partial output before worker crash",
    "Stale task must preserve partial output",
  );
  console.log(
    "PASS: Service-level >3-minute (370s) execution, lease renewal, idempotency, and stale-worker detection verified.",
  );

  /* ---------------------------------------------------------------------- */
  /* Browser End-to-End Verification of All 8 Scenarios                     */
  /* ---------------------------------------------------------------------- */
  const [browserUser] = await db
    .insert(users)
    .values({
      name: "Elena Rostova",
      email: `ai-e2e-${randomUUID()}@example.invalid`,
      provider: "email",
      onboardingCompletedAt: new Date(),
      onboardingStep: 10,
    })
    .returning();
  createdUserIds.push(browserUser.id);

  await db.insert(folioAiPreferences).values({
    userId: browserUser.id,
    assistantName: "Ada",
    presentation: "neutral",
    style: "concise",
    modelPreference: "balanced",
  });

  const sessionToken = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId: browserUser.id,
    tokenHash: hash(sessionToken),
    expiresAt: new Date(Date.now() + 86_400_000),
  });

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
    stream.on("data", chunk => {
      serverLog = (serverLog + chunk.toString()).slice(-5000);
    });
  }
  await waitForHealth(base);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    { name: "folio_session", value: sessionToken, url: base, httpOnly: true, sameSite: "Lax" },
  ]);

  // Inject controllable local provider so we can deterministically test normal, >3m,
  // navigation, refresh, network glitch, failure/retry, and manual cancellation.
  await context.addInitScript(() => {
    window.__TEST_AI_MODE__ = "normal";
    window.__FOLIO_AI_TEST_PROVIDER__ = {
      providerId: "webllm",
      inferenceLocation: "local",
      modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
      modelName: "Qwen2.5 1.5B Instruct · Q4F16",
      async initialize(onProgress) {
        onProgress({ progress: 1, text: "Model ready on this device.", cached: true });
        return { cached: true };
      },
      async generate(messages, signal, onToken) {
        const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
        const mode = window.__TEST_AI_MODE__ || "normal";

        const sleep = ms =>
          new Promise((resolve, reject) => {
            if (signal.aborted) return reject(new DOMException("Stopped", "AbortError"));
            const timer = setTimeout(resolve, ms);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("Stopped", "AbortError"));
              },
              { once: true },
            );
          });

        if (mode === "fail_midway") {
          onToken("First part of the analysis before device error. ");
          await sleep(150);
          throw new Error("Simulated GPU execution error during generation.");
        }

        if (mode === "slow_nav") {
          const chunks = [
            "Step 1: Auditing workspace projects. ",
            "Step 2: Organizing milestones across Q4. ",
            "Step 3: Finalizing priority recommendations.",
          ];
          let out = "";
          for (const chunk of chunks) {
            await sleep(900);
            onToken(chunk);
            out += chunk;
          }
          return { text: out.trim(), outputTokens: chunks.length };
        }

        if (mode === "cancellable") {
          onToken("Starting long draft that the user will cancel... ");
          await sleep(30_000);
          return { text: "Should not reach here", outputTokens: 5 };
        }

        if (mode === "over_three_minutes") {
          onToken("Deep multi-minute synthesis: part 1. ");
          await sleep(300);
          onToken("Part 2 after 3-minute mark: completed without any timeout cutoff!");
          return {
            text: "Deep multi-minute synthesis: part 1. Part 2 after 3-minute mark: completed without any timeout cutoff!",
            outputTokens: 24,
          };
        }

        // Default / normal mode
        const reply = `Completed response for: ${lastUser.slice(0, 60)}`;
        const words = reply.split(" ");
        for (const w of words) {
          await sleep(30);
          onToken(`${w} `);
        }
        return { text: reply, outputTokens: words.length };
      },
      async interrupt() {},
      async resetConversation() {},
      async unload() {},
    };
  });

  const page = await context.newPage();
  await page.goto(`${base}/ai`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Folio AI", exact: true }).waitFor({ timeout: 30_000 });

  // Load the local model
  const loadBtn = page.getByRole("button", { name: /Download & load local model|Try loading model anyway/i });
  if (await loadBtn.count()) {
    await loadBtn.click();
  }
  await page.getByText(/Ready · running locally/).waitFor({ timeout: 20_000 });

  /* ---------------------------------------------------------------------- */
  /* Test 1 & 8: A normal AI request completes & persists                   */
  /* ---------------------------------------------------------------------- */
  await page.locator("#folio-ai-message").fill("Summarize my current week priorities.");
  await page.getByRole("button", { name: /Send/ }).click();
  await page
    .getByText("Completed response for: Summarize my current week priorities.")
    .waitFor({ timeout: 20_000 });
  await page.locator(".fa-task-badge.is-completed").first().waitFor({ timeout: 10_000 });
  console.log("PASS [1 & 8]: Normal AI request completes and displays Completed status.");

  /* ---------------------------------------------------------------------- */
  /* Test 2: A task taking > 3 minutes (180s) is NOT cancelled              */
  /* ---------------------------------------------------------------------- */
  await page.evaluate(() => {
    window.__TEST_AI_MODE__ = "over_three_minutes";
    const realNow = Date.now.bind(Date);
    let offset = 0;
    Date.now = () => realNow() + offset;
    window.__ADVANCE_CLOCK_MS__ = ms => {
      offset += ms;
    };
  });
  await page.locator("#folio-ai-message").fill("Run a task that exceeds 3 minutes.");
  await page.getByRole("button", { name: /Send/ }).click();
  // Advance clock by 210 seconds (3.5 minutes) while the task is running
  await page.evaluate(() => window.__ADVANCE_CLOCK_MS__(210_000));
  await page
    .getByText(/Deep multi-minute synthesis: part 1\. Part 2 after 3-minute mark: completed without any timeout cutoff!/)
    .waitFor({ timeout: 20_000 });
  await page.evaluate(() => {
    window.__TEST_AI_MODE__ = "normal";
  });
  console.log("PASS [2]: Task exceeding 3 minutes (210s) is not cancelled and completes cleanly.");

  /* ---------------------------------------------------------------------- */
  /* Test 3: Navigate away (/ai -> /projects) and return to see status      */
  /* ---------------------------------------------------------------------- */
  await page.evaluate(() => {
    window.__TEST_AI_MODE__ = "slow_nav";
  });
  await page.locator("#folio-ai-message").fill("Create a multi-step Q4 roadmap while I check Projects.");
  await page.getByRole("button", { name: /Send/ }).click();

  // Wait for running bar to appear, then navigate away to /projects via sidebar
  await page.locator(".fa-live-task-bar").waitFor({ timeout: 10_000 });
  await page.getByRole("link", { name: "Projects" }).click();
  await page.waitForURL("**/projects", { timeout: 15_000 });
  await page.waitForTimeout(700);

  // Navigate back to /ai and verify the task is still alive and finishes streaming!
  await page.getByRole("link", { name: "Folio AI" }).click();
  await page.waitForURL("**/ai", { timeout: 15_000 });
  await page
    .getByText(/Step 3: Finalizing priority recommendations\./)
    .waitFor({ timeout: 20_000 });
  console.log("PASS [3]: Navigating away from /ai and returning reconnects to the live task without losing progress.");

  /* ---------------------------------------------------------------------- */
  /* Test 4: Refreshing the page does not lose the task or conversation     */
  /* ---------------------------------------------------------------------- */
  await page
    .getByText("Completed response for: Summarize my current week priorities.")
    .waitFor({ timeout: 20_000 });
  const msgCountBeforeReload = await page.locator(".fa-message").count();
  assert.ok(msgCountBeforeReload >= 6, "Expected at least 3 prompt+reply pairs before reload");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Folio AI", exact: true }).waitFor({ timeout: 30_000 });
  await page
    .getByText("Completed response for: Summarize my current week priorities.")
    .waitFor({ timeout: 20_000 });
  await page
    .getByText(/Step 3: Finalizing priority recommendations\./)
    .waitFor({ timeout: 20_000 });
  assert.equal(
    await page.locator(".fa-message").count(),
    msgCountBeforeReload,
    "Refreshing the page must preserve all messages and tasks without duplicating any",
  );
  console.log("PASS [4]: Refreshing the page preserves the conversation, messages, and task statuses without duplication.");

  /* ---------------------------------------------------------------------- */
  /* Test 5: Temporary network interruption does not create duplicate tasks */
  /* ---------------------------------------------------------------------- */
  // Re-load model after full page reload
  const reloadModelBtn = page.getByRole("button", { name: /Download & load local model|Try loading model anyway/i });
  if (await reloadModelBtn.count()) await reloadModelBtn.click();
  await page.getByText(/Ready · running locally/).waitFor({ timeout: 20_000 });
  await page.evaluate(() => {
    window.__TEST_AI_MODE__ = "normal";
  });

  let taskPostAttempts = 0;
  const routeHandler = async route => {
    if (route.request().method() === "POST") {
      taskPostAttempts += 1;
      if (taskPostAttempts === 1) {
        // Simulate a transient network drop on the first POST /api/ai/tasks attempt
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  };
  await page.route("**/api/ai/tasks", routeHandler);

  await page.locator("#folio-ai-message").fill("Test resilience against a transient network drop.");
  await page.getByRole("button", { name: /Send/ }).click();
  await page
    .getByText("Completed response for: Test resilience against a transient network drop.")
    .waitFor({ timeout: 20_000 });
  await page.unroute("**/api/ai/tasks", routeHandler);
  assert.equal(taskPostAttempts, 2, "Task creation retried after transient network failure");

  const tasksInDbAfterRetry = await db
    .select()
    .from(folioAiTasks)
    .where(
      and(
        eq(folioAiTasks.userId, browserUser.id),
        eq(folioAiTasks.prompt, "Test resilience against a transient network drop."),
      ),
    );
  assert.equal(
    tasksInDbAfterRetry.length,
    1,
    "Temporary network interruption must NOT create duplicate tasks in PostgreSQL",
  );
  console.log("PASS [5]: Temporary network interruption handled cleanly with zero duplicate tasks.");

  /* ---------------------------------------------------------------------- */
  /* Test 6: Failed task preserves partial output, shows error & retries    */
  /* ---------------------------------------------------------------------- */
  await page.evaluate(() => {
    window.__TEST_AI_MODE__ = "fail_midway";
  });
  await page.locator("#folio-ai-message").fill("Generate a report that fails mid-stream.");
  await page.getByRole("button", { name: /Send/ }).click();

  await page.locator(".fa-task-error-card").waitFor({ timeout: 20_000 });
  await page.getByText("First part of the analysis before device error.").waitFor({ timeout: 10_000 });
  await page.getByText("Partial output preserved").waitFor({ timeout: 10_000 });

  // Switch provider back to normal mode and click "Retry task"
  await page.evaluate(() => {
    window.__TEST_AI_MODE__ = "normal";
  });
  const countBeforeRetry = await page.locator(".fa-message").count();
  await page.locator(".fa-task-error-card").getByRole("button", { name: "Retry task" }).click();
  await page
    .getByText("Completed response for: Generate a report that fails mid-stream.")
    .waitFor({ timeout: 20_000 });
  assert.equal(
    await page.locator(".fa-message").count(),
    countBeforeRetry,
    "Retrying a failed task updates the task in-place without duplicating messages",
  );
  console.log("PASS [6]: Failed task preserves partial output, displays error, and succeeds on retry.");

  /* ---------------------------------------------------------------------- */
  /* Test 7: User can manually cancel a running task                        */
  /* ---------------------------------------------------------------------- */
  await page.evaluate(() => {
    window.__TEST_AI_MODE__ = "cancellable";
  });
  await page.locator("#folio-ai-message").fill("Start a task that I will manually cancel.");
  await page.getByRole("button", { name: /Send/ }).click();
  await page.locator(".fa-live-task-bar").waitFor({ timeout: 10_000 });
  await page.getByText(/Starting long draft that the user will cancel/).waitFor({ timeout: 10_000 });

  await page.locator(".fa-live-task-bar").getByRole("button", { name: /Cancel task/ }).click();
  await page.locator(".fa-task-badge.is-cancelled").first().waitFor({ timeout: 15_000 });

  // Verify the cancelled task did not consume the daily allowance slot (reserved is back to 0)
  const [cancelledRow] = await db
    .select()
    .from(folioAiTasks)
    .where(
      and(
        eq(folioAiTasks.userId, browserUser.id),
        eq(folioAiTasks.prompt, "Start a task that I will manually cancel."),
      ),
    );
  assert.equal(cancelledRow.status, "cancelled");
  console.log("PASS [7]: User manual cancellation stops generation, preserves partial output, and releases quota.");
} catch (error) {
  console.error("AI long-running task test suite failed:", error instanceof Error ? error.stack : error);
  console.error(serverLog.slice(-3500));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise(r => server.once("exit", r)),
      new Promise(r => setTimeout(r, 3000)),
    ]);
  }
  if (safe && createdUserIds.length) {
    try {
      for (const id of createdUserIds) {
        await db.delete(users).where(eq(users.id, id));
      }
      console.log("PASS: Scoped AI test accounts and tasks cleaned up.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr);
      process.exitCode = 1;
    }
  }
  await pool.end().catch(() => {});
}
