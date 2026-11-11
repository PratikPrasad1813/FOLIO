/**
 * Folio local-first sync protocol (shared by cloud API + desktop engine).
 *
 * Architecture: Outbox Mutation Queue + Last-Write-Wins (LWW) delta sync.
 *
 *  - The desktop app keeps a full mirror of the user's workspace in local
 *    SQLite (`folio.db`). Every local mutation is also appended to a durable
 *    `sync_queue` table (the "outbox").
 *  - A background engine PUSHes outbox rows to `/api/sync/push` in batches.
 *    The server upserts each row inside one transaction, applying LWW
 *    (`incoming.updated_at >= existing.updated_at`) and soft deletes.
 *  - The engine then PULLs deltas from `/api/sync/pull?since=<ISO>` where
 *    `since` is the last authoritative `server_time` it has seen. The server
 *    returns every row owned by the user with `updated_at > since`, including
 *    tombstones (soft-deleted rows) so deletions propagate downstream.
 *
 * The wire format is the canonical snake_case row shape shared by the local
 * SQLite tables and the cloud Neon tables. Timestamps are ISO-8601 strings
 * (UTC, millisecond precision); booleans are JSON booleans on the wire and
 * INTEGER 0/1 inside SQLite; `labels` is a string array on the wire and a
 * JSON-encoded array inside SQLite.
 */

export const SYNC_ENTITY_TYPES = ["projects", "tasks", "milestones", "subtasks", "ideas"] as const;
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

/** Queue operations. INSERT and UPDATE both map to a LWW upsert; DELETE is a soft delete. */
export const SYNC_OPERATIONS = ["INSERT", "UPDATE", "DELETE"] as const;
export type SyncOperation = (typeof SYNC_OPERATIONS)[number];

export function isSyncEntityType(value: unknown): value is SyncEntityType {
  return typeof value === "string" && (SYNC_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isSyncOperation(value: unknown): value is SyncOperation {
  return typeof value === "string" && (SYNC_OPERATIONS as readonly string[]).includes(value.toUpperCase() as SyncOperation);
}

/** A mutation as stored in the local `sync_queue` and sent to `/api/sync/push`. */
export interface SyncMutation {
  /** Queue row id (client-generated UUID). Echoed back in push results. */
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: SyncOperation;
  /** Full snake_case row payload (for DELETE: the last known row). */
  payload: SyncEntityRow;
  /** Client mutation timestamp (ISO). Drives Last-Write-Wins. */
  updated_at: string;
}

/** Per-item outcome in a push response. */
export type SyncPushResultStatus = "applied" | "skipped" | "rejected";

export interface SyncPushResult {
  id: string;
  status: SyncPushResultStatus;
  reason?: string;
}

export interface SyncPushResponse {
  server_time: string;
  results: SyncPushResult[];
  applied: number;
  skipped: number;
  rejected: number;
}

/** Soft-delete aware row common to every synced entity. */
export interface SyncRowBase {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  /** ISO timestamp when tombstoned; null/absent for active rows. Never the string "null". */
  deleted_at: string | null;
}

export interface ProjectSyncRow extends SyncRowBase {
  name: string;
  description: string;
  status: string;
  priority: string;
  color: string;
  icon: string;
  category: string;
  start_date: string | null;
  due_date: string | null;
  favorite: boolean;
  archived: boolean;
}

export interface TaskSyncRow extends SyncRowBase {
  project_id: string | null;
  milestone_id: string | null;
  title: string;
  description: string;
  notes: string;
  status: string;
  completed: boolean;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  labels: string[];
  estimate_minutes: number | null;
  completed_at: string | null;
}

export interface MilestoneSyncRow extends SyncRowBase {
  project_id: string;
  title: string;
  description: string;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
}

export interface SubtaskSyncRow extends SyncRowBase {
  task_id: string;
  title: string;
  completed: boolean;
  completed_at: string | null;
  position: number;
}

export interface IdeaSyncRow extends SyncRowBase {
  title: string;
  description: string;
  category: string;
  color: string;
  status: string;
}

export type SyncEntityRow = ProjectSyncRow | TaskSyncRow | MilestoneSyncRow | SubtaskSyncRow | IdeaSyncRow;
export type SyncEntityRows = Record<SyncEntityType, SyncEntityRow[]>;

export interface SyncProfile {
  id: string;
  name: string;
  email: string;
  provider: string;
  weeklyGoal: number;
  personal: Record<string, unknown>;
  greetingName: string;
  onboardingCompleted: boolean;
  emailVerified: boolean;
  guideDismissed: boolean;
  hasPassword: boolean;
  timezone?: string;
}

export interface SyncActivity {
  id: string;
  text: string;
  type: string;
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface SyncPullResponse {
  server_time: string;
  /** Rows changed since `since`, including tombstones. */
  changes: SyncEntityRows;
  /** Authoritative user profile (drives the local-first UI shell). */
  profile: SyncProfile | null;
  /** The most recent activity feed rows (display-only). */
  activities: SyncActivity[];
  /** True when the account on the server differs from the locally cached account. */
  account_switched?: boolean;
}

/** UUID v1–v8 shape accepted for entity + queue ids (mirrors the web app's rule). */
export const SYNC_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Parse an ISO timestamp; returns null for anything else. Never throws. */
export function parseIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** True when the value is a tombstone-safe null: real null, undefined, "" — never the literal "null". */
export function isNullish(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Normalise a nullable column value for SQLite: real null, empty string and
 * the literal strings "null"/"undefined" (the SQLite plugin's textual
 * renderings of JS null in some bind paths) all become SQL NULL; anything
 * else passes through as a string. A tombstone column never accidentally
 * becomes a truthy string — the exact bug that previously broke filtering.
 */
export function toSqlNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "" || value === "null" || value === "undefined") return null;
  return String(value);
}

/** Coerce SQLite's INTEGER 0/1 (or JSON boolean) to a real boolean. */
export function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (value === "1" || value.toLowerCase() === "true") return true;
    if (value === "0" || value.toLowerCase() === "false" || isNullish(value) || value === "null") return false;
  }
  return fallback;
}

/** Parse a JSON-encoded label array coming out of SQLite TEXT. */
export function parseLabels(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((label): label is string => typeof label === "string");
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((label): label is string => typeof label === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Valid enum domains mirrored from the web app (`src/lib/types.ts`). */
export const PROJECT_STATUS_VALUES = ["Planning", "In progress", "On hold", "Completed"] as const;
export const PROJECT_PRIORITY_VALUES = ["High", "Medium", "Low"] as const;
export const PROJECT_COLOR_VALUES = ["violet", "green", "peach", "blue", "yellow", "pink"] as const;
export const PROJECT_ICON_VALUES = ["layout", "smartphone", "pen", "code", "book", "megaphone", "heart", "coffee"] as const;
export const TASK_STATUS_VALUES = ["todo", "in_progress", "in_review", "done"] as const;
export const TASK_PRIORITY_VALUES = ["Urgent", "High", "Medium", "Low", "None"] as const;
export const IDEA_STATUS_VALUES = ["Just an idea", "Exploring", "Ready to start"] as const;

export function oneOf<T extends readonly string[]>(values: T, value: unknown, fallback: T[number]): T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

/** Clamp helper for bounded numeric fields. */
export function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Bounded text helper shared by the push validator and the local writers. */
export function boundedText(value: unknown, max: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.length > max ? value.slice(0, max) : value;
}

/** Optional date string (YYYY-MM-DD) or null. */
export function optionalDay(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) ? value.slice(0, 10) : null;
}
