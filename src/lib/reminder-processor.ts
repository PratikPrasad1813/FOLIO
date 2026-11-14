import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { ensureSchema } from "@/db/migrate";
import {
  googleAccounts,
  googleCalendars,
  googleEvents,
  milestones,
  notificationPreferences,
  notifications,
  projects,
  reminderDeliveries,
  schedulerRuns,
  taskReminders,
  tasks,
  users,
} from "@/db/schema";
import { formatDate, statusLabel } from "@/lib/types";
import {
  ALLOWED_CALENDAR_INTERVALS,
  computeTaskRemindAt,
  DEFAULT_NOTIFICATION_PREFERENCES,
  formatCalendarInterval,
  REMINDER_TIMINGS,
  REMINDER_TIMING_LABELS,
  type DefaultReminderTiming,
  type NotificationCategory,
  type NotificationEntityType,
  type NotificationMetadata,
  type NotificationPreferencesData,
  type NotificationType,
  type ReminderTiming,
  type SchedulerTelemetry,
  type TaskReminderConfig,
} from "@/lib/notifications";
import {
  calendarDaysDiff,
  formatDateTimeInZone,
  getZonedParts,
  isValidHHMM,
  isWithinQuietHours,
  localDateTimeToUtc,
  nextQuietHoursEndUtc,
  parseCustomLocalToUtc,
  safeTimezone,
  shiftDateKey,
} from "@/lib/timezone";

const PROCESSOR_LOCK_KEY = 72_031_918;
const SCHEDULER_ROW_ID = "reminders";

// Per-user throttle map so frequent UI polls don't trigger redundant evaluation passes.
const lastUserCheck = new Map<string, number>();

export function isCronConfigured(): boolean {
  return Boolean((process.env.FOLIO_CRON_SECRET || process.env.CRON_SECRET || "").trim());
}

export function rowToPreferences(
  row: typeof notificationPreferences.$inferSelect,
): NotificationPreferencesData {
  return {
    enabled: row.enabled,
    defaultReminderTiming: (row.defaultReminderTiming as DefaultReminderTiming) || "1h_before",
    defaultDueTime: row.defaultDueTime || "09:00",
    timezone: safeTimezone(row.timezone),
    timezoneAutoDetected: row.timezoneAutoDetected,
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursStart: row.quietHoursStart || "22:00",
    quietHoursEnd: row.quietHoursEnd || "08:00",
    categoryTask: row.categoryTask,
    categoryProject: row.categoryProject,
    categoryDeadline: row.categoryDeadline,
    categoryCalendar: row.categoryCalendar,
    categorySystem: row.categorySystem,
    taskUpcomingDeadlines: row.taskUpcomingDeadlines,
    taskOverdue: row.taskOverdue,
    taskReminders: row.taskReminders,
    projectDeadlines: row.projectDeadlines,
    milestoneReminders: row.milestoneReminders,
    projectUpdates: row.projectUpdates,
    calendarUpcomingEvents: row.calendarUpcomingEvents,
    calendarEventReminders: row.calendarEventReminders,
    calendarReminderIntervals: Array.isArray(row.calendarReminderIntervals)
      ? row.calendarReminderIntervals.filter((n) => ALLOWED_CALENDAR_INTERVALS.includes(n)).sort((a, b) => a - b)
      : [15, 60],
  };
}

export function rowToTaskReminder(row: typeof taskReminders.$inferSelect): TaskReminderConfig {
  return {
    id: row.id,
    taskId: row.taskId,
    enabled: row.enabled,
    timing: (row.timing as ReminderTiming) || "1h_before",
    dueTime: row.dueTime || "09:00",
    customLocal: row.customLocal,
    customAt: row.customAt ? row.customAt.toISOString() : null,
    remindAt: row.remindAt ? row.remindAt.toISOString() : null,
    status: (row.status as TaskReminderConfig["status"]) || "pending",
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrCreatePreferences(userId: string): Promise<NotificationPreferencesData> {
  await ensureSchema();
  const [existing] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  if (existing) return rowToPreferences(existing);

  const [created] = await db
    .insert(notificationPreferences)
    .values({
      userId,
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      calendarReminderIntervals: DEFAULT_NOTIFICATION_PREFERENCES.calendarReminderIntervals,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return rowToPreferences(created);

  const [fallback] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return fallback ? rowToPreferences(fallback) : DEFAULT_NOTIFICATION_PREFERENCES;
}

export async function getSchedulerTelemetry(
  prefs: NotificationPreferencesData,
): Promise<SchedulerTelemetry> {
  await ensureSchema();
  const [row] = await db
    .select()
    .from(schedulerRuns)
    .where(eq(schedulerRuns.id, SCHEDULER_ROW_ID))
    .limit(1);
  const quietNow = isWithinQuietHours(
    new Date(),
    prefs.timezone,
    prefs.quietHoursEnabled,
    prefs.quietHoursStart,
    prefs.quietHoursEnd,
  );
  return {
    cronConfigured: isCronConfigured(),
    lastRunAt: row?.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastRunSource: row?.lastRunSource ?? null,
    lastCronRunAt: row?.lastCronRunAt ? row.lastCronRunAt.toISOString() : null,
    lastRunStatus: row?.lastRunStatus ?? "never",
    lastCreatedCount: row?.lastCreatedCount ?? 0,
    quietHoursActiveNow: quietNow,
  };
}

async function recordSchedulerRun(source: string, status: string, createdCount: number) {
  const now = new Date();
  const isCron = source === "cron";
  await db
    .insert(schedulerRuns)
    .values({
      id: SCHEDULER_ROW_ID,
      lastRunAt: now,
      lastRunSource: source,
      lastCronRunAt: isCron ? now : null,
      lastRunStatus: status,
      lastCreatedCount: createdCount,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schedulerRuns.id,
      set: {
        lastRunAt: now,
        lastRunSource: source,
        ...(isCron ? { lastCronRunAt: now } : {}),
        lastRunStatus: status,
        lastCreatedCount: createdCount,
        updatedAt: now,
      },
    });
}

export function isNotificationAllowed(
  prefs: NotificationPreferencesData,
  category: NotificationCategory,
  type: NotificationType,
): boolean {
  if (!prefs.enabled) return false;
  if (category === "task" && !prefs.categoryTask) return false;
  if (category === "project" && !prefs.categoryProject) return false;
  if (category === "deadline" && !prefs.categoryDeadline) return false;
  if (category === "calendar" && !prefs.categoryCalendar) return false;
  if (category === "system" && !prefs.categorySystem) return false;

  switch (type) {
    case "task_reminder":
      return prefs.taskReminders;
    case "task_due_today":
    case "task_upcoming_deadline":
      return prefs.taskUpcomingDeadlines;
    case "task_overdue":
      return prefs.taskOverdue;
    case "project_deadline":
      return prefs.projectDeadlines;
    case "milestone_approaching":
    case "milestone_completed":
      return prefs.milestoneReminders;
    case "project_status_changed":
    case "project_updated":
      return prefs.projectUpdates;
    case "calendar_upcoming":
      return prefs.calendarUpcomingEvents;
    case "calendar_reminder":
      return prefs.calendarEventReminders;
    case "system_info":
      return true;
  }
}

export interface NotificationPayload {
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  description: string;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  metadata?: NotificationMetadata | null;
  scheduledFor?: Date | null;
  dedupeKey: string;
  sourceType: string;
  sourceId: string;
}

/**
 * Idempotently creates a notification if allowed by user preferences and not
 * previously delivered/queued for `(userId, dedupeKey)`.
 * Respects quiet hours by queueing delivery until quiet hours end.
 */
export async function deliverNotification(
  userId: string,
  prefs: NotificationPreferencesData,
  payload: NotificationPayload,
  now: Date = new Date(),
): Promise<{ created: boolean; queued: boolean }> {
  if (!isNotificationAllowed(prefs, payload.category, payload.type)) {
    return { created: false, queued: false };
  }

  // Check persistent delivery history so deleted notifications are never recreated.
  const [already] = await db
    .select({ id: reminderDeliveries.id, status: reminderDeliveries.status })
    .from(reminderDeliveries)
    .where(
      and(
        eq(reminderDeliveries.userId, userId),
        eq(reminderDeliveries.dedupeKey, payload.dedupeKey),
      ),
    )
    .limit(1);

  if (already && (already.status === "delivered" || already.status === "queued_quiet_hours")) {
    return { created: false, queued: false };
  }

  const inQuietHours = isWithinQuietHours(
    now,
    prefs.timezone,
    prefs.quietHoursEnabled,
    prefs.quietHoursStart,
    prefs.quietHoursEnd,
  );
  const deliveryStatus = inQuietHours ? "queued_quiet_hours" : "delivered";
  const scheduledFor = inQuietHours
    ? nextQuietHoursEndUtc(now, prefs.timezone, prefs.quietHoursStart, prefs.quietHoursEnd)
    : payload.scheduledFor ?? null;
  const deliveredAt = inQuietHours ? null : now;

  const [inserted] = await db
    .insert(notifications)
    .values({
      userId,
      category: payload.category,
      type: payload.type,
      title: payload.title,
      description: payload.description,
      entityType: payload.entityType,
      entityId: payload.entityId,
      metadata: payload.metadata ?? null,
      read: false,
      scheduledFor,
      deliveredAt,
      deliveryStatus,
      dedupeKey: payload.dedupeKey,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (!inserted) return { created: false, queued: false };

  await db
    .insert(reminderDeliveries)
    .values({
      userId,
      dedupeKey: payload.dedupeKey,
      sourceType: payload.sourceType,
      sourceId: payload.sourceId,
      reminderType: payload.type,
      scheduledFor,
      status: deliveryStatus,
      notifId: inserted.id,
      deliveredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [reminderDeliveries.userId, reminderDeliveries.dedupeKey],
      set: {
        status: deliveryStatus,
        notifId: inserted.id,
        scheduledFor,
        updatedAt: now,
      },
    });

  return { created: true, queued: inQuietHours };
}

/**
 * Releases notifications queued during quiet hours once quiet hours end,
 * cancelling any whose underlying task/milestone/event was completed or deleted.
 */
async function releaseQuietHoursQueue(
  userId: string,
  prefs: NotificationPreferencesData,
  now: Date,
): Promise<number> {
  if (
    isWithinQuietHours(
      now,
      prefs.timezone,
      prefs.quietHoursEnabled,
      prefs.quietHoursStart,
      prefs.quietHoursEnd,
    )
  ) {
    return 0;
  }

  const queued = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.deliveryStatus, "queued_quiet_hours"),
      ),
    );
  if (!queued.length) return 0;

  let released = 0;
  for (const item of queued) {
    let stillValid = true;
    if (item.entityType === "task" && item.entityId) {
      const [t] = await db
        .select({ id: tasks.id, completed: tasks.completed })
        .from(tasks)
        .where(and(eq(tasks.id, item.entityId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .limit(1);
      if (!t || t.completed) stillValid = false;
    } else if (item.entityType === "calendar_event" && item.entityId) {
      const [ev] = await db
        .select({ id: googleEvents.id, status: googleEvents.status })
        .from(googleEvents)
        .where(and(eq(googleEvents.id, item.entityId), eq(googleEvents.userId, userId)))
        .limit(1);
      if (!ev || ev.status !== "confirmed") stillValid = false;
    }

    if (!stillValid) {
      await db.delete(notifications).where(eq(notifications.id, item.id));
      await db
        .update(reminderDeliveries)
        .set({ status: "cancelled", updatedAt: now })
        .where(
          and(
            eq(reminderDeliveries.userId, userId),
            eq(reminderDeliveries.dedupeKey, item.dedupeKey),
          ),
        );
      continue;
    }

    await db
      .update(notifications)
      .set({
        deliveryStatus: "delivered",
        deliveredAt: now,
        createdAt: now,
      })
      .where(eq(notifications.id, item.id));
    await db
      .update(reminderDeliveries)
      .set({ status: "delivered", deliveredAt: now, updatedAt: now })
      .where(
        and(
          eq(reminderDeliveries.userId, userId),
          eq(reminderDeliveries.dedupeKey, item.dedupeKey),
        ),
      );
    released++;
  }
  return released;
}

/* -------------------------------------------------------------------------- */
/* Task Reminder Configuration & Lifecycle Hooks                              */
/* -------------------------------------------------------------------------- */

export interface UpsertTaskReminderInput {
  taskId: string;
  enabled: boolean;
  timing: string;
  dueTime?: string | null;
  customLocal?: string | null;
}

export async function upsertTaskReminder(
  userId: string,
  input: UpsertTaskReminderInput,
): Promise<TaskReminderConfig> {
  await ensureSchema();
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!task) throw new Error("That task is not in your workspace.");

  const timing = REMINDER_TIMINGS.includes(input.timing as ReminderTiming)
    ? (input.timing as ReminderTiming)
    : "1h_before";

  const prefs = await getOrCreatePreferences(userId);
  const dueTime = isValidHHMM(input.dueTime) ? input.dueTime : prefs.defaultDueTime || "09:00";
  const customLocal = timing === "custom" && typeof input.customLocal === "string" && input.customLocal.trim()
    ? input.customLocal.trim()
    : null;

  if (timing === "custom" && input.enabled && !customLocal) {
    throw new Error("Choose a custom reminder date and time.");
  }

  const customAt = timing === "custom" && customLocal
    ? parseCustomLocalToUtc(customLocal, prefs.timezone)
    : null;
  if (timing === "custom" && input.enabled && !customAt) {
    throw new Error("Enter a valid custom reminder date and time.");
  }

  const remindAt = computeTaskRemindAt({
    dueDate: task.dueDate,
    timing,
    dueTime,
    customLocal,
    timezone: prefs.timezone,
  });

  const now = new Date();
  const status: TaskReminderConfig["status"] =
    !input.enabled || task.completed || !remindAt ? "cancelled" : "pending";

  const [existing] = await db
    .select()
    .from(taskReminders)
    .where(and(eq(taskReminders.taskId, task.id), eq(taskReminders.userId, userId)))
    .limit(1);

  if (existing && existing.remindAt?.getTime() !== remindAt?.getTime()) {
    // Cancel any queued quiet-hours reminders tied to a superseded reminder time.
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.entityType, "task"),
          eq(notifications.entityId, task.id),
          eq(notifications.type, "task_reminder"),
          eq(notifications.deliveryStatus, "queued_quiet_hours"),
        ),
      );
  }

  const [saved] = await db
    .insert(taskReminders)
    .values({
      userId,
      taskId: task.id,
      enabled: Boolean(input.enabled),
      timing,
      dueTime,
      customLocal,
      customAt,
      remindAt,
      status,
      deliveredAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskReminders.taskId,
      set: {
        enabled: Boolean(input.enabled),
        timing,
        dueTime,
        customLocal,
        customAt,
        remindAt,
        status,
        deliveredAt: status === "pending" ? null : existing?.deliveredAt ?? null,
        updatedAt: now,
      },
    })
    .returning();

  // If the configured reminder time is already due right now, evaluate immediately.
  if (saved.enabled && saved.status === "pending" && saved.remindAt && saved.remindAt <= now) {
    await processUserReminders(userId, { source: "reminder_save" });
    const [refreshed] = await db
      .select()
      .from(taskReminders)
      .where(eq(taskReminders.id, saved.id))
      .limit(1);
    if (refreshed) return rowToTaskReminder(refreshed);
  }

  return rowToTaskReminder(saved);
}

export async function removeTaskReminder(userId: string, taskId: string): Promise<void> {
  await ensureSchema();
  await db
    .delete(taskReminders)
    .where(and(eq(taskReminders.userId, userId), eq(taskReminders.taskId, taskId)));
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.entityType, "task"),
        eq(notifications.entityId, taskId),
        eq(notifications.type, "task_reminder"),
        eq(notifications.deliveryStatus, "queued_quiet_hours"),
      ),
    );
}

/**
 * Reconciles pending task reminders and queued notifications when a task is
 * created, completed, reopened, rescheduled, or deleted.
 */
export async function reconcileTaskLifecycle(
  userId: string,
  before: typeof tasks.$inferSelect | null,
  after: typeof tasks.$inferSelect | null,
): Promise<void> {
  await ensureSchema();
  const now = new Date();

  // Deleted task: clean up queued notifications.
  if (!after && before) {
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.entityType, "task"),
          eq(notifications.entityId, before.id),
          eq(notifications.deliveryStatus, "queued_quiet_hours"),
        ),
      );
    return;
  }
  if (!after) return;

  // Completed task: cancel pending reminder and queued notifications.
  if (after.completed) {
    await db
      .update(taskReminders)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(taskReminders.userId, userId),
          eq(taskReminders.taskId, after.id),
          eq(taskReminders.status, "pending"),
        ),
      );
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.entityType, "task"),
          eq(notifications.entityId, after.id),
          eq(notifications.deliveryStatus, "queued_quiet_hours"),
        ),
      );
    return;
  }

  // Open task: check if dueDate changed or task was reopened.
  const [reminder] = await db
    .select()
    .from(taskReminders)
    .where(and(eq(taskReminders.userId, userId), eq(taskReminders.taskId, after.id)))
    .limit(1);

  if (before && before.dueDate !== after.dueDate) {
    // Cancel queued deadline notifications for the superseded due date.
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.entityType, "task"),
          eq(notifications.entityId, after.id),
          eq(notifications.deliveryStatus, "queued_quiet_hours"),
        ),
      );
  }

  if (!reminder) return;

  const dueChanged = before ? before.dueDate !== after.dueDate : false;
  const reopened = before ? before.completed && !after.completed : false;
  if (!dueChanged && !reopened) return;

  const prefs = await getOrCreatePreferences(userId);
  const timing = (reminder.timing as ReminderTiming) || "1h_before";
  const nextRemindAt = computeTaskRemindAt({
    dueDate: after.dueDate,
    timing,
    dueTime: reminder.dueTime || prefs.defaultDueTime,
    customLocal: reminder.customLocal,
    timezone: prefs.timezone,
  });

  let nextStatus = reminder.status;
  let nextDeliveredAt = reminder.deliveredAt;
  if (!reminder.enabled || !nextRemindAt) {
    nextStatus = "cancelled";
  } else if (dueChanged && timing !== "custom") {
    nextStatus = "pending";
    nextDeliveredAt = null;
  } else if (reopened && nextRemindAt > now) {
    nextStatus = "pending";
    nextDeliveredAt = null;
  }

  await db
    .update(taskReminders)
    .set({
      remindAt: nextRemindAt,
      status: nextStatus,
      deliveredAt: nextDeliveredAt,
      updatedAt: now,
    })
    .where(eq(taskReminders.id, reminder.id));
}

export async function reconcileBulkTaskLifecycle(
  userId: string,
  taskIds: string[],
  deleted: boolean,
): Promise<void> {
  if (!taskIds.length) return;
  await ensureSchema();
  if (deleted) {
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.entityType, "task"),
          inArray(notifications.entityId, taskIds),
          eq(notifications.deliveryStatus, "queued_quiet_hours"),
        ),
      );
    return;
  }
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), inArray(tasks.id, taskIds), isNull(tasks.deletedAt)));
  for (const row of rows) {
    if (row.completed) {
      await reconcileTaskLifecycle(userId, null, row);
    } else {
      const [rem] = await db
        .select()
        .from(taskReminders)
        .where(and(eq(taskReminders.userId, userId), eq(taskReminders.taskId, row.id)))
        .limit(1);
      if (rem) {
        const prefs = await getOrCreatePreferences(userId);
        const nextRemindAt = computeTaskRemindAt({
          dueDate: row.dueDate,
          timing: (rem.timing as ReminderTiming) || "1h_before",
          dueTime: rem.dueTime || prefs.defaultDueTime,
          customLocal: rem.customLocal,
          timezone: prefs.timezone,
        });
        await db
          .update(taskReminders)
          .set({
            remindAt: nextRemindAt,
            status: rem.enabled && nextRemindAt ? "pending" : "cancelled",
            updatedAt: new Date(),
          })
          .where(eq(taskReminders.id, rem.id));
      }
    }
  }
}

export async function recomputeUserRelativeReminders(
  userId: string,
  timezone: string,
): Promise<void> {
  await ensureSchema();
  const rows = await db
    .select({
      reminder: taskReminders,
      dueDate: tasks.dueDate,
      completed: tasks.completed,
    })
    .from(taskReminders)
    .innerJoin(tasks, and(eq(tasks.id, taskReminders.taskId), isNull(tasks.deletedAt)))
    .where(and(eq(taskReminders.userId, userId), eq(taskReminders.enabled, true)));

  for (const { reminder, dueDate, completed } of rows) {
    if (completed) continue;
    const timing = (reminder.timing as ReminderTiming) || "1h_before";
    const nextRemindAt =
      timing === "custom" && reminder.customLocal
        ? parseCustomLocalToUtc(reminder.customLocal, timezone)
        : computeTaskRemindAt({
            dueDate,
            timing,
            dueTime: reminder.dueTime || "09:00",
            customLocal: reminder.customLocal,
            timezone,
          });
    if (nextRemindAt && reminder.status !== "delivered") {
      await db
        .update(taskReminders)
        .set({ remindAt: nextRemindAt, updatedAt: new Date() })
        .where(eq(taskReminders.id, reminder.id));
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Project & Milestone Immediate Activity Notifications                       */
/* -------------------------------------------------------------------------- */

export async function emitProjectMutationNotifications(
  userId: string,
  before: typeof projects.$inferSelect | null,
  after: typeof projects.$inferSelect | null,
  options: { convertedFromIdea?: boolean } = {},
): Promise<void> {
  if (!after) {
    if (before) {
      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.entityType, "project"),
            eq(notifications.entityId, before.id),
            eq(notifications.deliveryStatus, "queued_quiet_hours"),
          ),
        );
    }
    return;
  }

  const prefs = await getOrCreatePreferences(userId);
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16);

  if (options.convertedFromIdea) {
    await deliverNotification(
      userId,
      prefs,
      {
        category: "project",
        type: "project_updated",
        title: `New project started: “${after.name}”`,
        description: "Converted from your idea board and ready for its first milestone or task.",
        entityType: "project",
        entityId: after.id,
        metadata: { projectId: after.id, projectName: after.name },
        dedupeKey: `project_converted:${after.id}`,
        sourceType: "project",
        sourceId: after.id,
      },
      now,
    );
    return;
  }

  if (!before) return;

  if (before.status !== after.status) {
    await deliverNotification(
      userId,
      prefs,
      {
        category: "project",
        type: "project_status_changed",
        title:
          after.status === "Completed"
            ? `Project completed: “${after.name}”`
            : `“${after.name}” moved to ${statusLabel(after.status)}`,
        description: `Status updated from ${statusLabel(before.status)} to ${statusLabel(after.status)}.`,
        entityType: "project",
        entityId: after.id,
        metadata: { projectId: after.id, projectName: after.name },
        dedupeKey: `project_status:${after.id}:${after.status}:${stamp}`,
        sourceType: "project",
        sourceId: after.id,
      },
      now,
    );
  }

  if (before.archived !== after.archived) {
    await deliverNotification(
      userId,
      prefs,
      {
        category: "project",
        type: "project_updated",
        title: after.archived
          ? `Project archived: “${after.name}”`
          : `Project restored: “${after.name}”`,
        description: after.archived
          ? "Archived projects pause deadline reminders until restored."
          : "Back in your active projects workspace.",
        entityType: "project",
        entityId: after.id,
        metadata: { projectId: after.id, projectName: after.name },
        dedupeKey: `project_archive:${after.id}:${after.archived}:${stamp}`,
        sourceType: "project",
        sourceId: after.id,
      },
      now,
    );
  } else if (before.dueDate !== after.dueDate && after.dueDate) {
    await deliverNotification(
      userId,
      prefs,
      {
        category: "project",
        type: "project_updated",
        title: `Deadline updated for “${after.name}”`,
        description: `Target date is now ${formatDate(after.dueDate, { month: "short", day: "numeric", year: "numeric" })}.`,
        entityType: "project",
        entityId: after.id,
        metadata: { projectId: after.id, projectName: after.name },
        dedupeKey: `project_duedate:${after.id}:${after.dueDate}:${stamp}`,
        sourceType: "project",
        sourceId: after.id,
      },
      now,
    );
  } else if (before.priority !== "High" && after.priority === "High") {
    await deliverNotification(
      userId,
      prefs,
      {
        category: "project",
        type: "project_updated",
        title: `“${after.name}” marked high priority`,
        description: "Elevated to high priority in your projects list.",
        entityType: "project",
        entityId: after.id,
        metadata: { projectId: after.id, projectName: after.name },
        dedupeKey: `project_high_pri:${after.id}:${stamp}`,
        sourceType: "project",
        sourceId: after.id,
      },
      now,
    );
  }
}

export async function emitMilestoneMutationNotifications(
  userId: string,
  before: typeof milestones.$inferSelect | null,
  after: typeof milestones.$inferSelect | null,
): Promise<void> {
  if (!after) return;
  if (before && !before.completed && after.completed) {
    const prefs = await getOrCreatePreferences(userId);
    const [proj] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, after.projectId), eq(projects.userId, userId), isNull(projects.deletedAt)))
      .limit(1);
    const now = new Date();
    const stamp = (after.completedAt ?? now).toISOString().slice(0, 16);

    // Cancel any queued approaching-deadline alert for this now-completed milestone.
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, "milestone_approaching"),
          eq(notifications.deliveryStatus, "queued_quiet_hours"),
          sql`${notifications.metadata}->>'milestoneId' = ${after.id}`,
        ),
      );

    await deliverNotification(
      userId,
      prefs,
      {
        category: "project",
        type: "milestone_completed",
        title: `Milestone reached: “${after.title}”`,
        description: proj
          ? `Completed in ${proj.name}.`
          : "Milestone marked complete.",
        entityType: "project",
        entityId: after.projectId,
        metadata: {
          projectId: after.projectId,
          projectName: proj?.name ?? null,
          milestoneId: after.id,
          milestoneTitle: after.title,
        },
        dedupeKey: `milestone_completed:${after.id}:${stamp}`,
        sourceType: "milestone",
        sourceId: after.id,
      },
      now,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Google Calendar Event Reconciliation                                       */
/* -------------------------------------------------------------------------- */

export async function reconcileGoogleCalendarReminders(userId: string): Promise<void> {
  await ensureSchema();
  // Remove any queued quiet-hours calendar notifications whose event was deleted,
  // cancelled, moved to a different time, or belongs to a hidden calendar.
  const queued = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.entityType, "calendar_event"),
        eq(notifications.deliveryStatus, "queued_quiet_hours"),
      ),
    );

  if (queued.length) {
    for (const item of queued) {
      if (!item.entityId) continue;
      const [row] = await db
        .select({
          id: googleEvents.id,
          status: googleEvents.status,
          startAt: googleEvents.startAt,
          startDate: googleEvents.startDate,
          visible: googleCalendars.visible,
          selected: googleCalendars.selected,
        })
        .from(googleEvents)
        .leftJoin(
          googleCalendars,
          and(
            eq(googleCalendars.accountId, googleEvents.accountId),
            eq(googleCalendars.calendarId, googleEvents.calendarId),
          ),
        )
        .where(and(eq(googleEvents.id, item.entityId), eq(googleEvents.userId, userId)))
        .limit(1);

      const meta = (item.metadata ?? {}) as NotificationMetadata;
      const currentStartIso = row?.startAt ? row.startAt.toISOString() : row?.startDate ?? null;
      const stale =
        !row ||
        row.status !== "confirmed" ||
        row.visible === false ||
        row.selected === false ||
        (meta.eventStartAt && currentStartIso && meta.eventStartAt !== currentStartIso);

      if (stale) {
        await db.delete(notifications).where(eq(notifications.id, item.id));
        await db
          .update(reminderDeliveries)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(
            and(
              eq(reminderDeliveries.userId, userId),
              eq(reminderDeliveries.dedupeKey, item.dedupeKey),
            ),
          );
      }
    }
  }

  await processUserReminders(userId, { source: "calendar_sync" });
}

/* -------------------------------------------------------------------------- */
/* Scheduled & On-Demand Reminder Evaluation                                  */
/* -------------------------------------------------------------------------- */

export interface ProcessResult {
  userId: string;
  created: number;
  queued: number;
  released: number;
}

export async function processUserReminders(
  userId: string,
  options: { source?: string; now?: Date } = {},
): Promise<ProcessResult> {
  await ensureSchema();
  const now = options.now ?? new Date();
  lastUserCheck.set(userId, now.getTime());

  const prefs = await getOrCreatePreferences(userId);
  let created = 0;
  let queued = 0;
  const released = await releaseQuietHoursQueue(userId, prefs, now);

  if (!prefs.enabled) {
    if (options.source) await recordSchedulerRun(options.source, "ok", 0);
    return { userId, created: 0, queued: 0, released };
  }

  const userToday = getZonedParts(now, prefs.timezone).dateKey;

  const track = (res: { created: boolean; queued: boolean }) => {
    if (res.created) created++;
    if (res.queued) queued++;
  };

  // 1. Explicit per-task reminders (includes missed windows after downtime)
  const dueTaskReminders = await db
    .select({
      reminder: taskReminders,
      task: tasks,
      projectName: projects.name,
    })
    .from(taskReminders)
    .innerJoin(tasks, and(eq(tasks.id, taskReminders.taskId), isNull(tasks.deletedAt)))
    .leftJoin(projects, and(eq(projects.id, tasks.projectId), isNull(projects.deletedAt)))
    .where(
      and(
        eq(taskReminders.userId, userId),
        eq(taskReminders.enabled, true),
        eq(taskReminders.status, "pending"),
        lte(taskReminders.remindAt, now),
      ),
    );

  for (const { reminder, task, projectName } of dueTaskReminders) {
    if (task.completed || !reminder.remindAt) {
      await db
        .update(taskReminders)
        .set({ status: "cancelled", updatedAt: now })
        .where(eq(taskReminders.id, reminder.id));
      continue;
    }

    const timingLabel = REMINDER_TIMING_LABELS[(reminder.timing as ReminderTiming) || "at_due"];
    const dueSummary = task.dueDate
      ? `Due ${formatDate(task.dueDate)}${reminder.timing !== "custom" ? ` at ${reminder.dueTime}` : ""}`
      : `Scheduled for ${formatDateTimeInZone(reminder.remindAt, prefs.timezone)}`;

    const res = await deliverNotification(
      userId,
      prefs,
      {
        category: "task",
        type: "task_reminder",
        title: `Reminder: “${task.title}”`,
        description: `${projectName ? `${projectName} · ` : ""}${dueSummary} (${timingLabel.toLowerCase()}).`,
        entityType: "task",
        entityId: task.id,
        metadata: {
          projectId: task.projectId,
          projectName: projectName ?? null,
          taskTitle: task.title,
        },
        scheduledFor: reminder.remindAt,
        dedupeKey: `task_reminder:${task.id}:${reminder.remindAt.toISOString()}`,
        sourceType: "task_reminder",
        sourceId: reminder.id,
      },
      now,
    );
    track(res);

    await db
      .update(taskReminders)
      .set({ status: "delivered", deliveredAt: now, updatedAt: now })
      .where(eq(taskReminders.id, reminder.id));
  }

  // 2. Automatic task deadlines: overdue, due today, and upcoming (due tomorrow)
  const openTasks = await db
    .select({
      task: tasks,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, and(eq(projects.id, tasks.projectId), isNull(projects.deletedAt)))
    .where(and(eq(tasks.userId, userId), eq(tasks.completed, false), isNull(tasks.deletedAt)));

  for (const { task, projectName } of openTasks) {
    if (!task.dueDate) continue;
    const diff = calendarDaysDiff(userToday, task.dueDate);
    const prefix = projectName ? `${projectName} · ` : "";

    if (diff < 0) {
      const overdueDays = Math.abs(diff);
      const res = await deliverNotification(
        userId,
        prefs,
        {
          category: "deadline",
          type: "task_overdue",
          title: `Overdue: “${task.title}”`,
          description: `${prefix}Was due ${formatDate(task.dueDate)} (${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue).`,
          entityType: "task",
          entityId: task.id,
          metadata: {
            projectId: task.projectId,
            projectName: projectName ?? null,
            taskTitle: task.title,
            overdue: true,
          },
          dedupeKey: `task_overdue:${task.id}:${task.dueDate}`,
          sourceType: "task",
          sourceId: task.id,
        },
        now,
      );
      track(res);
    } else if (diff === 0) {
      const res = await deliverNotification(
        userId,
        prefs,
        {
          category: "deadline",
          type: "task_due_today",
          title: `Due today: “${task.title}”`,
          description: `${prefix}Scheduled for today (${formatDate(task.dueDate)}).`,
          entityType: "task",
          entityId: task.id,
          metadata: {
            projectId: task.projectId,
            projectName: projectName ?? null,
            taskTitle: task.title,
          },
          dedupeKey: `task_due_today:${task.id}:${task.dueDate}`,
          sourceType: "task",
          sourceId: task.id,
        },
        now,
      );
      track(res);
    } else if (diff === 1) {
      const res = await deliverNotification(
        userId,
        prefs,
        {
          category: "deadline",
          type: "task_upcoming_deadline",
          title: `Due tomorrow: “${task.title}”`,
          description: `${prefix}Upcoming deadline on ${formatDate(task.dueDate)}.`,
          entityType: "task",
          entityId: task.id,
          metadata: {
            projectId: task.projectId,
            projectName: projectName ?? null,
            taskTitle: task.title,
          },
          dedupeKey: `task_upcoming:${task.id}:${task.dueDate}`,
          sourceType: "task",
          sourceId: task.id,
        },
        now,
      );
      track(res);
    }
  }

  // 3. Project deadlines approaching (within 3 days)
  const userProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.archived, false), isNull(projects.deletedAt)));

  const projectMap = new Map(userProjects.map((p) => [p.id, p]));

  for (const project of userProjects) {
    if (!project.dueDate || project.status === "Completed" || project.status === "On hold") continue;
    const diff = calendarDaysDiff(userToday, project.dueDate);
    if (diff >= 0 && diff <= 3) {
      const whenLabel = diff === 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`;
      const bucket = diff === 0 ? "today" : "soon";
      const res = await deliverNotification(
        userId,
        prefs,
        {
          category: "deadline",
          type: "project_deadline",
          title: `Project deadline ${whenLabel}: “${project.name}”`,
          description: `Target completion date is ${formatDate(project.dueDate, { month: "short", day: "numeric" })} · currently ${statusLabel(project.status)}.`,
          entityType: "project",
          entityId: project.id,
          metadata: { projectId: project.id, projectName: project.name },
          dedupeKey: `project_deadline:${project.id}:${project.dueDate}:${bucket}`,
          sourceType: "project",
          sourceId: project.id,
        },
        now,
      );
      track(res);
    }
  }

  // 4. Project milestones approaching (within 2 days)
  const openMilestones = await db
    .select()
    .from(milestones)
    .where(and(eq(milestones.userId, userId), eq(milestones.completed, false), isNull(milestones.deletedAt)));

  for (const milestone of openMilestones) {
    if (!milestone.dueDate) continue;
    const parent = projectMap.get(milestone.projectId);
    if (!parent || parent.archived || parent.status === "Completed") continue;
    const diff = calendarDaysDiff(userToday, milestone.dueDate);
    if (diff >= 0 && diff <= 2) {
      const whenLabel = diff === 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`;
      const bucket = diff === 0 ? "today" : "soon";
      const res = await deliverNotification(
        userId,
        prefs,
        {
          category: "project",
          type: "milestone_approaching",
          title: `Milestone due ${whenLabel}: “${milestone.title}”`,
          description: `${parent.name} · target date ${formatDate(milestone.dueDate)}.`,
          entityType: "project",
          entityId: parent.id,
          metadata: {
            projectId: parent.id,
            projectName: parent.name,
            milestoneId: milestone.id,
            milestoneTitle: milestone.title,
          },
          dedupeKey: `milestone_approaching:${milestone.id}:${milestone.dueDate}:${bucket}`,
          sourceType: "milestone",
          sourceId: milestone.id,
        },
        now,
      );
      track(res);
    }
  }

  // 5. Google Calendar upcoming events & configurable reminder intervals
  const [account] = await db
    .select({ id: googleAccounts.id, revokedAt: googleAccounts.revokedAt })
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, userId))
    .limit(1);

  if (account && !account.revokedAt) {
    const windowFromDate = shiftDateKey(userToday, -1);
    const windowToDate = shiftDateKey(userToday, 3);
    const eventRows = await db
      .select({
        event: googleEvents,
        calVisible: googleCalendars.visible,
        calSelected: googleCalendars.selected,
        calSummary: googleCalendars.summary,
      })
      .from(googleEvents)
      .leftJoin(
        googleCalendars,
        and(
          eq(googleCalendars.accountId, googleEvents.accountId),
          eq(googleCalendars.calendarId, googleEvents.calendarId),
        ),
      )
      .where(
        and(
          eq(googleEvents.userId, userId),
          eq(googleEvents.accountId, account.id),
          eq(googleEvents.status, "confirmed"),
          sql`coalesce(${googleEvents.startDate}, to_char(${googleEvents.startAt}, 'YYYY-MM-DD')) >= ${windowFromDate}`,
          sql`coalesce(${googleEvents.startDate}, to_char(${googleEvents.startAt}, 'YYYY-MM-DD')) <= ${windowToDate}`,
        ),
      );

    const intervals = prefs.calendarReminderIntervals.length
      ? prefs.calendarReminderIntervals
      : [30];

    for (const { event, calVisible, calSelected, calSummary } of eventRows) {
      // Respect user's selected/visible Google Calendars.
      if (calVisible === false || calSelected === false) continue;

      const eventZone = safeTimezone(event.timezone || prefs.timezone);
      const displayZone = prefs.timezone;
      const startInstant = event.allDay
        ? event.startDate
          ? localDateTimeToUtc(event.startDate, prefs.defaultDueTime || "09:00", eventZone)
          : null
        : event.startAt;
      if (!startInstant) continue;

      const endInstant = event.allDay
        ? event.endDate
          ? localDateTimeToUtc(event.endDate, "00:00", eventZone)
          : new Date(startInstant.getTime() + 86_400_000)
        : event.endAt ?? new Date(startInstant.getTime() + 3600_000);

      // Ignore historical events that already ended more than 2 hours ago.
      if (endInstant && endInstant.getTime() < now.getTime() - 2 * 3600_000) continue;

      const eventDateKey = event.allDay
        ? event.startDate ?? getZonedParts(startInstant, displayZone).dateKey
        : getZonedParts(startInstant, displayZone).dateKey;

      const titleText = event.title?.trim() || "(Untitled event)";
      const whenFormatted = event.allDay
        ? `${formatDate(eventDateKey, { weekday: "short", month: "short", day: "numeric" })} · All day`
        : `${formatDateTimeInZone(startInstant, displayZone, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}${
            event.endAt
              ? ` – ${formatDateTimeInZone(event.endAt, displayZone, {
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : ""
          }`;
      const calLabel = calSummary ? `${calSummary} · ` : "Google Calendar · ";
      const startSig = event.allDay ? `allday:${eventDateKey}` : startInstant.toISOString();

      // 5a. Upcoming event heads-up (events happening today or within 24h)
      const msUntilStart = startInstant.getTime() - now.getTime();
      if (msUntilStart > 0 && msUntilStart <= 24 * 3600_000) {
        const res = await deliverNotification(
          userId,
          prefs,
          {
            category: "calendar",
            type: "calendar_upcoming",
            title: `Upcoming event: ${titleText}`,
            description: `${calLabel}${whenFormatted}`,
            entityType: "calendar_event",
            entityId: event.id,
            metadata: {
              eventDate: eventDateKey,
              eventStartAt: startSig,
              eventAllDay: event.allDay,
              calendarSummary: calSummary ?? "Google Calendar",
            },
            scheduledFor: startInstant,
            dedupeKey: `gcal_upcoming:${event.id}:${startSig}`,
            sourceType: "google_event",
            sourceId: event.id,
          },
          now,
        );
        track(res);
      }

      // 5b. Configurable reminder intervals (supports missed windows up to 12h after downtime)
      for (const minutes of intervals) {
        const triggerAt = new Date(startInstant.getTime() - minutes * 60_000);
        if (
          triggerAt.getTime() <= now.getTime() &&
          now.getTime() - triggerAt.getTime() <= 12 * 3600_000
        ) {
          const intervalText = formatCalendarInterval(minutes);
          const res = await deliverNotification(
            userId,
            prefs,
            {
              category: "calendar",
              type: "calendar_reminder",
              title:
                minutes === 0
                  ? `Starting now: ${titleText}`
                  : `Event reminder (${intervalText.toLowerCase()}): ${titleText}`,
              description: `${calLabel}${whenFormatted}`,
              entityType: "calendar_event",
              entityId: event.id,
              metadata: {
                eventDate: eventDateKey,
                eventStartAt: startSig,
                eventAllDay: event.allDay,
                calendarSummary: calSummary ?? "Google Calendar",
              },
              scheduledFor: triggerAt,
              dedupeKey: `gcal_rem:${event.id}:${startSig}:${minutes}m`,
              sourceType: "google_event",
              sourceId: event.id,
            },
            now,
          );
          track(res);
        }
      }
    }
  }

  if (options.source) {
    await recordSchedulerRun(options.source, "ok", created + released);
  }

  return { userId, created, queued, released };
}

/**
 * Throttled check used on read endpoints so opening or polling Folio keeps
 * reminders fresh without hammering PostgreSQL on rapid requests.
 */
export async function maybeProcessUserReminders(
  userId: string,
  minIntervalMs = 30_000,
): Promise<void> {
  const prev = lastUserCheck.get(userId) ?? 0;
  if (Date.now() - prev < minIntervalMs) return;
  lastUserCheck.set(userId, Date.now());
  try {
    await processUserReminders(userId);
  } catch (error) {
    console.error("Background user reminder check failed:", error);
  }
}

/**
 * Advisory-locked global reminder processor for scheduled HTTP cron execution.
 * Safe to invoke concurrently across serverless instances.
 */
export async function processAllUsersReminders(
  source: "cron" | "manual" = "cron",
): Promise<{
  skippedLocked: boolean;
  usersProcessed: number;
  created: number;
  queued: number;
  released: number;
}> {
  await ensureSchema();
  const client = await pool.connect();
  try {
    const lockRes = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [PROCESSOR_LOCK_KEY],
    );
    if (!lockRes.rows[0]?.locked) {
      return { skippedLocked: true, usersProcessed: 0, created: 0, queued: 0, released: 0 };
    }
    try {
      const allUsers = await db.select({ id: users.id }).from(users).orderBy(desc(users.createdAt));
      let totalCreated = 0;
      let totalQueued = 0;
      let totalReleased = 0;

      for (const u of allUsers) {
        // Best-effort incremental Google Calendar sync during background cron runs
        // so new/updated calendar events trigger reminders even while Folio is closed.
        const [acct] = await db
          .select({ id: googleAccounts.id, revokedAt: googleAccounts.revokedAt, lastSyncAt: googleAccounts.lastSyncAt })
          .from(googleAccounts)
          .where(eq(googleAccounts.userId, u.id))
          .limit(1);
        if (
          acct &&
          !acct.revokedAt &&
          (!acct.lastSyncAt || Date.now() - acct.lastSyncAt.getTime() > 5 * 60_000)
        ) {
          try {
            const { googleConfig } = await import("@/lib/google");
            if (googleConfig().configured) {
              const { syncAccount } = await import("@/lib/calendar-sync");
              await syncAccount(u.id, { full: false });
            }
          } catch {
            // Transient Google network/auth failure must not block Folio reminders.
          }
        }

        const res = await processUserReminders(u.id);
        totalCreated += res.created;
        totalQueued += res.queued;
        totalReleased += res.released;
      }

      await recordSchedulerRun(source, "ok", totalCreated + totalReleased);
      return {
        skippedLocked: false,
        usersProcessed: allUsers.length,
        created: totalCreated,
        queued: totalQueued,
        released: totalReleased,
      };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [PROCESSOR_LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}
