/**
 * POST /api/sync/push — receive a batch of outbox mutations from the desktop
 * sync engine and apply them to Neon PostgreSQL inside ONE transaction.
 *
 * Body: { mutations: SyncMutation[] }  (max 200 per batch)
 *
 * Semantics (Last-Write-Wins):
 *   - INSERT / UPDATE → upsert. The stored row is replaced only when
 *     incoming.updated_at >= existing.updated_at AND the existing row belongs
 *     to the authenticated user. Stale or foreign rows are silently skipped.
 *   - DELETE → soft delete: deleted_at = updated_at = incoming.updated_at.
 *     A missing row becomes a tombstone so other devices learn about it.
 *
 * The response reports a per-item outcome:
 *   applied  — written to Neon
 *   skipped  — LWW rejected (server copy already newer) or foreign row
 *   rejected — malformed / constraint-failing mutation; the client drops it
 *              (it can never succeed)
 *
 * Each mutation runs on its own SAVEPOINT inside the batch transaction: a
 * poison mutation is rejected without rolling back — or blocking — the rest
 * of the outbox. Transient infrastructure failures bubble up as HTTP 500 so
 * the client keeps the queue and retries later.
 */

import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { ideas, milestones, projects, subtasks, tasks } from "@/db/schema";
import { syncUser, unauthorized, corsJson, desktopCorsPreflight } from "@/lib/sync-auth";
import {
  boundedInt,
  boundedText,
  isNullish,
  isSyncEntityType,
  oneOf,
  optionalDay,
  parseIsoTimestamp,
  SYNC_UUID_PATTERN,
  toBoolean,
  IDEA_STATUS_VALUES,
  PROJECT_COLOR_VALUES,
  PROJECT_ICON_VALUES,
  PROJECT_PRIORITY_VALUES,
  PROJECT_STATUS_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  type ProjectSyncRow,
  type SyncEntityType,
  type SyncMutation,
  type SyncOperation,
  type SyncPushResult,
  type TaskSyncRow,
} from "@/lib/sync-protocol";

export const dynamic = "force-dynamic";

const MAX_BATCH = 200;

type ProjectInsert = Omit<typeof projects.$inferInsert, "userId">;
type TaskInsert = Omit<typeof tasks.$inferInsert, "userId">;
type MilestoneInsert = Omit<typeof milestones.$inferInsert, "userId">;
type SubtaskInsert = Omit<typeof subtasks.$inferInsert, "userId">;
type IdeaInsert = Omit<typeof ideas.$inferInsert, "userId">;

/** A parsed mutation ready for the transaction. */
interface PreparedMutation {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  updatedAt: Date;
  project?: ProjectInsert;
  task?: TaskInsert;
  milestone?: MilestoneInsert;
  subtask?: SubtaskInsert;
  idea?: IdeaInsert;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function labels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((label): label is string => typeof label === "string" && label.trim().length > 0 && label.length <= 24)
    .slice(0, 8)
    .map((label) => label.trim());
}

/** Timestamp columns need Date objects; invalid input falls back to the mutation time. */
function completedAtDate(value: unknown, fallback: Date): Date {
  const iso = parseIsoTimestamp(value);
  return iso ? new Date(iso) : fallback;
}

/**
 * Sanitise one incoming mutation into typed Drizzle values. `userId` is ALWAYS
 * the session user — the wire payload can never claim another account.
 */
function prepare(mutation: unknown): PreparedMutation | { error: string } {
  if (!mutation || typeof mutation !== "object") return { error: "Malformed mutation." };
  const raw = mutation as Partial<SyncMutation> & Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id || raw.id.length > 100) return { error: "Invalid queue id." };
  if (!isSyncEntityType(raw.entity_type)) return { error: "Unknown entity type." };
  const entityType = raw.entity_type;
  if (typeof raw.entity_id !== "string" || !SYNC_UUID_PATTERN.test(raw.entity_id)) return { error: "Invalid entity id." };
  if (typeof raw.operation !== "string" || !["INSERT", "UPDATE", "DELETE"].includes(raw.operation.toUpperCase())) {
    return { error: "Invalid operation." };
  }
  const updatedAtIso = parseIsoTimestamp(raw.updated_at);
  if (!updatedAtIso) return { error: "Invalid updated_at." };
  if (!raw.payload || typeof raw.payload !== "object") return { error: "Missing payload." };
  const payload = raw.payload as unknown as Record<string, unknown>;
  if (typeof payload.id !== "string" || payload.id !== raw.entity_id) return { error: "Payload id mismatch." };

  const updatedAt = new Date(updatedAtIso);
  const createdAt = parseIsoTimestamp(payload.created_at) ?? updatedAtIso;
  const prepared: PreparedMutation = {
    id: raw.id,
    entityType,
    entityId: raw.entity_id,
    operation: raw.operation.toUpperCase() as SyncOperation,
    updatedAt,
  };

  switch (entityType) {
    case "projects": {
      const row = payload as unknown as Partial<ProjectSyncRow>;
      prepared.project = {
        id: raw.entity_id,
        name: boundedText(row.name, 200, "") || "Untitled project",
        description: boundedText(row.description, 4000),
        status: oneOf(PROJECT_STATUS_VALUES, row.status, "Planning"),
        priority: oneOf(PROJECT_PRIORITY_VALUES, row.priority, "Medium"),
        color: oneOf(PROJECT_COLOR_VALUES, row.color, "violet"),
        icon: oneOf(PROJECT_ICON_VALUES, row.icon, "layout"),
        category: boundedText(row.category, 50, "Personal"),
        startDate: optionalDay(row.start_date),
        dueDate: optionalDay(row.due_date),
        favorite: toBoolean(row.favorite),
        archived: toBoolean(row.archived),
        createdAt: new Date(createdAt),
        updatedAt,
      };
      break;
    }
    case "tasks": {
      const row = payload as unknown as Partial<TaskSyncRow>;
      const completed = toBoolean(row.completed);
      const status = oneOf(TASK_STATUS_VALUES, row.status, completed ? "done" : "todo");
      prepared.task = {
        id: raw.entity_id,
        title: boundedText(row.title, 200, "") || "Untitled task",
        description: boundedText(row.description, 4000),
        notes: boundedText(row.notes, 8000),
        status,
        completed: status === "done",
        priority: oneOf(TASK_PRIORITY_VALUES, row.priority, "Medium"),
        startDate: optionalDay(row.start_date),
        dueDate: optionalDay(row.due_date),
        labels: labels(row.labels),
        estimateMinutes: isNullish(row.estimate_minutes) ? null : boundedInt(row.estimate_minutes, 1, 43_200, 30),
        projectId: isNullish(row.project_id) ? null : row.project_id,
        milestoneId: isNullish(row.milestone_id) ? null : row.milestone_id,
        completedAt: status === "done" ? completedAtDate(row.completed_at, updatedAt) : null,
        createdAt: new Date(createdAt),
        updatedAt,
      };
      break;
    }
    case "milestones": {
      const parentProject = typeof payload.project_id === "string" && SYNC_UUID_PATTERN.test(payload.project_id)
        ? payload.project_id
        : null;
      if (!parentProject) return { error: "Milestone payload is missing its project id." };
      prepared.milestone = {
        id: raw.entity_id,
        projectId: parentProject,
        title: boundedText(payload.title, 120, "") || "Untitled milestone",
        description: boundedText(payload.description, 2000),
        dueDate: optionalDay(payload.due_date),
        completed: toBoolean(payload.completed),
        completedAt: toBoolean(payload.completed) ? completedAtDate(payload.completed_at, updatedAt) : null,
        createdAt: new Date(createdAt),
        updatedAt,
      };
      break;
    }
    case "subtasks": {
      const parentTask = typeof payload.task_id === "string" && SYNC_UUID_PATTERN.test(payload.task_id)
        ? payload.task_id
        : null;
      if (!parentTask) return { error: "Subtask payload is missing its task id." };
      prepared.subtask = {
        id: raw.entity_id,
        taskId: parentTask,
        title: boundedText(payload.title, 200, "") || "Untitled step",
        completed: toBoolean(payload.completed),
        completedAt: toBoolean(payload.completed) ? completedAtDate(payload.completed_at, updatedAt) : null,
        position: boundedInt(payload.position, 0, 1_000_000, 0),
        createdAt: new Date(createdAt),
        updatedAt,
      };
      break;
    }
    case "ideas": {
      prepared.idea = {
        id: raw.entity_id,
        title: boundedText(payload.title, 100, "") || "Untitled idea",
        description: boundedText(payload.description, 4000),
        category: boundedText(payload.category, 50, "Personal"),
        color: oneOf(PROJECT_COLOR_VALUES, payload.color, "yellow"),
        status: oneOf(IDEA_STATUS_VALUES, payload.status, "Just an idea"),
        createdAt: new Date(createdAt),
        updatedAt,
      };
      break;
    }
  }
  return prepared;
}

/* ------------------------------------------------------------------ */
/* per-table LWW writers                                               */
/* ------------------------------------------------------------------ */

async function upsertProject(tx: Tx, userId: string, values: ProjectInsert, updatedAt: Date): Promise<boolean> {
  const rows = await tx.insert(projects)
    .values({ ...values, userId })
    .onConflictDoUpdate({
      target: projects.id,
      set: { ...values, deletedAt: null },
      setWhere: and(eq(projects.userId, userId), lte(projects.updatedAt, sql`excluded.updated_at`)),
    })
    .returning({ id: projects.id });
  return rows.length > 0;
}

async function softDeleteProject(tx: Tx, userId: string, id: string, values: ProjectInsert, updatedAt: Date): Promise<boolean> {
  const updated = await tx.update(projects)
    .set({ deletedAt: updatedAt, updatedAt })
    .where(and(eq(projects.id, id), eq(projects.userId, userId), lte(projects.updatedAt, updatedAt)))
    .returning({ id: projects.id });
  if (updated.length > 0) return true;
  // The row never reached the cloud: insert a tombstone (unless a newer copy
  // exists — LWW then wins over this delete).
  const rows = await tx.insert(projects)
    .values({ ...values, userId, deletedAt: updatedAt, updatedAt })
    .onConflictDoUpdate({
      target: projects.id,
      set: { deletedAt: updatedAt, updatedAt },
      setWhere: and(eq(projects.userId, userId), lte(projects.updatedAt, updatedAt)),
    })
    .returning({ id: projects.id });
  return rows.length > 0;
}

async function upsertTask(tx: Tx, userId: string, values: TaskInsert, updatedAt: Date): Promise<boolean> {
  const rows = await tx.insert(tasks)
    .values({ ...values, userId })
    .onConflictDoUpdate({
      target: tasks.id,
      set: { ...values, deletedAt: null },
      setWhere: and(eq(tasks.userId, userId), lte(tasks.updatedAt, sql`excluded.updated_at`)),
    })
    .returning({ id: tasks.id });
  return rows.length > 0;
}

async function softDeleteTask(tx: Tx, userId: string, id: string, values: TaskInsert, updatedAt: Date): Promise<boolean> {
  const updated = await tx.update(tasks)
    .set({ deletedAt: updatedAt, updatedAt })
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId), lte(tasks.updatedAt, updatedAt)))
    .returning({ id: tasks.id });
  if (updated.length > 0) return true;
  const rows = await tx.insert(tasks)
    .values({ ...values, userId, deletedAt: updatedAt, updatedAt })
    .onConflictDoUpdate({
      target: tasks.id,
      set: { deletedAt: updatedAt, updatedAt },
      setWhere: and(eq(tasks.userId, userId), lte(tasks.updatedAt, updatedAt)),
    })
    .returning({ id: tasks.id });
  return rows.length > 0;
}

async function upsertMilestone(tx: Tx, userId: string, values: MilestoneInsert, updatedAt: Date): Promise<boolean> {
  const rows = await tx.insert(milestones)
    .values({ ...values, userId })
    .onConflictDoUpdate({
      target: milestones.id,
      set: { ...values, deletedAt: null },
      setWhere: and(eq(milestones.userId, userId), lte(milestones.updatedAt, sql`excluded.updated_at`)),
    })
    .returning({ id: milestones.id });
  return rows.length > 0;
}

async function softDeleteMilestone(tx: Tx, userId: string, id: string, values: MilestoneInsert, updatedAt: Date): Promise<boolean> {
  const updated = await tx.update(milestones)
    .set({ deletedAt: updatedAt, updatedAt })
    .where(and(eq(milestones.id, id), eq(milestones.userId, userId), lte(milestones.updatedAt, updatedAt)))
    .returning({ id: milestones.id });
  if (updated.length > 0) return true;
  const rows = await tx.insert(milestones)
    .values({ ...values, userId, deletedAt: updatedAt, updatedAt })
    .onConflictDoUpdate({
      target: milestones.id,
      set: { deletedAt: updatedAt, updatedAt },
      setWhere: and(eq(milestones.userId, userId), lte(milestones.updatedAt, updatedAt)),
    })
    .returning({ id: milestones.id });
  return rows.length > 0;
}

async function upsertSubtask(tx: Tx, userId: string, values: SubtaskInsert, updatedAt: Date): Promise<boolean> {
  const rows = await tx.insert(subtasks)
    .values({ ...values, userId })
    .onConflictDoUpdate({
      target: subtasks.id,
      set: { ...values, deletedAt: null },
      setWhere: and(eq(subtasks.userId, userId), lte(subtasks.updatedAt, sql`excluded.updated_at`)),
    })
    .returning({ id: subtasks.id });
  return rows.length > 0;
}

async function softDeleteSubtask(tx: Tx, userId: string, id: string, values: SubtaskInsert, updatedAt: Date): Promise<boolean> {
  const updated = await tx.update(subtasks)
    .set({ deletedAt: updatedAt, updatedAt })
    .where(and(eq(subtasks.id, id), eq(subtasks.userId, userId), lte(subtasks.updatedAt, updatedAt)))
    .returning({ id: subtasks.id });
  if (updated.length > 0) return true;
  const rows = await tx.insert(subtasks)
    .values({ ...values, userId, deletedAt: updatedAt, updatedAt })
    .onConflictDoUpdate({
      target: subtasks.id,
      set: { deletedAt: updatedAt, updatedAt },
      setWhere: and(eq(subtasks.userId, userId), lte(subtasks.updatedAt, updatedAt)),
    })
    .returning({ id: subtasks.id });
  return rows.length > 0;
}

async function upsertIdea(tx: Tx, userId: string, values: IdeaInsert, updatedAt: Date): Promise<boolean> {
  const rows = await tx.insert(ideas)
    .values({ ...values, userId })
    .onConflictDoUpdate({
      target: ideas.id,
      set: { ...values, deletedAt: null },
      setWhere: and(eq(ideas.userId, userId), lte(ideas.updatedAt, sql`excluded.updated_at`)),
    })
    .returning({ id: ideas.id });
  return rows.length > 0;
}

async function softDeleteIdea(tx: Tx, userId: string, id: string, values: IdeaInsert, updatedAt: Date): Promise<boolean> {
  const updated = await tx.update(ideas)
    .set({ deletedAt: updatedAt, updatedAt })
    .where(and(eq(ideas.id, id), eq(ideas.userId, userId), lte(ideas.updatedAt, updatedAt)))
    .returning({ id: ideas.id });
  if (updated.length > 0) return true;
  const rows = await tx.insert(ideas)
    .values({ ...values, userId, deletedAt: updatedAt, updatedAt })
    .onConflictDoUpdate({
      target: ideas.id,
      set: { deletedAt: updatedAt, updatedAt },
      setWhere: and(eq(ideas.userId, userId), lte(ideas.updatedAt, updatedAt)),
    })
    .returning({ id: ideas.id });
  return rows.length > 0;
}

/** Run one mutation on its own savepoint; false ⇒ LWW-skipped. Throws on DB errors. */
async function applyMutation(tx: Tx, userId: string, mutation: PreparedMutation): Promise<boolean> {
  return tx.transaction(async (inner) => {
    const isDelete = mutation.operation === "DELETE";
    switch (mutation.entityType) {
      case "projects":
        if (!mutation.project) throw new Error("Missing project payload.");
        return isDelete
          ? softDeleteProject(inner, userId, mutation.entityId, mutation.project, mutation.updatedAt)
          : upsertProject(inner, userId, mutation.project, mutation.updatedAt);
      case "tasks":
        if (!mutation.task) throw new Error("Missing task payload.");
        return isDelete
          ? softDeleteTask(inner, userId, mutation.entityId, mutation.task, mutation.updatedAt)
          : upsertTask(inner, userId, mutation.task, mutation.updatedAt);
      case "milestones":
        if (!mutation.milestone) throw new Error("Missing milestone payload.");
        return isDelete
          ? softDeleteMilestone(inner, userId, mutation.entityId, mutation.milestone, mutation.updatedAt)
          : upsertMilestone(inner, userId, mutation.milestone, mutation.updatedAt);
      case "subtasks":
        if (!mutation.subtask) throw new Error("Missing subtask payload.");
        return isDelete
          ? softDeleteSubtask(inner, userId, mutation.entityId, mutation.subtask, mutation.updatedAt)
          : upsertSubtask(inner, userId, mutation.subtask, mutation.updatedAt);
      case "ideas":
        if (!mutation.idea) throw new Error("Missing idea payload.");
        return isDelete
          ? softDeleteIdea(inner, userId, mutation.entityId, mutation.idea, mutation.updatedAt)
          : upsertIdea(inner, userId, mutation.idea, mutation.updatedAt);
    }
  });
}

function rawMutationsGuard(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_BATCH;
}

/** CORS preflight for the desktop shell (cross-origin Tauri webview). */
export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

export async function POST(request: Request) {
  const user = await syncUser(request);
  if (!user) return unauthorized("Please sign in to sync your workspace.", request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsJson(request, { error: "A JSON body with a mutations array is required." }, 400);
  }
  const rawMutations = body && typeof body === "object" && Array.isArray((body as { mutations?: unknown }).mutations)
    ? (body as { mutations: unknown[] }).mutations
    : null;
  if (!rawMutationsGuard(rawMutations)) {
    return corsJson(request, { error: "A mutations array with at most 200 entries is required." }, 400);
  }

  const prepared: PreparedMutation[] = [];
  const results: SyncPushResult[] = [];
  let rejected = 0;
  for (const candidate of rawMutations) {
    const outcome = prepare(candidate);
    if ("error" in outcome) {
      const queueId = candidate && typeof candidate === "object" && typeof (candidate as SyncMutation).id === "string"
        ? (candidate as SyncMutation).id
        : `unknown-${rejected}`;
      results.push({ id: queueId, status: "rejected", reason: outcome.error });
      rejected += 1;
    } else {
      prepared.push(outcome);
    }
  }

  await ensureSchema();
  let applied = 0;
  let skipped = 0;

  if (prepared.length) {
    try {
      await db.transaction(async (tx) => {
        for (const mutation of prepared) {
          try {
            const written = await applyMutation(tx, user.id, mutation);
            if (written) {
              applied += 1;
              results.push({ id: mutation.id, status: "applied" });
            } else {
              skipped += 1;
              results.push({ id: mutation.id, status: "skipped", reason: "Server copy is newer (Last-Write-Wins)." });
            }
          } catch (error) {
            // Deterministic per-mutation failure (constraint, FK, shape): drop
            // it instead of letting it poison the whole outbox.
            console.error(`Sync push rejected mutation ${mutation.entityType}/${mutation.entityId}:`, error);
            rejected += 1;
            results.push({ id: mutation.id, status: "rejected", reason: "The mutation violated server constraints." });
          }
        }
      });
    } catch (error) {
      console.error("Sync push transaction failed:", error);
      return corsJson(
        request,
        { error: "The sync batch could not be committed. It will be retried." },
        500,
      );
    }
  }

  return corsJson(
    request,
    { server_time: new Date().toISOString(), results, applied, skipped, rejected },
  );
}
