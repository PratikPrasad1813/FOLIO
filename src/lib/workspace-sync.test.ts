import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db, enableMockDbMode } from "@/db";
import { ideas, notificationPreferences, projects, tasks, users } from "@/db/schema";
import { browseWorkspace, globalSearch } from "@/lib/search-service";
import { defaultFilters } from "@/lib/search-types";
import {
  boundedInt,
  boundedText,
  isSyncEntityType,
  isSyncOperation,
  optionalDay,
  parseIsoTimestamp,
  toSqlNull,
} from "@/lib/sync-protocol";

// Ensure unit tests always run against the isolated in-memory mock DB rather
// than mutating any configured PostgreSQL instance.
enableMockDbMode();

const USER_A = "00000000-0000-4000-8000-000000000101";
const USER_B = "00000000-0000-4000-8000-000000000202";

test("sync protocol validators enforce canonical formats and bounds", () => {
  assert.equal(isSyncEntityType("projects"), true);
  assert.equal(isSyncEntityType("tasks"), true);
  assert.equal(isSyncEntityType("unknown"), false);

  assert.equal(isSyncOperation("INSERT"), true);
  assert.equal(isSyncOperation("delete"), true);
  assert.equal(isSyncOperation("UPSERT"), false);

  assert.equal(parseIsoTimestamp("2026-11-10T12:00:00Z"), "2026-11-10T12:00:00.000Z");
  assert.equal(parseIsoTimestamp("not-a-timestamp"), null);

  assert.equal(optionalDay("2026-11-20"), "2026-11-20");
  assert.equal(optionalDay("invalid-date"), null);

  assert.equal(boundedInt(50_000, 1, 43_200, 30), 43_200);
  assert.equal(boundedInt("bad", 1, 100, 15), 15);
  assert.equal(boundedText("abcdefghijk", 5, ""), "abcde");
  assert.equal(boundedText(123, 5, "fallback"), "fallback");
  assert.equal(toSqlNull("null"), null);
  assert.equal(toSqlNull(""), null);
  assert.equal(toSqlNull("2026-11-10T12:00:00.000Z"), "2026-11-10T12:00:00.000Z");
});

test("mock DB enforces Last-Write-Wins and user ownership on conflict upserts", async () => {
  const projectId = "10000000-0000-4000-8000-000000000101";
  const t1 = new Date("2026-11-10T10:00:00.000Z");
  const t0 = new Date("2026-11-10T09:00:00.000Z");
  const t2 = new Date("2026-11-10T11:00:00.000Z");

  const initial = await db
    .insert(projects)
    .values({
      id: projectId,
      userId: USER_A,
      name: "Initial Project",
      description: "v1",
      status: "Planning",
      priority: "Medium",
      color: "violet",
      icon: "layout",
      category: "Engineering",
      createdAt: t1,
      updatedAt: t1,
    })
    .returning({ id: projects.id });
  assert.equal(initial.length, 1);

  // Older timestamp must be rejected by LWW setWhere.
  const stale = await db
    .insert(projects)
    .values({
      id: projectId,
      userId: USER_A,
      name: "Stale Project Name",
      description: "stale",
      status: "Planning",
      priority: "Low",
      color: "blue",
      icon: "layout",
      category: "Engineering",
      createdAt: t0,
      updatedAt: t0,
    })
    .onConflictDoUpdate({
      target: projects.id,
      set: { name: "Stale Project Name", updatedAt: t0, deletedAt: null },
      setWhere: and(eq(projects.userId, USER_A), lte(projects.updatedAt, sql`excluded.updated_at`)),
    })
    .returning({ id: projects.id });
  assert.equal(stale.length, 0);

  // Different user must NEVER overwrite USER_A's row even with a newer timestamp.
  const foreign = await db
    .insert(projects)
    .values({
      id: projectId,
      userId: USER_B,
      name: "Hijacked Project",
      description: "evil",
      status: "Planning",
      priority: "High",
      color: "red",
      icon: "layout",
      category: "Engineering",
      createdAt: t2,
      updatedAt: t2,
    })
    .onConflictDoUpdate({
      target: projects.id,
      set: { name: "Hijacked Project", updatedAt: t2, deletedAt: null },
      setWhere: and(eq(projects.userId, USER_B), lte(projects.updatedAt, sql`excluded.updated_at`)),
    })
    .returning({ id: projects.id });
  assert.equal(foreign.length, 0);

  // Newer timestamp from owning user succeeds.
  const newer = await db
    .insert(projects)
    .values({
      id: projectId,
      userId: USER_A,
      name: "Updated Project",
      description: "v2",
      status: "In progress",
      priority: "High",
      color: "violet",
      icon: "layout",
      category: "Engineering",
      createdAt: t1,
      updatedAt: t2,
    })
    .onConflictDoUpdate({
      target: projects.id,
      set: { name: "Updated Project", updatedAt: t2, deletedAt: null },
      setWhere: and(eq(projects.userId, USER_A), lte(projects.updatedAt, sql`excluded.updated_at`)),
    })
    .returning({ id: projects.id, name: projects.name });
  assert.equal(newer.length, 1);
  assert.equal(newer[0].name, "Updated Project");
});

test("soft-deleted entities are hidden from search/browse while retained as sync tombstones", async () => {
  await db.insert(users).values({
    id: USER_A,
    name: "Sync Tester",
    email: "sync-tester@example.invalid",
    provider: "email",
    personal: { weekStart: 1 },
  });
  await db.insert(notificationPreferences).values({
    userId: USER_A,
    timezone: "UTC",
    calendarReminderIntervals: [15],
  });

  const activeProjectId = "10000000-0000-4000-8000-000000000301";
  const deletedProjectId = "10000000-0000-4000-8000-000000000302";
  const activeTaskId = "20000000-0000-4000-8000-000000000301";
  const deletedTaskId = "20000000-0000-4000-8000-000000000302";
  const deletedIdeaId = "30000000-0000-4000-8000-000000000301";

  const baseTime = new Date("2026-11-12T08:00:00.000Z");
  const deleteTime = new Date("2026-11-12T09:00:00.000Z");

  await db.insert(projects).values([
    {
      id: activeProjectId,
      userId: USER_A,
      name: "Active Project",
      description: "Visible",
      status: "In progress",
      priority: "Medium",
      color: "violet",
      icon: "layout",
      category: "Work",
      createdAt: baseTime,
      updatedAt: baseTime,
      deletedAt: null,
    },
    {
      id: deletedProjectId,
      userId: USER_A,
      name: "Deleted Project",
      description: "Hidden",
      status: "Planning",
      priority: "Low",
      color: "blue",
      icon: "layout",
      category: "Work",
      createdAt: baseTime,
      updatedAt: deleteTime,
      deletedAt: deleteTime,
    },
  ]);

  await db.insert(tasks).values([
    {
      id: activeTaskId,
      userId: USER_A,
      projectId: activeProjectId,
      title: "Active Task",
      description: "Visible task",
      notes: "",
      status: "todo",
      completed: false,
      priority: "Medium",
      labels: [],
      createdAt: baseTime,
      updatedAt: baseTime,
      deletedAt: null,
    },
    {
      id: deletedTaskId,
      userId: USER_A,
      projectId: activeProjectId,
      title: "Deleted Task",
      description: "Tombstoned task",
      notes: "",
      status: "todo",
      completed: false,
      priority: "Low",
      labels: [],
      createdAt: baseTime,
      updatedAt: deleteTime,
      deletedAt: deleteTime,
    },
  ]);

  await db.insert(ideas).values({
    id: deletedIdeaId,
    userId: USER_A,
    title: "Deleted Idea",
    description: "Tombstoned idea",
    category: "Notes",
    color: "yellow",
    status: "Exploring",
    createdAt: baseTime,
    updatedAt: deleteTime,
    deletedAt: deleteTime,
  });

  const searchRes = await globalSearch(USER_A, "Deleted", "all", 10);
  const projectSearchIds = searchRes.groups.find((g) => g.kind === "projects")?.items.map((i) => i.id) ?? [];
  const taskSearchIds = searchRes.groups.find((g) => g.kind === "tasks")?.items.map((i) => i.id) ?? [];
  const ideaSearchIds = searchRes.groups.find((g) => g.kind === "ideas")?.items.map((i) => i.id) ?? [];

  assert.equal(projectSearchIds.includes(deletedProjectId), false);
  assert.equal(taskSearchIds.includes(deletedTaskId), false);
  assert.equal(ideaSearchIds.includes(deletedIdeaId), false);

  const browsedTasks = await browseWorkspace(USER_A, "tasks", defaultFilters("tasks"), 50, 0);
  assert.deepEqual(browsedTasks.items.map((t) => t.id), [activeTaskId]);

  const browsedProjects = await browseWorkspace(USER_A, "projects", defaultFilters("projects"), 50, 0);
  assert.equal(browsedProjects.items.some((p) => p.id === deletedProjectId), false);

  // Sync delta pull (`updated_at > baseTime`) MUST still include tombstones so
  // remote deletions propagate to other offline devices.
  const pullProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, USER_A), gt(projects.updatedAt, baseTime)));
  const tombstoneProject = pullProjects.find((p) => p.id === deletedProjectId);
  assert.ok(tombstoneProject);
  assert.ok(tombstoneProject.deletedAt instanceof Date);

  const pullTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, USER_A), gt(tasks.updatedAt, baseTime)));
  const tombstoneTask = pullTasks.find((t) => t.id === deletedTaskId);
  assert.ok(tombstoneTask);
  assert.ok(tombstoneTask.deletedAt instanceof Date);
});
