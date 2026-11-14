import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notificationPreferences } from "@/db/schema";
import { syncUser, corsJson, desktopCorsPreflight, unauthorized } from "@/lib/sync-auth";
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

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

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

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    const preferences = await getOrCreatePreferences(user.id);
    const scheduler = await getSchedulerTelemetry(preferences);
    return corsJson(request, { preferences, scheduler });
  } catch (error) {
    console.error("Failed to load notification preferences:", error);
    return corsJson(
      request,
      { error: "Couldn’t load notification preferences." },
      500,
    );
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return corsJson(request, { error: "Please send valid JSON." }, 400);

    const before = await getOrCreatePreferences(user.id);
    const patch: Partial<typeof notificationPreferences.$inferInsert> = {};

    for (const key of BOOLEAN_KEYS) {
      if (key in body) {
        if (typeof body[key] !== "boolean") {
          return corsJson(request, { error: `Invalid value for ${key}.` }, 400);
        }
        patch[key] = body[key];
      }
    }

    if ("defaultReminderTiming" in body) {
      if (
        typeof body.defaultReminderTiming !== "string" ||
        !DEFAULT_REMINDER_TIMINGS.includes(body.defaultReminderTiming as DefaultReminderTiming)
      ) {
        return corsJson(request, { error: "Choose a valid default reminder timing." }, 400);
      }
      patch.defaultReminderTiming = body.defaultReminderTiming;
    }

    if ("defaultDueTime" in body) {
      if (!isValidHHMM(body.defaultDueTime)) {
        return corsJson(request, { error: "Enter a valid default reminder time (HH:MM)." }, 400);
      }
      patch.defaultDueTime = body.defaultDueTime;
    }

    if ("timezone" in body) {
      if (!isValidTimezone(body.timezone)) {
        return corsJson(request, { error: "Select a valid IANA timezone." }, 400);
      }
      patch.timezone = body.timezone.trim();
    }

    if ("quietHoursStart" in body) {
      if (!isValidHHMM(body.quietHoursStart)) {
        return corsJson(request, { error: "Enter a valid quiet hours start time (HH:MM)." }, 400);
      }
      patch.quietHoursStart = body.quietHoursStart;
    }

    if ("quietHoursEnd" in body) {
      if (!isValidHHMM(body.quietHoursEnd)) {
        return corsJson(request, { error: "Enter a valid quiet hours end time (HH:MM)." }, 400);
      }
      patch.quietHoursEnd = body.quietHoursEnd;
    }

    if ("calendarReminderIntervals" in body) {
      if (!Array.isArray(body.calendarReminderIntervals)) {
        return corsJson(request, { error: "Calendar reminder intervals must be a list." }, 400);
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
        return corsJson(request, { error: "Select at least one valid calendar reminder interval." }, 400);
      }
      patch.calendarReminderIntervals = cleaned;
    }

    if (!Object.keys(patch).length) {
      const scheduler = await getSchedulerTelemetry(before);
      return corsJson(request, { preferences: before, scheduler });
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
    return corsJson(request, { preferences, scheduler });
  } catch (error) {
    console.error("Failed to save notification preferences:", error);
    return corsJson(
      request,
      { error: "Couldn’t save notification preferences." },
      500,
    );
  }
}
