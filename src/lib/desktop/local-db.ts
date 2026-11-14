/**
 * Folio local SQLite database layer (desktop only).
 *
 * The desktop shell mirrors the user's workspace in `folio.db` (stored in the
 * OS app-config directory by the Tauri SQL plugin) so every read is a 0ms
 * local operation and the app is fully usable offline.
 *
 * Layout:
 *   local_projects / local_tasks / local_milestones / local_subtasks /
 *   local_ideas   — snake_case mirrors of the cloud Neon tables.
 *   sync_queue    — the Outbox Mutation Queue. Every local mutation appends
 *                   { entity_type, entity_id, operation, payload, updated_at }
 *                   here; the sync engine drains it to /api/sync/push.
 *   sync_metadata — key/value store for last_pulled_at, the auth token, the
 *                   cached user profile and the activity feed snapshot.
 *
 * Soft-delete discipline (this is where the previous attempt broke):
 *   - Active rows ALWAYS hold SQL NULL in `deleted_at`.
 *   - The literal strings "null"/"undefined" never reach the database —
 *     `normaliseTimestamp` coerces them to real NULL.
 *   - Every "active rows" query filters `WHERE (deleted_at IS NULL OR deleted_at = '')`.
 *   - Tombstones arriving from the cloud are removed outright from the local
 *     tables (the cloud row remains as the authoritative tombstone).
 */

import Database from "@tauri-apps/plugin-sql";
import type { PersonalPreferences } from "@/lib/personalization";
import type {
  Idea,
  Milestone,
  Project,
  Subtask,
  Task,
  User,
  Activity,
  WorkspaceData,
} from "@/lib/types";
import {
  boundedInt,
  boundedText,
  isNullish,
  oneOf,
  optionalDay,
  parseLabels,
  toBoolean,
  toSqlNull,
  IDEA_STATUS_VALUES,
  PROJECT_COLOR_VALUES,
  PROJECT_ICON_VALUES,
  PROJECT_PRIORITY_VALUES,
  PROJECT_STATUS_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  parseIsoTimestamp,
  type IdeaSyncRow,
  type MilestoneSyncRow,
  type ProjectSyncRow,
  type SubtaskSyncRow,
  type SyncEntityRow,
  type SyncEntityType,
  type SyncMutation,
  type SyncOperation,
  type TaskSyncRow,
} from "@/lib/sync-protocol";

export const LOCAL_DB_CONNECTION = "sqlite:folio.db";
export const LOCAL_SCHEMA_VERSION = 1;

/**
 * Metadata keys persisted in sync_metadata.
 *
 * Auth tokens deliberately do NOT live here — the `local_auth` table (see
 * auth-store.ts) owns the session, profile snapshot and Bearer token.
 */
export const META_KEYS = {
  schemaVersion: "schema_version",
  lastPulledAt: "last_pulled_at",
  lastPushedAt: "last_pushed_at",
  userId: "user_id",
  profile: "profile_snapshot",
  activities: "activities_snapshot",
  /** "1" while a local profile/settings change still needs a cloud push. */
  profileDirty: "profile_dirty",
  /** JSON snapshot of the locally-edited profile awaiting its cloud push. */
  profilePending: "profile_pending",
} as const;

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS local_projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Planning',
    priority TEXT NOT NULL DEFAULT 'Medium',
    color TEXT NOT NULL DEFAULT 'violet',
    icon TEXT NOT NULL DEFAULT 'layout',
    category TEXT NOT NULL DEFAULT 'Personal',
    start_date TEXT,
    due_date TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS local_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT,
    milestone_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    completed INTEGER NOT NULL DEFAULT 0,
    priority TEXT NOT NULL DEFAULT 'Medium',
    start_date TEXT,
    due_date TEXT,
    labels TEXT NOT NULL DEFAULT '[]',
    estimate_minutes INTEGER,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS local_milestones (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS local_subtasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS local_ideas (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Personal',
    color TEXT NOT NULL DEFAULT 'yellow',
    status TEXT NOT NULL DEFAULT 'Just an idea',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    queued_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS local_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_id TEXT NOT NULL,
    user_json TEXT NOT NULL,
    token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS local_projects_user_idx ON local_projects (user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS local_tasks_user_idx ON local_tasks (user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS local_milestones_project_idx ON local_milestones (project_id)`,
  `CREATE INDEX IF NOT EXISTS local_subtasks_task_idx ON local_subtasks (task_id, position)`,
  `CREATE INDEX IF NOT EXISTS local_ideas_user_idx ON local_ideas (user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS sync_queue_order_idx ON sync_queue (updated_at, id)`,
];

/** Active-row filter used by every read path. Tombstones are never listed. */
const ACTIVE = "(deleted_at IS NULL OR deleted_at = '')";

export class LocalDatabaseError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "LocalDatabaseError";
    this.cause = cause;
  }
}

let dbPromise: Promise<Database> | null = null;

/** Open (and lazily initialise) the shared folio.db connection. */
export async function getLocalDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load(LOCAL_DB_CONNECTION);
      await db.execute("PRAGMA journal_mode = WAL;");
      await db.execute("PRAGMA foreign_keys = ON;");
      return db;
    })().catch((error: unknown) => {
      dbPromise = null;
      throw new LocalDatabaseError("Folio could not open its local database.", error);
    });
  }
  return dbPromise;
}

/** Idempotent schema bootstrap. Safe to call on every engine start. */
export async function initLocalDb(): Promise<void> {
  const db = await getLocalDb();
  for (const statement of SCHEMA_STATEMENTS) {
    await db.execute(statement);
  }
  await setLocalMetadata(META_KEYS.schemaVersion, String(LOCAL_SCHEMA_VERSION));
}

/* ------------------------------------------------------------------ */
/* timestamps                                                          */
/* ------------------------------------------------------------------ */

/**
 * Coerce any incoming timestamp to a strict ISO string or SQL NULL.
 * Rejects the literal strings "null"/"undefined" that previously poisoned
 * the deleted_at column and broke project filtering.
 */
export function normaliseTimestamp(value: unknown): string | null {
  if (isNullish(value) || value === "null" || value === "undefined") return null;
  const iso = parseIsoTimestamp(value);
  return iso;
}

function requiredTimestamp(value: unknown, fallback: string): string {
  return normaliseTimestamp(value) ?? fallback;
}

/**
 * Monotonic mutation clock. Wall-clock ISO strings have millisecond
 * precision, so an INSERT and a DELETE issued in the same millisecond would
 * otherwise carry IDENTICAL updated_at values — and Last-Write-Wins cannot
 * order a tie, so the row could be revived after its delete depending on
 * push order. Every local mutation stamps strictly after the previous one.
 */
let lastIssuedMutationStamp = 0;
export function nextLocalMutationStamp(): string {
  const now = Date.now();
  lastIssuedMutationStamp = now > lastIssuedMutationStamp ? now : lastIssuedMutationStamp + 1;
  return new Date(lastIssuedMutationStamp).toISOString();
}

/* ------------------------------------------------------------------ */
/* sync_metadata                                                       */
/* ------------------------------------------------------------------ */

export async function getLocalMetadata(key: string): Promise<string | null> {
  const db = await getLocalDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM sync_metadata WHERE key = $1",
    [key],
  );
  const value = rows[0]?.value;
  return value === undefined || value === null ? null : String(value);
}

export async function setLocalMetadata(key: string, value: string): Promise<void> {
  const db = await getLocalDb();
  await db.execute(
    "INSERT INTO sync_metadata (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function clearLocalMetadata(keys: readonly string[]): Promise<void> {
  const db = await getLocalDb();
  for (const key of keys) {
    await db.execute("DELETE FROM sync_metadata WHERE key = $1", [key]);
  }
}

/* ------------------------------------------------------------------ */
/* table metadata                                                      */
/* ------------------------------------------------------------------ */

const TABLES: Record<SyncEntityType, string> = {
  projects: "local_projects",
  tasks: "local_tasks",
  milestones: "local_milestones",
  subtasks: "local_subtasks",
  ideas: "local_ideas",
};

const SYNCABLE_COLUMNS: Record<SyncEntityType, readonly string[]> = {
  projects: ["id", "user_id", "name", "description", "status", "priority", "color", "icon", "category", "start_date", "due_date", "favorite", "archived", "created_at", "updated_at", "deleted_at"],
  tasks: ["id", "user_id", "project_id", "milestone_id", "title", "description", "notes", "status", "completed", "priority", "start_date", "due_date", "labels", "estimate_minutes", "completed_at", "created_at", "updated_at", "deleted_at"],
  milestones: ["id", "user_id", "project_id", "title", "description", "due_date", "completed", "completed_at", "created_at", "updated_at", "deleted_at"],
  subtasks: ["id", "user_id", "task_id", "title", "completed", "completed_at", "position", "created_at", "updated_at", "deleted_at"],
  ideas: ["id", "user_id", "title", "description", "category", "color", "status", "created_at", "updated_at", "deleted_at"],
};

type LocalRow = Record<string, unknown>;

/** Read one raw row (any state, including tombstones) as the wire shape. */
export async function getLocalRow(kind: SyncEntityType, id: string): Promise<LocalRow | null> {
  const db = await getLocalDb();
  const table = TABLES[kind];
  const rows = await db.select<LocalRow[]>(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* wire mappers (raw SQLite row → canonical sync row)                  */
/* ------------------------------------------------------------------ */

function baseWire(row: LocalRow, fallbackDate: string) {
  return {
    id: String(row.id),
    user_id: String(row.user_id ?? ""),
    created_at: requiredTimestamp(row.created_at, fallbackDate),
    updated_at: requiredTimestamp(row.updated_at, fallbackDate),
    deleted_at: normaliseTimestamp(row.deleted_at),
  };
}

export function localProjectToWire(row: LocalRow): ProjectSyncRow {
  return {
    ...baseWire(row, "1970-01-01T00:00:00.000Z"),
    name: boundedText(row.name, 200, "Untitled project"),
    description: boundedText(row.description, 4000),
    status: oneOf(PROJECT_STATUS_VALUES, row.status, "Planning"),
    priority: oneOf(PROJECT_PRIORITY_VALUES, row.priority, "Medium"),
    color: oneOf(PROJECT_COLOR_VALUES, row.color, "violet"),
    icon: oneOf(PROJECT_ICON_VALUES, row.icon, "layout"),
    category: boundedText(row.category, 50, "Personal"),
    start_date: optionalDay(row.start_date),
    due_date: optionalDay(row.due_date),
    favorite: toBoolean(row.favorite),
    archived: toBoolean(row.archived),
  };
}

export function localTaskToWire(row: LocalRow): TaskSyncRow {
  return {
    ...baseWire(row, "1970-01-01T00:00:00.000Z"),
    project_id: isNullish(row.project_id) ? null : String(row.project_id),
    milestone_id: isNullish(row.milestone_id) ? null : String(row.milestone_id),
    title: boundedText(row.title, 200, "Untitled task"),
    description: boundedText(row.description, 4000),
    notes: boundedText(row.notes, 8000),
    status: oneOf(TASK_STATUS_VALUES, row.status, "todo"),
    completed: toBoolean(row.completed),
    priority: oneOf(TASK_PRIORITY_VALUES, row.priority, "Medium"),
    start_date: optionalDay(row.start_date),
    due_date: optionalDay(row.due_date),
    labels: parseLabels(row.labels),
    estimate_minutes: isNullish(row.estimate_minutes) ? null : boundedInt(row.estimate_minutes, 1, 43_200, 30),
    completed_at: normaliseTimestamp(row.completed_at),
  };
}

export function localMilestoneToWire(row: LocalRow): MilestoneSyncRow {
  return {
    ...baseWire(row, "1970-01-01T00:00:00.000Z"),
    project_id: String(row.project_id ?? ""),
    title: boundedText(row.title, 120, "Untitled milestone"),
    description: boundedText(row.description, 2000),
    due_date: optionalDay(row.due_date),
    completed: toBoolean(row.completed),
    completed_at: normaliseTimestamp(row.completed_at),
  };
}

export function localSubtaskToWire(row: LocalRow): SubtaskSyncRow {
  return {
    ...baseWire(row, "1970-01-01T00:00:00.000Z"),
    task_id: String(row.task_id ?? ""),
    title: boundedText(row.title, 200, "Untitled step"),
    completed: toBoolean(row.completed),
    completed_at: normaliseTimestamp(row.completed_at),
    position: boundedInt(row.position, 0, 1_000_000, 0),
  };
}

export function localIdeaToWire(row: LocalRow): IdeaSyncRow {
  return {
    ...baseWire(row, "1970-01-01T00:00:00.000Z"),
    title: boundedText(row.title, 100, "Untitled idea"),
    description: boundedText(row.description, 4000),
    category: boundedText(row.category, 50, "Personal"),
    color: oneOf(PROJECT_COLOR_VALUES, row.color, "yellow"),
    status: oneOf(IDEA_STATUS_VALUES, row.status, "Just an idea"),
  };
}

export function localRowToWire(kind: SyncEntityType, row: LocalRow): SyncEntityRow {
  switch (kind) {
    case "projects": return localProjectToWire(row);
    case "tasks": return localTaskToWire(row);
    case "milestones": return localMilestoneToWire(row);
    case "subtasks": return localSubtaskToWire(row);
    case "ideas": return localIdeaToWire(row);
  }
}

/* ------------------------------------------------------------------ */
/* UI mappers (raw SQLite row → camelCase app types)                   */
/* ------------------------------------------------------------------ */

function localProjectToUi(row: LocalRow): Project {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    status: oneOf(PROJECT_STATUS_VALUES, row.status, "Planning"),
    priority: oneOf(PROJECT_PRIORITY_VALUES, row.priority, "Medium"),
    color: oneOf(PROJECT_COLOR_VALUES, row.color, "violet"),
    icon: String(row.icon ?? "layout"),
    category: String(row.category ?? "Personal"),
    startDate: optionalDay(row.start_date),
    dueDate: optionalDay(row.due_date),
    favorite: toBoolean(row.favorite),
    archived: toBoolean(row.archived),
    createdAt: requiredTimestamp(row.created_at, new Date().toISOString()),
    updatedAt: requiredTimestamp(row.updated_at, requiredTimestamp(row.created_at, new Date().toISOString())),
  };
}

function localTaskToUi(row: LocalRow): Task {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    projectId: isNullish(row.project_id) ? null : String(row.project_id),
    milestoneId: isNullish(row.milestone_id) ? null : String(row.milestone_id),
    status: oneOf(TASK_STATUS_VALUES, row.status, "todo"),
    completed: toBoolean(row.completed),
    priority: oneOf(TASK_PRIORITY_VALUES, row.priority, "Medium"),
    startDate: optionalDay(row.start_date),
    dueDate: optionalDay(row.due_date),
    labels: parseLabels(row.labels),
    estimateMinutes: isNullish(row.estimate_minutes) ? null : boundedInt(row.estimate_minutes, 1, 43_200, 30),
    notes: String(row.notes ?? ""),
    completedAt: normaliseTimestamp(row.completed_at),
    createdAt: requiredTimestamp(row.created_at, new Date().toISOString()),
    updatedAt: requiredTimestamp(row.updated_at, requiredTimestamp(row.created_at, new Date().toISOString())),
  };
}

function localMilestoneToUi(row: LocalRow): Milestone {
  return {
    id: String(row.id),
    projectId: String(row.project_id ?? ""),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    dueDate: optionalDay(row.due_date),
    completed: toBoolean(row.completed),
    completedAt: normaliseTimestamp(row.completed_at),
    createdAt: requiredTimestamp(row.created_at, new Date().toISOString()),
  };
}

function localSubtaskToUi(row: LocalRow): Subtask {
  return {
    id: String(row.id),
    taskId: String(row.task_id ?? ""),
    title: String(row.title ?? ""),
    completed: toBoolean(row.completed),
    completedAt: normaliseTimestamp(row.completed_at),
    position: boundedInt(row.position, 0, 1_000_000, 0),
    createdAt: requiredTimestamp(row.created_at, new Date().toISOString()),
  };
}

function localIdeaToUi(row: LocalRow): Idea {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    color: oneOf(PROJECT_COLOR_VALUES, row.color, "yellow"),
    category: String(row.category ?? "Personal"),
    status: oneOf(IDEA_STATUS_VALUES, row.status, "Just an idea"),
    createdAt: requiredTimestamp(row.created_at, new Date().toISOString()),
  };
}

/* ------------------------------------------------------------------ */
/* active-list reads (the local-first data source)                     */
/* ------------------------------------------------------------------ */

export interface LocalWorkspaceSnapshot {
  projects: Project[];
  tasks: Task[];
  milestones: Milestone[];
  subtasks: Subtask[];
  ideas: Idea[];
}

/** Load every ACTIVE row owned by `userId`. Deleted rows are excluded at SQL level. */
export async function listLocalWorkspace(userId: string): Promise<LocalWorkspaceSnapshot> {
  const db = await getLocalDb();
  const [projectRows, taskRows, milestoneRows, subtaskRows, ideaRows] = await Promise.all([
    db.select<LocalRow[]>(`SELECT * FROM local_projects WHERE user_id = $1 AND ${ACTIVE} ORDER BY created_at ASC, id ASC`, [userId]),
    db.select<LocalRow[]>(`SELECT * FROM local_tasks WHERE user_id = $1 AND ${ACTIVE} ORDER BY created_at ASC, id ASC`, [userId]),
    db.select<LocalRow[]>(`SELECT * FROM local_milestones WHERE user_id = $1 AND ${ACTIVE} ORDER BY due_date IS NULL, due_date ASC, created_at ASC, id ASC`, [userId]),
    db.select<LocalRow[]>(`SELECT * FROM local_subtasks WHERE user_id = $1 AND ${ACTIVE} ORDER BY position ASC, created_at ASC, id ASC`, [userId]),
    db.select<LocalRow[]>(`SELECT * FROM local_ideas WHERE user_id = $1 AND ${ACTIVE} ORDER BY created_at DESC, id ASC`, [userId]),
  ]);
  return {
    projects: projectRows.map(localProjectToUi),
    tasks: taskRows.map(localTaskToUi),
    milestones: milestoneRows.map(localMilestoneToUi),
    subtasks: subtaskRows.map(localSubtaskToUi),
    ideas: ideaRows.map(localIdeaToUi),
  };
}

/* ------------------------------------------------------------------ */
/* profile + activity snapshots                                        */
/* ------------------------------------------------------------------ */

export async function getCachedProfile(): Promise<User | null> {
  try {
    const raw = await getLocalMetadata(META_KEYS.profile);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && typeof (parsed as User).id === "string" ? (parsed as User) : null;
  } catch {
    return null;
  }
}

export async function setCachedProfile(profile: User): Promise<void> {
  await setLocalMetadata(META_KEYS.profile, JSON.stringify(profile));
  await setLocalMetadata(META_KEYS.userId, profile.id);
}

export async function getCachedActivities(): Promise<Activity[]> {
  try {
    const raw = await getLocalMetadata(META_KEYS.activities);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Activity[]).filter((entry) => entry && typeof entry.id === "string") : [];
  } catch {
    return [];
  }
}

export async function setCachedActivities(activities: Activity[]): Promise<void> {
  await setLocalMetadata(META_KEYS.activities, JSON.stringify(activities.slice(0, 40)));
}

/* ------------------------------------------------------------------ */
/* pending profile edits (settings changed while offline)              */
/* ------------------------------------------------------------------ */

/** Shape of a locally-edited profile awaiting its cloud push. */
export interface PendingProfilePatch {
  name?: string;
  weeklyGoal?: number;
  complete?: boolean;
  personal?: Partial<PersonalPreferences>;
}

/**
 * Record (or merge with) a pending profile change made in the desktop
 * shell — e.g. Settings → name/weekly-goal, or the first workspace item
 * completing onboarding. The change is already applied to the local
 * snapshot when this is called; the sync engine PATCHes the cloud profile
 * and clears the flag on its next successful cycle. Merging keeps two
 * offline edits from clobbering each other.
 */
export async function markLocalProfilePending(patch: PendingProfilePatch): Promise<void> {
  const existingRaw = await getLocalMetadata(META_KEYS.profilePending);
  let existing: PendingProfilePatch = {};
  if (existingRaw) {
    try {
      const parsed: unknown = JSON.parse(existingRaw);
      if (parsed && typeof parsed === "object") existing = parsed as PendingProfilePatch;
    } catch {
      existing = {};
    }
  }
  const merged: PendingProfilePatch = {
    ...existing,
    ...patch,
    ...(existing.personal || patch.personal
      ? { personal: { ...(existing.personal ?? {}), ...(patch.personal ?? {}) } }
      : {}),
  };
  if (typeof merged.weeklyGoal === "number" && (!Number.isInteger(merged.weeklyGoal) || merged.weeklyGoal < 1 || merged.weeklyGoal > 100)) {
    delete merged.weeklyGoal;
  }
  if (typeof merged.name === "string") {
    const name = merged.name.trim().slice(0, 80);
    if (!name) delete merged.name;
    else merged.name = name;
  }
  await setLocalMetadata(META_KEYS.profilePending, JSON.stringify(merged));
  await setLocalMetadata(META_KEYS.profileDirty, "1");
}

/** Append a locally-generated activity entry (offline feedback), newest first. */
export async function appendLocalActivity(activity: Activity): Promise<void> {
  const existing = await getCachedActivities();
  await setCachedActivities([activity, ...existing].slice(0, 40));
}

/* ------------------------------------------------------------------ */
/* local writes + outbox                                               */
/* ------------------------------------------------------------------ */

function sqlValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function insertPlaceholders(columns: readonly string[]): string {
  return columns.map((_, index) => `$${index + 1}`).join(", ");
}

/** Insert or fully replace a row by id (local write path; tombstones are NULL). */
async function replaceRow(kind: SyncEntityType, wire: SyncEntityRow): Promise<void> {
  const db = await getLocalDb();
  const table = TABLES[kind];
  const columns = SYNCABLE_COLUMNS[kind];
  const record = wire as unknown as Record<string, unknown>;
  const values = columns.map((column) => {
    const raw = record[column];
    // Guarantee: timestamps are strict ISO strings or SQL NULL — never the
    // literal string "null". created_at/updated_at are NOT NULL: they always
    // carry a real value (fallback: now).
    if (column === "deleted_at" || column === "completed_at") {
      return toSqlNull(normaliseTimestamp(raw));
    }
    if (column === "created_at" || column === "updated_at") {
      return normaliseTimestamp(raw) ?? new Date().toISOString();
    }
    return sqlValue(raw);
  });
  await db.execute(
    `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${insertPlaceholders(columns)})`,
    values,
  );
}

/** Append a mutation to the durable outbox. */
export async function enqueueMutation(
  kind: SyncEntityType,
  entityId: string,
  operation: SyncOperation,
  payload: SyncEntityRow,
  updatedAt: string,
): Promise<void> {
  const db = await getLocalDb();
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await db.execute(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, updated_at, queued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, kind, entityId, operation, JSON.stringify(payload), updatedAt, new Date().toISOString()],
  );
}

/**
 * Local INSERT: persist the row (deleted_at = NULL) and queue an INSERT op.
 * `wire` must already carry ids, timestamps and the owner's user_id; the
 * mutation stamp is re-issued monotonically so same-millisecond write pairs
 * (create+delete) stay strictly ordered for Last-Write-Wins.
 */
export async function insertLocalEntity(kind: SyncEntityType, wire: SyncEntityRow): Promise<SyncEntityRow> {
  const stamp = nextLocalMutationStamp();
  const normalized = { ...wire, updated_at: stamp, deleted_at: null } as SyncEntityRow;
  await replaceRow(kind, normalized);
  await enqueueMutation(kind, wire.id, "INSERT", normalized, stamp);
  return normalized;
}

/**
 * Local UPDATE: merge `patch` into the stored row, bump updated_at, queue an
 * UPDATE op with the full new row. Returns null when the row does not exist.
 */
export async function updateLocalEntity(
  kind: SyncEntityType,
  id: string,
  patch: Partial<SyncEntityRow>,
): Promise<SyncEntityRow | null> {
  const existing = await getLocalRow(kind, id);
  if (!existing) return null;
  const merged: LocalRow = { ...existing, ...(patch as LocalRow) };
  const stamp = nextLocalMutationStamp();
  merged.updated_at = stamp;
  merged.deleted_at = toSqlNull(normaliseTimestamp(merged.deleted_at));
  const wire = localRowToWire(kind, merged);
  await replaceRow(kind, { ...wire, deleted_at: null } as SyncEntityRow);
  await enqueueMutation(kind, id, "UPDATE", { ...wire, deleted_at: null } as SyncEntityRow, stamp);
  return { ...wire, deleted_at: null } as SyncEntityRow;
}

/**
 * Local DELETE: remove the row locally and queue a DELETE op carrying the
 * last known payload (the server soft-deletes or inserts a tombstone).
 */
export async function deleteLocalEntity(kind: SyncEntityType, id: string): Promise<SyncEntityRow | null> {
  const existing = await getLocalRow(kind, id);
  if (!existing) return null;
  const wire = localRowToWire(kind, existing);
  const stamp = nextLocalMutationStamp();
  const payload = { ...wire, deleted_at: stamp } as SyncEntityRow;
  const db = await getLocalDb();
  await db.execute(`DELETE FROM ${TABLES[kind]} WHERE id = $1`, [id]);
  await enqueueMutation(kind, id, "DELETE", payload, stamp);
  return wire;
}

/* ------------------------------------------------------------------ */
/* pull application (LWW from the cloud)                               */
/* ------------------------------------------------------------------ */

export interface PullApplyOutcome {
  applied: number;
  skipped: number;
  removed: number;
}

/**
 * Apply pulled rows to the local mirror with Last-Write-Wins:
 *   - tombstones (deleted_at set) are removed from SQLite;
 *   - otherwise the row replaces the local copy only when
 *     remote.updated_at >= local.updated_at (a newer local pending edit
 *     keeps winning until its outbox entry is pushed).
 */
export async function applyPulledRows(kind: SyncEntityType, rows: SyncEntityRow[], userId: string): Promise<PullApplyOutcome> {
  const db = await getLocalDb();
  const table = TABLES[kind];
  const outcome: PullApplyOutcome = { applied: 0, skipped: 0, removed: 0 };
  for (const wire of rows) {
    if (wire.user_id && wire.user_id !== userId) continue; // never adopt another account's rows
    if (wire.deleted_at) {
      await db.execute(`DELETE FROM ${table} WHERE id = $1`, [wire.id]);
      outcome.removed += 1;
      continue;
    }
    const existing = await getLocalRow(kind, wire.id);
    if (existing) {
      const localUpdated = normaliseTimestamp(existing.updated_at);
      if (localUpdated && wire.updated_at < localUpdated) {
        outcome.skipped += 1;
        continue;
      }
    }
    await replaceRow(kind, { ...wire, deleted_at: null, user_id: wire.user_id || userId } as SyncEntityRow);
    outcome.applied += 1;
  }
  return outcome;
}

/* ------------------------------------------------------------------ */
/* outbox drain support                                                */
/* ------------------------------------------------------------------ */

/** Read pending outbox rows in FIFO order (by updated_at, then id). */
export async function takePendingMutations(limit: number): Promise<SyncMutation[]> {
  const db = await getLocalDb();
  const rows = await db.select<{ id: string; entity_type: string; entity_id: string; operation: string; payload: string; updated_at: string }[]>(
    `SELECT id, entity_type, entity_id, operation, payload, updated_at
     FROM sync_queue ORDER BY updated_at ASC, id ASC LIMIT $1`,
    [limit],
  );
  const mutations: SyncMutation[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as SyncEntityRow;
      if (!payload || typeof payload !== "object") continue;
      mutations.push({
        id: row.id,
        entity_type: row.entity_type as SyncEntityType,
        entity_id: row.entity_id,
        operation: row.operation.toUpperCase() as SyncOperation,
        payload,
        updated_at: row.updated_at,
      });
    } catch {
      // A corrupted payload can never succeed — drop the queue row.
      await db.execute("DELETE FROM sync_queue WHERE id = $1", [row.id]);
    }
  }
  return mutations;
}

/** Remove drained queue rows after the server acknowledged them. */
export async function deleteMutations(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getLocalDb();
  for (const id of ids) {
    await db.execute("DELETE FROM sync_queue WHERE id = $1", [id]);
  }
}

/** Number of mutations waiting to be pushed (drives the SyncIndicator badge). */
export async function countPendingMutations(): Promise<number> {
  const db = await getLocalDb();
  const rows = await db.select<{ count: number }[]>("SELECT COUNT(*) as count FROM sync_queue");
  return boundedInt(rows[0]?.count, 0, Number.MAX_SAFE_INTEGER, 0);
}

/* ------------------------------------------------------------------ */
/* local_auth (offline-resilient desktop session)                      */
/* ------------------------------------------------------------------ */

/** Raw shape of the single-row local_auth table. */
export interface LocalAuthRow {
  user_id: string;
  user_json: string;
  token: string;
  expires_at: string;
  updated_at: string;
}

/** Read the persisted desktop session row (null when signed out / fresh). */
export async function readLocalAuth(): Promise<LocalAuthRow | null> {
  const db = await getLocalDb();
  const rows = await db.select<LocalAuthRow[]>(
    "SELECT user_id, user_json, token, expires_at, updated_at FROM local_auth WHERE id = 1 LIMIT 1",
  );
  return rows[0] ?? null;
}

/** Persist (or replace) the desktop session row. */
export async function writeLocalAuth(row: LocalAuthRow): Promise<void> {
  const db = await getLocalDb();
  await db.execute(
    `INSERT INTO local_auth (id, user_id, user_json, token, expires_at, updated_at)
     VALUES (1, $1, $2, $3, $4, $5)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       user_json = excluded.user_json,
       token = excluded.token,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
    [row.user_id, row.user_json, row.token, row.expires_at, row.updated_at],
  );
}

/** Remove the desktop session row (sign-out). Never touches the data mirror. */
export async function clearLocalAuth(): Promise<void> {
  const db = await getLocalDb();
  await db.execute("DELETE FROM local_auth WHERE id = 1");
}

/* ------------------------------------------------------------------ */
/* account switch + reset                                              */
/* ------------------------------------------------------------------ */

/**
 * Wipe the local mirror and outbox. Used when the signed-in account changes
 * on this device (the local cache must never mix two users' rows) and by
 * "sign out". Unsynced local edits of the previous account are discarded —
 * they cannot be pushed under the new session for security reasons.
 */
export async function wipeLocalDatabase(): Promise<void> {
  const db = await getLocalDb();
  await db.execute("DELETE FROM local_projects");
  await db.execute("DELETE FROM local_tasks");
  await db.execute("DELETE FROM local_milestones");
  await db.execute("DELETE FROM local_subtasks");
  await db.execute("DELETE FROM local_ideas");
  await db.execute("DELETE FROM sync_queue");
  await db.execute("DELETE FROM sync_metadata");
  await setLocalMetadata(META_KEYS.schemaVersion, String(LOCAL_SCHEMA_VERSION));
}

/** Assemble the full WorkspaceData shape from the local mirror + snapshots. */
export async function loadLocalWorkspaceData(): Promise<WorkspaceData | null> {
  const profile = await getCachedProfile();
  if (!profile) return null;
  const [snapshot, activities] = await Promise.all([
    listLocalWorkspace(profile.id),
    getCachedActivities(),
  ]);
  return { user: profile, ...snapshot, activities };
}
