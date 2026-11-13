import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notificationPreferences } from "@/db/schema";
import { requireUser, sameOrigin } from "@/lib/auth";
import {
  ALLOWED_CALENDAR_INTERVALS,
  DEFAULT_REMINDER_TIMINGS,
  type DefaultReminderTiming,
} from "@/lib/notifications";
import {
  getOrCreatePreferences,
  getSchedulerTelemetry,
  processUserReminders,
  recomputeUserRelativeReminders,
  rowToPreferences,
} from "@/lib/reminder-processor";
import { isValidHHMM, isValidTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const BOOLEAN_KEYS = [
  "enabled",
  "timezoneAutoDetected",
  "quietHoursEnabled",
  "categoryTask",
  "categoryProject",
  "categoryDeadline",
  "categoryCalendar",
  "categorySystem",
  "taskUpcomingDeadlines",
  "taskOverdue",
  "taskReminders",
  "projectDeadlines",
  "milestoneReminders",
  "projectUpdates",
  "calendarUpcomingEvents",
  "calendarEventReminders",
] as const;

export async function GET() {
  try {
    await ensureSchema();
    const user = await requireUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

    const preferences = await getOrCreatePreferences(user.id);
    const scheduler = await getSchedulerTelemetry(preferences);
    return Response.json(
      { preferences, scheduler },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to load notification preferences:", error);
    return Response.json(
      { error: "Couldn’t load notification preferences." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }
  try {
    await ensureSchema();
    const user = await requireUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "Please send valid JSON." }, { status: 400 });

    const before = await getOrCreatePreferences(user.id);
    const patch: Partial<typeof notificationPreferences.$inferInsert> = {};

    for (const key of BOOLEAN_KEYS) {
      if (key in body) {
        if (typeof body[key] !== "boolean") {
          return Response.json({ error: `Invalid value for ${key}.` }, { status: 400 });
        }
        patch[key] = body[key];
      }
    }

    if ("defaultReminderTiming" in body) {
      if (
        typeof body.defaultReminderTiming !== "string" ||
        !DEFAULT_REMINDER_TIMINGS.includes(body.defaultReminderTiming as DefaultReminderTiming)
      ) {
        return Response.json({ error: "Choose a valid default reminder timing." }, { status: 400 });
      }
      patch.defaultReminderTiming = body.defaultReminderTiming;
    }

    if ("defaultDueTime" in body) {
      if (!isValidHHMM(body.defaultDueTime)) {
        return Response.json({ error: "Enter a valid default reminder time (HH:MM)." }, { status: 400 });
      }
      patch.defaultDueTime = body.defaultDueTime;
    }

    if ("timezone" in body) {
      if (!isValidTimezone(body.timezone)) {
        return Response.json({ error: "Select a valid IANA timezone." }, { status: 400 });
      }
      patch.timezone = body.timezone.trim();
    }

    if ("quietHoursStart" in body) {
      if (!isValidHHMM(body.quietHoursStart)) {
        return Response.json({ error: "Enter a valid quiet hours start time (HH:MM)." }, { status: 400 });
      }
      patch.quietHoursStart = body.quietHoursStart;
    }

    if ("quietHoursEnd" in body) {
      if (!isValidHHMM(body.quietHoursEnd)) {
        return Response.json({ error: "Enter a valid quiet hours end time (HH:MM)." }, { status: 400 });
      }
      patch.quietHoursEnd = body.quietHoursEnd;
    }

    if ("calendarReminderIntervals" in body) {
      if (!Array.isArray(body.calendarReminderIntervals)) {
        return Response.json({ error: "Calendar reminder intervals must be a list." }, { status: 400 });
      }
      const cleaned = [
        ...new Set(
          body.calendarReminderIntervals.filter(
            (v): v is number =>
              typeof v === "number" &&
              Number.isInteger(v) &&
              ALLOWED_CALENDAR_INTERVALS.includes(v),
          ),
        ),
      ].sort((a, b) => a - b);
      if (body.calendarReminderIntervals.length > 0 && cleaned.length === 0) {
        return Response.json({ error: "Select at least one valid calendar reminder interval." }, { status: 400 });
      }
      patch.calendarReminderIntervals = cleaned;
    }

    if (!Object.keys(patch).length) {
      const scheduler = await getSchedulerTelemetry(before);
      return Response.json({ preferences: before, scheduler });
    }

    patch.updatedAt = new Date();
    const [updated] = await db
      .update(notificationPreferences)
      .set(patch)
      .where(eq(notificationPreferences.userId, user.id))
      .returning();

    const preferences = updated ? rowToPreferences(updated) : await getOrCreatePreferences(user.id);

    if (patch.timezone && patch.timezone !== before.timezone) {
      await recomputeUserRelativeReminders(user.id, preferences.timezone);
    }

    await processUserReminders(user.id);
    const scheduler = await getSchedulerTelemetry(preferences);
    return Response.json({ preferences, scheduler });
  } catch (error) {
    console.error("Failed to save notification preferences:", error);
    return Response.json(
      { error: "Couldn’t save notification preferences." },
      { status: 500 },
    );
  }
}
