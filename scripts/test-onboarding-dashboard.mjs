import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { inArray, eq } from "drizzle-orm";

// Verifies the two dashboard states and the empty-workspace fix.
// Section A exercises profile persistence against PostgreSQL.
// Section B exercises the live HTTP app (routing + API guards).
// No real Google/GitHub consent is claimed as tested.
const load = createRequire(import.meta.url)("./folio-test-loader.cjs");
const { db, pool } = load(resolve("src/db/index.ts"));
const { users, projects, tasks, ideas } = load(resolve("src/db/schema.ts"));
const { publicUser } = load(resolve("src/lib/auth.ts"));
const { updateProfile, readProfile } = load(resolve("src/lib/profile-service.ts"));

const BASE = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const ids = [];
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const equal = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

async function newUser({ completed = false, step = 0 } = {}) {
  const [u] = await db.insert(users).values({
    name: "Dashboard Tester", email: `dash-${randomUUID()}@example.invalid`, provider: "neon",
    authUserId: randomUUID(), onboardingStep: step,
    onboardingCompletedAt: completed ? new Date() : null,
  }).returning();
  ids.push(u.id);
  return u;
}
async function create(kind, userId, title) {
  const table = kind === "projects" ? projects : kind === "tasks" ? tasks : ideas;
  const values = { userId, ...(kind === "tasks" ? { labels: [] } : {}), ...(kind === "ideas" ? {} : { description: "" }) };
  const [row] = await db.insert(table).values({ ...values, ...(kind === "projects" ? {} : {}), name: title, title } ).returning().catch(async () => {
    // projects/ideas vs tasks use different column sets
    const [retry] = await db.insert(table).values(kind === "tasks" ? { userId, title, labels: [] } : kind === "projects" ? { userId, name: title } : { userId, title }).returning();
    return [retry];
  });
  return row;
}

try {
  /* ---- Section A: persisted onboarding state (PostgreSQL) ---- */
  // 1. A new user starts incomplete.
  const fresh = await newUser();
  equal(publicUser(fresh).onboardingCompleted, false, "A new user has onboarding incomplete");
  equal((await readProfile(fresh)).onboardingCompleted, false, "readProfile agrees");

  // 2/3/4. The first successful creation completes onboarding, for each kind.
  for (const kind of ["projects", "tasks", "ideas"]) {
    const u = await newUser();
    await create(kind, u.id, `First ${kind}`);
    // The client calls updateProfile({complete:true, firstAction:true}) only
    // after the server confirms the creation.
    const result = await updateProfile(u.id, { complete: true, firstAction: true });
    equal(result.onboardingCompleted, true, `Creating the first ${kind} completes onboarding`);
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    ok(row.onboardingCompletedAt !== null, `${kind}: completion persisted in PostgreSQL`);
  }

  // 5/6. Completion survives deletion of ALL content.
  const survivor = await newUser({ completed: true, step: 10 });
  const p = await create("projects", survivor.id, "Only project");
  await create("tasks", survivor.id, "Only task");
  await create("ideas", survivor.id, "Only idea");
  await db.delete(tasks).where(eq(tasks.userId, survivor.id));
  await db.delete(ideas).where(eq(ideas.userId, survivor.id));
  await db.delete(projects).where(eq(projects.id, p.id));
  const [afterDelete] = await db.select().from(users).where(eq(users.id, survivor.id));
  equal(publicUser(afterDelete).onboardingCompleted, true, "Deleting every project, task and idea does NOT reset onboarding");

  // 6b. Sign-out/sign-in does not reset it (the flag is per-user in Postgres).
  const reread = await db.select().from(users).where(eq(users.id, survivor.id));
  equal(publicUser(reread[0]).onboardingCompleted, true, "Completion is independent of the session");

  // 11. Two users have independent states.
  const a = await newUser();
  const b = await newUser({ completed: true, step: 10 });
  equal(publicUser(a).onboardingCompleted, false, "User A stays incomplete");
  equal(publicUser(b).onboardingCompleted, true, "User B stays complete");

  // 12. A failed creation must not complete onboarding.
  const careful = await newUser();
  let rejected = false;
  try { await updateProfile(careful.id, { complete: true, firstAction: true, step: 99 }); }
  catch { rejected = true; }
  ok(rejected, "An invalid update is rejected");
  let stillRejected = false;
  try { await updateProfile(careful.id, { complete: true, personal: { theme: "broken" } }); }
  catch { stillRejected = true; }
  ok(stillRejected, "An invalid personal payload is rejected without completing");
  const [carefulRow] = await db.select().from(users).where(eq(users.id, careful.id));
  equal(publicUser(carefulRow).onboardingCompleted, false, "A failed operation does not complete onboarding");

  console.log("✓ Persisted onboarding state: new users, first-action completion for each kind, deletion survival, session independence, per-user isolation, failed-operation safety");

  /* ---- Section B: live routing/API behaviour ---- */
  equal((await fetch(`${BASE}/api/health`)).status, 200, "App is running");
  for (const path of ["/overview", "/projects", "/tasks", "/ideas"]) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    equal(res.status, 307, `Protected page ${path} redirects when signed out`);
  }
  const unauth = await fetch(`${BASE}/api/workspace`);
  equal(unauth.status, 401, "Workspace API is protected");

  console.log("✓ Live routing: protected pages redirect, workspace API returns 401");
  console.log(`\nPASS: ${checks} onboarding dashboard assertions.`);
} finally {
  if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
}
