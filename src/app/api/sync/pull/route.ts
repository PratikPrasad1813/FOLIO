/**
 * GET /api/sync/pull?since=<ISO_TIMESTAMP> — delta download for the desktop
 * sync engine.
 *
 * Returns every row owned by the authenticated user with
 * `updated_at > since`, INCLUDING soft-deleted rows (tombstones) so that
 * deletions propagate to every device. Omitting `since` performs a full
 * snapshot (first launch on a new device).
 *
 * The response also carries:
 *   - server_time  — the authoritative cursor to persist as last_pulled_at
 *   - profile      — the user snapshot that drives the local-first UI shell
 *   - activities   — the latest activity-feed rows (display-only)
 *
 * `server_time` is captured BEFORE the data queries run, so a row committed
 * while the response is being built is simply re-delivered on the next pull
 * (LWW application is idempotent) and never missed.
 */

import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { activities, ideas, milestones, notificationPreferences, projects, subtasks, tasks } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { syncUser, unauthorized, corsJson, desktopCorsPreflight } from "@/lib/sync-auth";
import { parseIsoTimestamp, type SyncPullResponse, type SyncEntityRows } from "@/lib/sync-protocol";

export const dynamic = "force-dynamic";

/** Safety cap per entity — a personal workspace is far below this. */
const MAX_ROWS_PER_ENTITY = 5000;

/** CORS preflight for the desktop shell (cross-origin Tauri webview). */
export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function GET(request: Request) {
  const user = await syncUser(request);
  if (!user) return unauthorized("Please sign in to sync your workspace.", request);

  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (key !== "since") {
      return corsJson(request, { error: "Unknown sync parameter." }, 400);
    }
  }
  const sinceRaw = params.get("since");
  const since = sinceRaw === null ? null : parseIsoTimestamp(sinceRaw);
  if (sinceRaw !== null && !since) {
    return corsJson(request, { error: "The since parameter must be an ISO-8601 timestamp." }, 400);
  }
  const sinceDate = since ? new Date(since) : null;

  await ensureSchema();
  const serverTime = new Date().toISOString();

  try {
    const [projectRows, taskRows, milestoneRows, subtaskRows, ideaRows, activityRows, [regional]] = await Promise.all([
      sinceDate
        ? db.select().from(projects).where(and(eq(projects.userId, user.id), gt(projects.updatedAt, sinceDate))).orderBy(projects.updatedAt).limit(MAX_ROWS_PER_ENTITY)
        : db.select().from(projects).where(eq(projects.userId, user.id)).orderBy(projects.updatedAt).limit(MAX_ROWS_PER_ENTITY),
      sinceDate
        ? db.select().from(tasks).where(and(eq(tasks.userId, user.id), gt(tasks.updatedAt, sinceDate))).orderBy(tasks.updatedAt).limit(MAX_ROWS_PER_ENTITY)
        : db.select().from(tasks).where(eq(tasks.userId, user.id)).orderBy(tasks.updatedAt).limit(MAX_ROWS_PER_ENTITY),
      sinceDate
        ? db.select().from(milestones).where(and(eq(milestones.userId, user.id), gt(milestones.updatedAt, sinceDate))).orderBy(milestones.updatedAt).limit(MAX_ROWS_PER_ENTITY)
        : db.select().from(milestones).where(eq(milestones.userId, user.id)).orderBy(milestones.updatedAt).limit(MAX_ROWS_PER_ENTITY),
      sinceDate
        ? db.select().from(subtasks).where(and(eq(subtasks.userId, user.id), gt(subtasks.updatedAt, sinceDate))).orderBy(subtasks.updatedAt).limit(MAX_ROWS_PER_ENTITY)
        : db.select().from(subtasks).where(eq(subtasks.userId, user.id)).orderBy(subtasks.updatedAt).limit(MAX_ROWS_PER_ENTITY),
      sinceDate
        ? db.select().from(ideas).where(and(eq(ideas.userId, user.id), gt(ideas.updatedAt, sinceDate))).orderBy(ideas.updatedAt).limit(MAX_ROWS_PER_ENTITY)
        : db.select().from(ideas).where(eq(ideas.userId, user.id)).orderBy(ideas.updatedAt).limit(MAX_ROWS_PER_ENTITY),
      db.select().from(activities).where(eq(activities.userId, user.id)).orderBy(desc(activities.createdAt)).limit(40),
      db.select({ timezone: notificationPreferences.timezone }).from(notificationPreferences).where(eq(notificationPreferences.userId, user.id)).limit(1),
    ]);

    const changes: SyncEntityRows = {
      projects: projectRows.map((row) => ({
        id: row.id,
        user_id: row.userId,
        name: row.name,
        description: row.description,
        status: row.status,
        priority: row.priority,
        color: row.color,
        icon: row.icon,
        category: row.category,
        start_date: row.startDate,
        due_date: row.dueDate,
        favorite: row.favorite,
        archived: row.archived,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        deleted_at: iso(row.deletedAt),
      })),
      tasks: taskRows.map((row) => ({
        id: row.id,
        user_id: row.userId,
        project_id: row.projectId,
        milestone_id: row.milestoneId,
        title: row.title,
        description: row.description,
        notes: row.notes,
        status: row.status,
        completed: row.completed,
        priority: row.priority,
        start_date: row.startDate,
        due_date: row.dueDate,
        labels: row.labels,
        estimate_minutes: row.estimateMinutes,
        completed_at: iso(row.completedAt),
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        deleted_at: iso(row.deletedAt),
      })),
      milestones: milestoneRows.map((row) => ({
        id: row.id,
        user_id: row.userId,
        project_id: row.projectId,
        title: row.title,
        description: row.description,
        due_date: row.dueDate,
        completed: row.completed,
        completed_at: iso(row.completedAt),
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        deleted_at: iso(row.deletedAt),
      })),
      subtasks: subtaskRows.map((row) => ({
        id: row.id,
        user_id: row.userId,
        task_id: row.taskId,
        title: row.title,
        completed: row.completed,
        completed_at: iso(row.completedAt),
        position: row.position,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        deleted_at: iso(row.deletedAt),
      })),
      ideas: ideaRows.map((row) => ({
        id: row.id,
        user_id: row.userId,
        title: row.title,
        description: row.description,
        category: row.category,
        color: row.color,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        deleted_at: iso(row.deletedAt),
      })),
    };

    const response: SyncPullResponse = {
      server_time: serverTime,
      changes,
      profile: { ...publicUser(user), timezone: regional?.timezone || "UTC" },
      activities: activityRows.map((row) => ({
        id: row.id,
        text: row.text,
        type: row.type,
        projectId: row.projectId,
        taskId: row.taskId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
    return corsJson(request, response);
  } catch (error) {
    console.error("Sync pull failed:", error);
    return corsJson(
      request,
      { error: "Your workspace changes could not be fetched. Please try again shortly." },
      500,
    );
  }
}
