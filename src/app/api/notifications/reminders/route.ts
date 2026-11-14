import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { taskReminders } from "@/db/schema";
import { syncUser, corsJson, desktopCorsPreflight, unauthorized } from "@/lib/sync-auth";
import { REMINDER_TIMINGS, type ReminderTiming } from "@/lib/notifications";
import {
  removeTaskReminder,
  rowToTaskReminder,
  upsertTaskReminder,
} from "@/lib/reminder-processor";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    const taskId = new URL(request.url).searchParams.get("taskId");
    if (taskId !== null && !UUID_RE.test(taskId)) {
      return corsJson(request, { error: "Invalid task ID." }, 400);
    }

    const rows = taskId
      ? await db
          .select()
          .from(taskReminders)
          .where(and(eq(taskReminders.userId, user.id), eq(taskReminders.taskId, taskId)))
      : await db
          .select()
          .from(taskReminders)
          .where(eq(taskReminders.userId, user.id));

    return corsJson(request, { reminders: rows.map(rowToTaskReminder) });
  } catch (error) {
    console.error("Failed to load task reminders:", error);
    return corsJson(request, { error: "Couldn’t load task reminders." }, 500);
  }
}

async function saveReminder(request: Request) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return corsJson(request, { error: "Please send valid JSON." }, 400);

    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    if (!UUID_RE.test(taskId)) {
      return corsJson(request, { error: "Select a valid task." }, 400);
    }

    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const timing = typeof body.timing === "string" ? body.timing : "1h_before";
    if (!REMINDER_TIMINGS.includes(timing as ReminderTiming)) {
      return corsJson(request, { error: "Select a valid reminder timing." }, 400);
    }

    const dueTime = typeof body.dueTime === "string" ? body.dueTime : null;
    const customLocal = typeof body.customLocal === "string" ? body.customLocal : null;

    const reminder = await upsertTaskReminder(user.id, {
      taskId,
      enabled,
      timing,
      dueTime,
      customLocal,
    });
    return corsJson(request, { reminder });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn’t save task reminder.";
    const status = /not in your workspace/i.test(message) ? 404 : 400;
    return corsJson(request, { error: message }, status);
  }
}

export async function PUT(request: Request) {
  return saveReminder(request);
}

export async function POST(request: Request) {
  return saveReminder(request);
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    let taskId = new URL(request.url).searchParams.get("taskId");
    if (!taskId) {
      const body = (await request.json().catch(() => null)) as { taskId?: unknown } | null;
      if (typeof body?.taskId === "string") taskId = body.taskId;
    }
    if (!taskId || !UUID_RE.test(taskId)) {
      return corsJson(request, { error: "Provide a valid task ID." }, 400);
    }

    await removeTaskReminder(user.id, taskId);
    return corsJson(request, { deleted: true });
  } catch (error) {
    console.error("Failed to remove task reminder:", error);
    return corsJson(request, { error: "Couldn’t remove task reminder." }, 500);
  }
}
