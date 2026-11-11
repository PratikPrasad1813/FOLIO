/**
 * End-to-end test of the Folio local SQLite layer (local-db.ts) running on a
 * REAL SQLite database (node:sqlite under the plugin's interface).
 * Verifies: schema bootstrap, outbox mutations, LWW pull application,
 * tombstone discipline (SQL NULL, never "null"), and the UI mappers.
 */
import {
  initLocalDb,
  insertLocalEntity,
  updateLocalEntity,
  deleteLocalEntity,
  applyPulledRows,
  listLocalWorkspace,
  countPendingMutations,
  takePendingMutations,
  deleteMutations,
  getLocalMetadata,
  setLocalMetadata,
  META_KEYS,
  setCachedProfile,
  getCachedProfile,
  getCachedActivities,
  setCachedActivities,
  wipeLocalDatabase,
  getLocalDb,
} from "@/lib/desktop/local-db";

let failures = 0;
function check(label, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${condition ? "" : ` — ${detail}`}`);
}

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = () => new Date().toISOString();

async function projectWire(id, over = {}) {
  return {
    id, user_id: USER, name: `Project ${id}`, description: "d", status: "Planning",
    priority: "Medium", color: "violet", icon: "layout", category: "Personal",
    start_date: null, due_date: null, favorite: false, archived: false,
    created_at: NOW(), updated_at: NOW(), deleted_at: null, ...over,
  };
}

// 1. Bootstrap.
await initLocalDb();
check("schema version persisted", (await getLocalMetadata(META_KEYS.schemaVersion)) === "1");

// 2. Profile cache.
const profile = { id: USER, name: "Test User", email: "t@t.dev", provider: "email", weeklyGoal: 12, onboardingCompleted: true };
await setCachedProfile(profile);
check("profile cached", (await getCachedProfile())?.id === USER);

// 3. INSERT lands in the mirror and the outbox.
const p1 = await insertLocalEntity("projects", await projectWire("22222222-2222-4222-8222-222222222221"));
check("insert returns wire", p1.id === "22222222-2222-4222-8222-222222222221");
check("insert queued", (await countPendingMutations()) === 1);
let queue = await takePendingMutations(10);
check("queue op is INSERT", queue[0].operation === "INSERT" && queue[0].entity_id === p1.id, JSON.stringify(queue[0]));

// 4. UPDATE bumps updated_at and queues a full-row UPDATE.
const later = new Date(Date.now() + 5000).toISOString();
const updated = await updateLocalEntity("projects", p1.id, { name: "Renamed", updated_at: later } );
check("update applied", updated?.name === "Renamed");
check("update queued", (await countPendingMutations()) === 2);
queue = await takePendingMutations(10);
check("queue op is UPDATE", queue[1].operation === "UPDATE");

// 5. Tombstone discipline: deleted_at is SQL NULL, never the string "null".
const db = await getLocalDb();
const raw = await db.select("SELECT deleted_at FROM local_projects WHERE id = $1", [p1.id]);
check("deleted_at is real SQL NULL", raw[0].deleted_at === null || raw[0].deleted_at === undefined, JSON.stringify(raw[0]));

// 6. Pull application — LWW.
const stale = await projectWire(p1.id, { name: "Stale Remote", updated_at: new Date(Date.now() - 60_000).toISOString() });
let outcome = await applyPulledRows("projects", [stale], USER);
check("stale remote skipped", outcome.skipped === 1 && outcome.applied === 0);
const fresh = await projectWire(p1.id, { name: "Fresh Remote", updated_at: new Date(Date.now() + 60_000).toISOString() });
outcome = await applyPulledRows("projects", [fresh], USER);
check("fresh remote applied", outcome.applied === 1);
const listed = await listLocalWorkspace(USER);
check("LWW winner visible", listed.projects[0].name === "Fresh Remote", listed.projects[0]?.name);

// 7. Pull application — tombstones remove rows.
const tombstone = await projectWire(p1.id, { name: "Fresh Remote", updated_at: new Date(Date.now() + 120_000).toISOString(), deleted_at: new Date(Date.now() + 120_000).toISOString() });
outcome = await applyPulledRows("projects", [tombstone], USER);
check("tombstone removed the row", outcome.removed === 1);
check("workspace now empty", (await listLocalWorkspace(USER)).projects.length === 0);

// 8. Another account's rows are never adopted.
await insertLocalEntity("projects", await projectWire("22222222-2222-4222-8222-222222222229"));
const foreign = await projectWire("22222222-2222-4222-8222-222222222230", { user_id: "99999999-9999-4999-8999-999999999999" });
outcome = await applyPulledRows("projects", [foreign], USER);
check("foreign row refused", outcome.applied === 0 && outcome.skipped === 0, JSON.stringify(outcome));

// 9. DELETE queues a delete op carrying the last known payload.
const victim = (await listLocalWorkspace(USER)).projects[0];
const deleted = await deleteLocalEntity("projects", victim.id);
check("delete returns last row", deleted?.id === victim.id);
queue = await takePendingMutations(50);
check("queue op is DELETE", queue[queue.length - 1].operation === "DELETE");

// 10. Drain: committed rows leave the queue.
await deleteMutations(queue.map((entry) => entry.id));
check("queue drained", (await countPendingMutations()) === 0);

// 11. Task with labels round-trips through SQLite JSON.
const taskWire = {
  id: "33333333-3333-4333-8333-333333333331", user_id: USER, project_id: null, milestone_id: null,
  title: "Labelled task", description: "", notes: "n", status: "in_progress", completed: false,
  priority: "High", start_date: null, due_date: "2026-02-02", labels: ["alpha", "beta"],
  estimate_minutes: 45, completed_at: null, created_at: NOW(), updated_at: NOW(), deleted_at: null,
};
await insertLocalEntity("tasks", taskWire);
const tasks = (await listLocalWorkspace(USER)).tasks;
check("task labels round-trip", JSON.stringify(tasks[0].labels) === JSON.stringify(["alpha", "beta"]), JSON.stringify(tasks[0]?.labels));
check("task priority round-trip", tasks[0].priority === "High");
check("task completed is boolean", tasks[0].completed === false);

// 12. Activities snapshot.
await setCachedActivities([{ id: "a1", text: "Created project", type: "project", projectId: null, taskId: null, createdAt: NOW() }]);
check("activity cached", (await getCachedActivities()).length === 1);

// 13. wipe clears everything (account switch).
await wipeLocalDatabase();
check("wipe cleared projects", (await listLocalWorkspace(USER)).projects.length === 0);
check("wipe cleared tasks", (await listLocalWorkspace(USER)).tasks.length === 0);
check("wipe cleared queue", (await countPendingMutations()) === 0);
check("wipe cleared profile", (await getCachedProfile()) === null);

// 14. Same-millisecond create+delete stays strictly ordered (LWW tie safety).
const quick = await insertLocalEntity("projects", await projectWire("22222222-2222-4222-8222-222222222239"));
const quickDelete = await deleteLocalEntity("projects", quick.id);
const queueTie = await takePendingMutations(100);
const insertOp = queueTie.find((entry) => entry.entity_id === quick.id && entry.operation === "INSERT");
const deleteOp = queueTie.find((entry) => entry.entity_id === quick.id && entry.operation === "DELETE");
check("same-ms delete stamps strictly after insert", deleteOp.updated_at > insertOp.updated_at, `${insertOp?.updated_at} vs ${deleteOp?.updated_at}`);
await deleteMutations(queueTie.map((entry) => entry.id));

console.log(failures ? `\n${failures} FAILURES` : "\nALL LOCAL-DB CHECKS PASSED");
process.exit(failures ? 1 : 0);
