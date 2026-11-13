import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { taskReminders } from "@/db/schema";
import { requireUser, sameOrigin } from "@/lib/auth";
import { REMINDER_TIMINGS, type ReminderTiming } from "@/lib/notifications";
import {
  removeTaskReminder,
  rowToTaskReminder,
  upsertTaskReminder,
} from "@/lib/reminder-processor";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const user = await requireUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

    const taskId = new URL(request.url).searchParams.get("taskId");
    if (taskId !== null && !UUID_RE.test(taskId)) {
      return Response.json({ error: "Invalid task ID." }, { status: 400 });
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

    return Response.json(
      { reminders: rows.map(rowToTaskReminder) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to load task reminders:", error);
    return Response.json({ error: "Couldn’t load task reminders." }, { status: 500 });
  }
}

async function saveReminder(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }
  try {
    const user = await requireUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "Please send valid JSON." }, { status: 400 });

    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    if (!UUID_RE.test(taskId)) {
      return Response.json({ error: "Select a valid task." }, { status: 400 });
    }

    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const timing = typeof body.timing === "string" ? body.timing : "1h_before";
    if (!REMINDER_TIMINGS.includes(timing as ReminderTiming)) {
      return Response.json({ error: "Select a valid reminder timing." }, { status: 400 });
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
    return Response.json({ reminder });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn’t save task reminder.";
    const status = /not in your workspace/i.test(message) ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  return saveReminder(request);
}

export async function POST(request: Request) {
  return saveReminder(request);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }
  try {
    const user = await requireUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

    let taskId = new URL(request.url).searchParams.get("taskId");
    if (!taskId) {
      const body = (await request.json().catch(() => null)) as { taskId?: unknown } | null;
      if (typeof body?.taskId === "string") taskId = body.taskId;
    }
    if (!taskId || !UUID_RE.test(taskId)) {
      return Response.json({ error: "Provide a valid task ID." }, { status: 400 });
    }

    await removeTaskReminder(user.id, taskId);
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to remove task reminder:", error);
    return Response.json({ error: "Couldn’t remove task reminder." }, { status: 500 });
  }
}
