import { localDateTimeToUtc, parseCustomLocalToUtc, safeTimezone } from "@/lib/timezone";

export type NotificationCategory = "task" | "project" | "deadline" | "calendar" | "system";

export type NotificationEntityType = "task" | "project" | "milestone" | "calendar_event" | "settings";

export type NotificationType =
  | "task_reminder"
  | "task_due_today"
  | "task_upcoming_deadline"
  | "task_overdue"
  | "project_deadline"
  | "project_status_changed"
  | "project_updated"
  | "milestone_approaching"
  | "milestone_completed"
  | "calendar_upcoming"
  | "calendar_reminder"
  | "system_info";

export type ReminderTiming =
  | "at_due"
  | "15m_before"
  | "30m_before"
  | "1h_before"
  | "1d_before"
  | "custom";

export type DefaultReminderTiming = "none" | Exclude<ReminderTiming, "custom">;

export type ReminderDeliveryStatus = "pending" | "delivered" | "cancelled";

export const REMINDER_TIMINGS: ReminderTiming[] = [
  "at_due",
  "15m_before",
  "30m_before",
  "1h_before",
  "1d_before",
  "custom",
];

export const DEFAULT_REMINDER_TIMINGS: DefaultReminderTiming[] = [
  "none",
  "at_due",
  "15m_before",
  "30m_before",
  "1h_before",
  "1d_before",
];

export const REMINDER_TIMING_LABELS: Record<ReminderTiming, string> = {
  at_due: "At the due time",
  "15m_before": "15 minutes before",
  "30m_before": "30 minutes before",
  "1h_before": "1 hour before",
  "1d_before": "1 day before",
  custom: "Custom date & time",
};

export const DEFAULT_TIMING_LABELS: Record<DefaultReminderTiming, string> = {
  none: "No automatic reminder",
  ...{
    at_due: "At the due time",
    "15m_before": "15 minutes before",
    "30m_before": "30 minutes before",
    "1h_before": "1 hour before",
    "1d_before": "1 day before",
  },
};

export const REMINDER_OFFSET_MINUTES: Record<Exclude<ReminderTiming, "custom">, number> = {
  at_due: 0,
  "15m_before": 15,
  "30m_before": 30,
  "1h_before": 60,
  "1d_before": 1440,
};

export const CALENDAR_INTERVAL_OPTIONS: { minutes: number; label: string; shortLabel: string }[] = [
  { minutes: 0, label: "At event start", shortLabel: "At start" },
  { minutes: 10, label: "10 minutes before", shortLabel: "10m before" },
  { minutes: 15, label: "15 minutes before", shortLabel: "15m before" },
  { minutes: 30, label: "30 minutes before", shortLabel: "30m before" },
  { minutes: 60, label: "1 hour before", shortLabel: "1h before" },
  { minutes: 120, label: "2 hours before", shortLabel: "2h before" },
  { minutes: 1440, label: "1 day before", shortLabel: "1d before" },
];

export const ALLOWED_CALENDAR_INTERVALS = CALENDAR_INTERVAL_OPTIONS.map((o) => o.minutes);

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "task",
  "project",
  "deadline",
  "calendar",
  "system",
];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  task: "Task",
  project: "Project",
  deadline: "Deadline",
  calendar: "Calendar",
  system: "Account",
};

export interface NotificationMetadata {
  projectId?: string | null;
  projectName?: string | null;
  taskTitle?: string | null;
  milestoneId?: string | null;
  milestoneTitle?: string | null;
  eventDate?: string | null;
  eventStartAt?: string | null;
  eventAllDay?: boolean;
  calendarSummary?: string | null;
  overdue?: boolean;
  systemKind?: "welcome" | "security" | "verification" | "integration";
  actionLabel?: string | null;
}

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  description: string;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  metadata: NotificationMetadata | null;
  read: boolean;
  readAt: string | null;
  scheduledFor: string | null;
  deliveredAt: string | null;
  deliveryStatus: string;
  createdAt: string;
}

export interface TaskReminderConfig {
  id: string;
  taskId: string;
  enabled: boolean;
  timing: ReminderTiming;
  dueTime: string;
  customLocal: string | null;
  customAt: string | null;
  remindAt: string | null;
  status: ReminderDeliveryStatus;
  deliveredAt: string | null;
  updatedAt: string;
}

export interface TaskReminderDraft {
  enabled: boolean;
  timing: ReminderTiming;
  dueTime: string;
  customLocal: string | null;
}

export interface NotificationPreferencesData {
  enabled: boolean;
  defaultReminderTiming: DefaultReminderTiming;
  defaultDueTime: string;
  timezone: string;
  timezoneAutoDetected: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  categoryTask: boolean;
  categoryProject: boolean;
  categoryDeadline: boolean;
  categoryCalendar: boolean;
  categorySystem: boolean;
  taskUpcomingDeadlines: boolean;
  taskOverdue: boolean;
  taskReminders: boolean;
  projectDeadlines: boolean;
  milestoneReminders: boolean;
  projectUpdates: boolean;
  calendarUpcomingEvents: boolean;
  calendarEventReminders: boolean;
  calendarReminderIntervals: number[];
}

export interface SchedulerTelemetry {
  cronConfigured: boolean;
  lastRunAt: string | null;
  lastRunSource: string | null;
  lastCronRunAt: string | null;
  lastRunStatus: string;
  lastCreatedCount: number;
  quietHoursActiveNow: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesData = {
  enabled: true,
  defaultReminderTiming: "1h_before",
  defaultDueTime: "09:00",
  timezone: "UTC",
  timezoneAutoDetected: false,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  categoryTask: true,
  categoryProject: true,
  categoryDeadline: true,
  categoryCalendar: true,
  categorySystem: true,
  taskUpcomingDeadlines: true,
  taskOverdue: true,
  taskReminders: true,
  projectDeadlines: true,
  milestoneReminders: true,
  projectUpdates: true,
  calendarUpcomingEvents: true,
  calendarEventReminders: true,
  calendarReminderIntervals: [15, 60],
};

/**
 * Computes the UTC trigger timestamp for a task reminder in the user's IANA timezone.
 */
export function computeTaskRemindAt(options: {
  dueDate: string | null | undefined;
  timing: ReminderTiming;
  dueTime: string;
  customLocal?: string | null;
  timezone: string;
}): Date | null {
  const zone = safeTimezone(options.timezone);
  if (options.timing === "custom") {
    if (!options.customLocal) return null;
    return parseCustomLocalToUtc(options.customLocal, zone);
  }
  if (!options.dueDate) return null;
  const dueAnchor = localDateTimeToUtc(options.dueDate.slice(0, 10), options.dueTime || "09:00", zone);
  if (!dueAnchor) return null;
  const offsetMinutes = REMINDER_OFFSET_MINUTES[options.timing] ?? 0;
  return new Date(dueAnchor.getTime() - offsetMinutes * 60_000);
}

export function formatCalendarInterval(minutes: number): string {
  const found = CALENDAR_INTERVAL_OPTIONS.find((opt) => opt.minutes === minutes);
  if (found) return found.label;
  if (minutes === 0) return "At event start";
  if (minutes < 60) return `${minutes} minutes before`;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"} before`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"} before`;
  }
  return `${minutes} minutes before`;
}
