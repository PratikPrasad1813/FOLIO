import type { PersonalPreferences } from "@/lib/personalization";
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, date, index, uniqueIndex, check, foreignKey } from "drizzle-orm/pg-core";

export const users = pgTable("folio_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  provider: text("provider").notNull().default("email"),
  weeklyGoal: integer("weekly_goal").notNull().default(12),
  // Neon Managed Better Auth identity (neon_auth."user".id). Text rather than a
  // foreign key: the neon_auth schema is owned and migrated by Neon, not by
  // Folio's Drizzle migrations, so no cross-schema FK is declared here.
  authUserId: text("auth_user_id"),
  personal: jsonb("personal").$type<Partial<PersonalPreferences>>().notNull().default({}),
  onboardingStep: integer("onboarding_step").notNull().default(0),
  onboardingVersion: integer("onboarding_version").notNull().default(1),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  welcomeEmailSentAt: timestamp("welcome_email_sent_at", { withTimezone: true }),
  guideDismissedAt: timestamp("guide_dismissed_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // One Folio profile per Neon Auth identity. A plain unique index rather than a
  // cross-schema foreign key: neon_auth is owned and migrated by Neon.
  uniqueIndex("folio_users_auth_user_id_idx").on(table.authUserId),
]);

export const sessions = pgTable("folio_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
});

export const projects = pgTable("folio_projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("Planning"),
  priority: text("priority").notNull().default("Medium"),
  color: text("color").notNull().default("violet"),
  icon: text("icon").notNull().default("layout"),
  category: text("category").notNull().default("Personal"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  favorite: boolean("favorite").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("folio_projects_user_idx").on(table.userId),
  index("folio_projects_filter_idx").on(table.userId, table.archived, table.status, table.dueDate),
  index("folio_projects_search_idx").using("gin", sql`to_tsvector('simple', ${table.name} || ' ' || ${table.description} || ' ' || ${table.category})`),
]);

// Milestones split a project into meaningful checkpoints. Tasks can optionally
// belong to one, which is what drives each milestone's progress indicator.
export const milestones = pgTable("folio_milestones", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  dueDate: text("due_date"),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("folio_milestones_user_idx").on(table.userId),
  index("folio_milestones_project_idx").on(table.projectId),
]);

export const tasks = pgTable("folio_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // Workflow status: todo | in_progress | in_review | done. `completed` is kept
  // in sync (completed ⇔ status = 'done') so existing readers keep working.
  status: text("status").notNull().default("todo"),
  completed: boolean("completed").notNull().default(false),
  // Urgent | High | Medium | Low | None (the original three values remain valid).
  priority: text("priority").notNull().default("Medium"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  // No DB default on purpose (drizzle-kit mis-compares array defaults on every push);
  // every insert sets labels explicitly, and the migration backfills existing rows.
  labels: text("labels").array().notNull(),
  estimateMinutes: integer("estimate_minutes"),
  notes: text("notes").notNull().default(""),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("folio_tasks_user_idx").on(table.userId),
  index("folio_tasks_filter_idx").on(table.userId, table.status, table.dueDate),
  index("folio_tasks_project_progress_idx").on(table.userId, table.projectId, table.completed),
  index("folio_tasks_search_idx").using("gin", sql`to_tsvector('simple', ${table.title} || ' ' || ${table.description} || ' ' || ${table.notes})`),
]);

// Subtasks break a task into small, checkable steps. They belong to exactly one
// task and disappear with it.
export const subtasks = pgTable("folio_subtasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("folio_subtasks_user_idx").on(table.userId),
  index("folio_subtasks_task_idx").on(table.taskId),
]);

// --- Google Calendar integration -----------------------------------------
// One Google account per Folio user. Tokens are encrypted at rest with
// AES-256-GCM (see src/lib/crypto.ts) and are never sent to the browser.
export const googleAccounts = pgTable("folio_google_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  googleUserId: text("google_user_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  picture: text("picture"),
  // OAuth credentials, encrypted. The refresh token is the long-lived secret.
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessTokenEnc: text("access_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  scopes: text("scopes").array().notNull().default([]),
  // Write access is a separate, incrementally-granted scope (calendar.events).
  writeEnabled: boolean("write_enabled").notNull().default(false),
  connectionError: text("connection_error"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status").notNull().default("never"),
  lastSyncDetail: jsonb("last_sync_detail"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [uniqueIndex("folio_google_accounts_user_idx").on(table.userId)]);

// Per-calendar sync state: which calendars Folio reads, and how far it has caught up.
export const googleCalendars = pgTable("folio_google_calendars", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => googleAccounts.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  calendarId: text("calendar_id").notNull(),
  summary: text("summary").notNull().default(""),
  description: text("description").notNull().default(""),
  backgroundColor: text("background_color"),
  primary: boolean("primary").notNull().default(false),
  // `selected` mirrors Google's own calendar-list flag; `visible` is Folio's display toggle.
  selected: boolean("selected").notNull().default(true),
  visible: boolean("visible").notNull().default(true),
  syncToken: text("sync_token"),
  lastSyncedAt: timestamp("last_synced_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("folio_google_calendars_unique_idx").on(table.accountId, table.calendarId),
  index("folio_google_calendars_user_idx").on(table.userId),
]);

// Mirror of Google events, plus the stable link to a Folio task.
export const googleEvents = pgTable("folio_google_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => googleAccounts.id, { onDelete: "cascade" }),
  calendarId: text("calendar_id").notNull(),
  googleEventId: text("google_event_id").notNull(),
  recurringEventId: text("recurring_event_id"),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  location: text("location").notNull().default(""),
  startAt: timestamp("start_at"),
  endAt: timestamp("end_at"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  allDay: boolean("all_day").notNull().default(false),
  timezone: text("timezone"),
  status: text("status").notNull().default("confirmed"),
  htmlLink: text("html_link"),
  organizer: text("organizer"),
  attendees: integer("attendees").notNull().default(0),
  etag: text("etag"),
  googleUpdatedAt: timestamp("google_updated_at"),
  // Set while Folio holds an unpushed edit, so a later sync can detect a conflict
  // instead of silently overwriting either side.
  localDirty: boolean("local_dirty").notNull().default(false),
  localUpdatedAt: timestamp("local_updated_at"),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Guarantees one mirror row per Google event: the idempotency key for sync.
  uniqueIndex("folio_google_events_unique_idx").on(table.accountId, table.googleEventId),
  index("folio_google_events_user_idx").on(table.userId),
  index("folio_google_events_task_idx").on(table.taskId),
  index("folio_google_events_start_idx").on(table.startAt),
]);

export const ideas = pgTable("folio_ideas", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("Personal"),
  color: text("color").notNull().default("yellow"),
  status: text("status").notNull().default("Just an idea"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("folio_ideas_user_idx").on(table.userId),
  index("folio_ideas_search_idx").using("gin", sql`to_tsvector('simple', ${table.title} || ' ' || ${table.description} || ' ' || ${table.category})`),
]);

export const activities = pgTable("folio_activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Project-scoped events keep a link so each project has its own history.
  // When a project is deleted the event survives in the global feed.
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  // Task-scoped events power each task's history in the details panel.
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  type: text("type").notNull().default("project"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("folio_activities_user_idx").on(table.userId),
  index("folio_activities_project_idx").on(table.projectId),
  index("folio_activities_task_idx").on(table.taskId),
]);

// --- Notifications & Reminders (Folio 2.0) --------------------------------

export const taskReminders = pgTable("folio_task_reminders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  // at_due | 15m_before | 30m_before | 1h_before | 1d_before | custom
  timing: text("timing").notNull().default("1h_before"),
  // Local HH:MM anchor for due-date relative reminders (e.g. "09:00").
  dueTime: text("due_time").notNull().default("09:00"),
  // Preserves exact YYYY-MM-DDTHH:mm local input when timing = 'custom'.
  customLocal: text("custom_local"),
  customAt: timestamp("custom_at"),
  remindAt: timestamp("remind_at"),
  // pending | delivered | cancelled
  status: text("status").notNull().default("pending"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("folio_task_reminders_task_idx").on(table.taskId),
  index("folio_task_reminders_user_idx").on(table.userId),
  index("folio_task_reminders_due_idx").on(table.status, table.remindAt),
]);

export const notificationPreferences = pgTable("folio_notification_prefs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  // none | at_due | 15m_before | 30m_before | 1h_before | 1d_before
  defaultReminderTiming: text("default_reminder_timing").notNull().default("1h_before"),
  defaultDueTime: text("default_due_time").notNull().default("09:00"),
  timezone: text("timezone").notNull().default("UTC"),
  timezoneAutoDetected: boolean("timezone_auto_detected").notNull().default(false),
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(false),
  quietHoursStart: text("quiet_hours_start").notNull().default("22:00"),
  quietHoursEnd: text("quiet_hours_end").notNull().default("08:00"),
  // Category master switches
  categoryTask: boolean("category_task").notNull().default(true),
  categoryProject: boolean("category_project").notNull().default(true),
  categoryDeadline: boolean("category_deadline").notNull().default(true),
  categoryCalendar: boolean("category_calendar").notNull().default(true),
  categorySystem: boolean("category_system").notNull().default(true),
  // Granular toggles
  taskUpcomingDeadlines: boolean("task_upcoming_deadlines").notNull().default(true),
  taskOverdue: boolean("task_overdue").notNull().default(true),
  taskReminders: boolean("task_reminders").notNull().default(true),
  projectDeadlines: boolean("project_deadlines").notNull().default(true),
  milestoneReminders: boolean("milestone_reminders").notNull().default(true),
  projectUpdates: boolean("project_updates").notNull().default(true),
  calendarUpcomingEvents: boolean("calendar_upcoming_events").notNull().default(true),
  calendarEventReminders: boolean("calendar_event_reminders").notNull().default(true),
  // No DB default on purpose (drizzle-kit mis-compares array defaults on push).
  calendarReminderIntervals: integer("calendar_reminder_intervals").array().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("folio_notification_prefs_user_idx").on(table.userId),
]);

export const notifications = pgTable("folio_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // task | project | deadline | calendar | system
  category: text("category").notNull().default("task"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // task | project | milestone | calendar_event | settings | null
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  read: boolean("read").notNull().default(false),
  readAt: timestamp("read_at"),
  scheduledFor: timestamp("scheduled_for"),
  deliveredAt: timestamp("delivered_at"),
  // delivered | queued_quiet_hours | cancelled
  deliveryStatus: text("delivery_status").notNull().default("delivered"),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("folio_notifications_user_dedupe_idx").on(table.userId, table.dedupeKey),
  index("folio_notifications_user_created_idx").on(table.userId, table.createdAt),
  index("folio_notifications_user_read_idx").on(table.userId, table.read, table.deliveryStatus),
  index("folio_notifications_entity_idx").on(table.userId, table.entityType, table.entityId),
]);

// Persists delivery history independently of the inbox so deleting or clearing
// notifications never causes the same reminder occurrence to fire a second time.
export const reminderDeliveries = pgTable("folio_reminder_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dedupeKey: text("dedupe_key").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  reminderType: text("reminder_type").notNull(),
  scheduledFor: timestamp("scheduled_for"),
  // delivered | queued_quiet_hours | cancelled
  status: text("status").notNull().default("delivered"),
  notifId: uuid("notif_id").references(() => notifications.id, { onDelete: "set null" }),
  deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("folio_reminder_deliveries_unique_idx").on(table.userId, table.dedupeKey),
  index("folio_reminder_deliveries_source_idx").on(table.userId, table.sourceType, table.sourceId),
]);

export const schedulerRuns = pgTable("folio_scheduler_runs", {
  id: text("id").primaryKey(),
  lastRunAt: timestamp("last_run_at"),
  lastRunSource: text("last_run_source"),
  lastCronRunAt: timestamp("last_cron_run_at"),
  lastRunStatus: text("last_run_status").notNull().default("never"),
  lastCreatedCount: integer("last_created_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Additive search tables; existing workspace records are never rewritten.
export const recentSearches = pgTable("folio_recent_searches", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  queryKey: text("query_key").notNull(),
  scope: text("scope").notNull().default("all"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("folio_recent_searches_unique_idx").on(t.userId, t.queryKey, t.scope),
  index("folio_recent_searches_recent_idx").on(t.userId, t.lastUsedAt),
]);

export const savedFilters = pgTable("folio_saved_filters", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  config: jsonb("config").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("folio_saved_filters_unique_idx").on(t.userId, t.kind, t.nameKey)]);

// Only aggregate usage metadata is stored. Prompts and generated content never
// leave the browser and never enter these account-level daily counters.
export const folioAiDailyUsage = pgTable("folio_ai_daily_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  usageDate: date("usage_date", { mode: "string" }).notNull(),
  completedMessageCount: integer("completed_message_count").notNull().default(0),
  reservedMessageCount: integer("reserved_message_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("folio_ai_daily_usage_user_date_idx").on(t.userId, t.usageDate),
  index("folio_ai_daily_usage_date_idx").on(t.usageDate),
  check("folio_ai_daily_usage_counts_nonnegative_chk", sql`${t.completedMessageCount} >= 0 AND ${t.reservedMessageCount} >= 0`),
]);

// A reservation holds one of the 50 daily slots while inference runs locally.
// A generation UUID makes both reservation and completion idempotent across
// retries/tabs. No prompt or response body is stored.
export const folioAiUsageReservations = pgTable("folio_ai_usage_reservations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  generationId: uuid("generation_id").notNull(),
  usageDate: date("usage_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("reserved"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("folio_ai_reservations_user_generation_idx").on(t.userId, t.generationId),
  index("folio_ai_reservations_expiry_idx").on(t.userId, t.status, t.expiresAt),
  index("folio_ai_reservations_user_date_idx").on(t.userId, t.usageDate),
  check("folio_ai_reservations_status_chk", sql`${t.status} in ('reserved', 'completed', 'failed', 'cancelled', 'expired')`),
]);

// Personalized assistant identity and model preference, stored per authenticated
// Folio account. No conversation content is ever stored here.
export const folioAiPreferences = pgTable("folio_ai_preferences", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assistantName: text("assistant_name").notNull().default("Folio AI"),
  presentation: text("presentation").notNull().default("neutral"),
  style: text("style").notNull().default("friendly"),
  modelPreference: text("model_preference").notNull().default("automatic"),
  selectedModelId: text("selected_model_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("folio_ai_preferences_user_idx").on(t.userId),
  check("folio_ai_preferences_presentation_chk", sql`${t.presentation} in ('feminine', 'masculine', 'neutral', 'custom')`),
  check("folio_ai_preferences_style_chk", sql`${t.style} in ('professional', 'friendly', 'concise', 'motivational', 'calm')`),
  check("folio_ai_preferences_model_chk", sql`${t.modelPreference} in ('automatic', 'lightweight', 'balanced', 'high')`),
]);

// Persistent AI conversation history, scoped to the owning Folio user. Message
// content is the user's own prompt/response; no credentials or tokens are stored.
export const folioAiConversations = pgTable("folio_ai_conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New conversation"),
  messageCount: integer("message_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("folio_ai_conversations_user_idx").on(t.userId, t.lastMessageAt),
]);

export const folioAiMessages = pgTable("folio_ai_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => folioAiConversations.id, { onDelete: "cascade" }),
  // user | assistant
  role: text("role").notNull(),
  content: text("content").notNull(),
  // Idempotency key for a generation: prevents duplicate messages on retry.
  generationId: text("generation_id"),
  // complete | cancelled | error
  generationStatus: text("generation_status"),
  // Approved action plan and its execution results, when the reply carried one.
  plan: jsonb("plan"),
  results: jsonb("results"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("folio_ai_messages_conversation_idx").on(t.conversationId, t.createdAt),
  index("folio_ai_messages_user_idx").on(t.userId, t.createdAt),
  uniqueIndex("folio_ai_messages_generation_idx").on(t.userId, t.generationId),
  check("folio_ai_messages_role_chk", sql`${t.role} in ('user', 'assistant')`),
  check("folio_ai_messages_status_chk", sql`${t.generationStatus} is null or ${t.generationStatus} in ('complete', 'cancelled', 'error')`),
]);

// Persistent AI task execution state, heartbeats, intermediate partial output,
// and final results. Scoped strictly to the owning Folio user.
export const folioAiTasks = pgTable("folio_ai_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => folioAiConversations.id, { onDelete: "cascade" }),
  generationId: uuid("generation_id").notNull(),
  reservationId: uuid("reservation_id").references(() => folioAiUsageReservations.id, { onDelete: "set null" }),
  userMessageId: uuid("user_message_id"),
  assistantMessageId: uuid("assistant_message_id"),
  prompt: text("prompt").notNull(),
  modelId: text("model_id").notNull(),
  // queued | running | waiting | completed | failed | cancelled
  status: text("status").notNull().default("queued"),
  stage: text("stage").notNull().default("Queued"),
  partialContent: text("partial_content").notNull().default(""),
  tokenCount: integer("token_count").notNull().default(0),
  plan: jsonb("plan"),
  results: jsonb("results"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("folio_ai_tasks_user_generation_idx").on(t.userId, t.generationId),
  index("folio_ai_tasks_conversation_idx").on(t.conversationId, t.createdAt),
  index("folio_ai_tasks_user_status_idx").on(t.userId, t.status, t.heartbeatAt),
  check("folio_ai_tasks_status_chk", sql`${t.status} in ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')`),
]);

// Stable provider identities, separate from Calendar OAuth credentials.
export const authIdentities = pgTable("folio_auth_identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  subject: text("subject").notNull(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("folio_auth_identity_subject_idx").on(t.provider, t.subject), uniqueIndex("folio_auth_identity_user_idx").on(t.userId, t.provider)]);

// Single-use, ten-minute OAuth transactions survive serverless cold starts.
export const authFlows = pgTable("folio_auth_flows", {
  stateHash: text("state_hash").primaryKey(),
  browserHash: text("browser_hash").notNull(),
  provider: text("provider").notNull(),
  verifierEnc: text("verifier_enc").notNull(),
  returnTo: text("return_to").notNull(),
  desktop: boolean("desktop").notNull().default(false),
  linkUserId: uuid("link_user_id").references(() => users.id, { onDelete: "cascade" }),
  linkSessionHash: text("link_session_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("folio_auth_flows_expiry_idx").on(t.expiresAt)]);

export const desktopAuthHandoffs = pgTable("folio_desktop_auth_handoffs", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  destination: text("destination").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("folio_desktop_auth_handoffs_expiry_idx").on(t.expiresAt)]);

export const authRateLimits = pgTable("folio_auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, t => [index("folio_auth_rate_reset_idx").on(t.resetAt)]);

// One-time recovery links are hashed; neither passwords nor tokens are emailed to the database.
export const passwordResets = pgTable("folio_password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  foreignKey({ name: "folio_password_resets_user_id_fkey", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  index("folio_password_resets_user_idx").on(t.userId),
]);

// One-time email verification links (24h expiry), stored only as SHA-256 hashes.
export const emailVerifications = pgTable("folio_email_verifications", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  foreignKey({ name: "folio_email_verifications_user_id_fkey", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  index("folio_email_verifications_user_idx").on(t.userId),
]);
