"use client";

/**
 * Local-first workspace data source (desktop only).
 *
 * Implements the exact response contract of /api/workspace against the local
 * SQLite mirror + outbox, so `useWorkspace` can swap its transport without
 * any change to the UI components:
 *
 *   loadDesktopWorkspace()   → GET  /api/workspace
 *   desktopMutate()          → POST/PATCH/DELETE /api/workspace
 *   desktopBulkTasks()       → bulk PATCH/DELETE /api/workspace
 *   desktopConvertIdea()     → POST /api/workspace (action=convert)
 *
 * Every write lands in SQLite first (0ms UI feedback), then in the outbox for
 * the sync engine. Parent "touch" bumps mirror the server's behaviour so the
 * "last updated" ordering stays identical on every device.
 */

import type { Activity, Idea, Item, Milestone, Project, Resource, Subtask, Task, WorkspaceData } from "@/lib/types";
import {
  appendLocalActivity,
  deleteLocalEntity,
  getCachedActivities,
  getCachedProfile,
  getLocalDb,
  getLocalRow,
  insertLocalEntity,
  listLocalWorkspace,
  localRowToWire,
  updateLocalEntity,
} from "@/lib/desktop/local-db";
import {
  oneOf,
  parseLabels,
  toBoolean,
  boundedText,
  optionalDay,
  isNullish,
  IDEA_STATUS_VALUES,
  PROJECT_COLOR_VALUES,
  PROJECT_ICON_VALUES,
  PROJECT_PRIORITY_VALUES,
  PROJECT_STATUS_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  type IdeaSyncRow,
  type MilestoneSyncRow,
  type ProjectSyncRow,
  type SubtaskSyncRow,
  type SyncEntityRow,
  type SyncEntityType,
  type TaskSyncRow,
} from "@/lib/sync-protocol";

export interface WorkspaceMutationResult {
  item: Item;
  activity: Activity | null;
  projects?: Project[];
  tasks?: { id: string; updatedAt: string }[];
  subtasks?: Subtask[];
}

export interface BulkMutationResult {
  items: Task[];
  deleted: string[];
  missing: number;
  activity: Activity | null;
  projects: Project[];
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function quote(value: string): string {
  return `“${value}”`;
}

/** True once a profile snapshot exists — the local mirror is usable. */
export async function hasDesktopWorkspaceCache(): Promise<boolean> {
  return (await getCachedProfile()) !== null;
}

/** Load the whole workspace from SQLite. Returns null before the first sync. */
export async function loadDesktopWorkspace(): Promise<WorkspaceData | null> {
  const profile = await getCachedProfile();
  if (!profile) return null;
  const [snapshot, activities] = await Promise.all([listLocalWorkspace(profile.id), getCachedActivities()]);
  return { user: profile, ...snapshot, activities };
}

/* ------------------------------------------------------------------ */
/* UI (camelCase) ↔ wire (snake_case) conversion                       */
/* ------------------------------------------------------------------ */

function baseRow(userId: string): { id: string; user_id: string; created_at: string; updated_at: string; deleted_at: null } {
  const now = new Date().toISOString();
  return { id: uuid(), user_id: userId, created_at: now, updated_at: now, deleted_at: null };
}

function projectFromValues(values: Record<string, unknown>, userId: string): ProjectSyncRow {
  const base = baseRow(userId);
  return {
    ...base,
    name: boundedText(values.name, 200, "") || "Untitled project",
    description: boundedText(values.description, 4000),
    status: oneOf(PROJECT_STATUS_VALUES, values.status, "Planning"),
    priority: oneOf(PROJECT_PRIORITY_VALUES, values.priority, "Medium"),
    color: oneOf(PROJECT_COLOR_VALUES, values.color, "violet"),
    icon: oneOf(PROJECT_ICON_VALUES, values.icon, "layout"),
    category: boundedText(values.category, 50, "Personal"),
    start_date: optionalDay(values.startDate),
    due_date: optionalDay(values.dueDate),
    favorite: toBoolean(values.favorite),
    archived: toBoolean(values.archived),
  };
}

function taskFromValues(values: Record<string, unknown>, userId: string): TaskSyncRow {
  const base = baseRow(userId);
  const completed = toBoolean(values.completed);
  const status = typeof values.status === "string"
    ? oneOf(TASK_STATUS_VALUES, values.status, completed ? "done" : "todo")
    : completed ? "done" : "todo";
  return {
    ...base,
    project_id: isNullish(values.projectId) ? null : String(values.projectId),
    milestone_id: isNullish(values.milestoneId) ? null : String(values.milestoneId),
    title: boundedText(values.title, 200, "") || "Untitled task",
    description: boundedText(values.description, 4000),
    notes: boundedText(values.notes, 8000),
    status,
    completed: status === "done",
    priority: oneOf(TASK_PRIORITY_VALUES, values.priority, "Medium"),
    start_date: optionalDay(values.startDate),
    due_date: optionalDay(values.dueDate),
    labels: parseLabels(values.labels),
    estimate_minutes: isNullish(values.estimateMinutes) ? null : Number(values.estimateMinutes) || null,
    completed_at: status === "done" ? base.updated_at : null,
  };
}

function milestoneFromValues(values: Record<string, unknown>, userId: string): MilestoneSyncRow {
  const base = baseRow(userId);
  const completed = toBoolean(values.completed);
  return {
    ...base,
    project_id: String(values.projectId ?? ""),
    title: boundedText(values.title, 120, "") || "Untitled milestone",
    description: boundedText(values.description, 2000),
    due_date: optionalDay(values.dueDate),
    completed,
    completed_at: completed ? base.updated_at : null,
  };
}

function subtaskFromValues(values: Record<string, unknown>, userId: string, taskId: string, position: number): SubtaskSyncRow {
  const base = baseRow(userId);
  const completed = toBoolean(values.completed);
  return {
    ...base,
    task_id: taskId,
    title: boundedText(values.title, 200, "") || "Untitled step",
    completed,
    completed_at: completed ? base.updated_at : null,
    position,
  };
}

function ideaFromValues(values: Record<string, unknown>, userId: string): IdeaSyncRow {
  const base = baseRow(userId);
  return {
    ...base,
    title: boundedText(values.title, 100, "") || "Untitled idea",
    description: boundedText(values.description, 4000),
    category: boundedText(values.category, 50, "Personal"),
    color: oneOf(PROJECT_COLOR_VALUES, values.color, "yellow"),
    status: oneOf(IDEA_STATUS_VALUES, values.status, "Just an idea"),
  };
}

/** Merge a camelCase UI patch into a wire row (snake_case keys). */
function applyUiPatch(kind: SyncEntityType, wire: SyncEntityRow, values: Record<string, unknown>): SyncEntityRow {
  const next = { ...wire } as Record<string, unknown>;
  const set = (key: string, value: unknown) => {
    if (value !== undefined) next[key] = value;
  };

  if (kind === "projects") {
    if ("name" in values) set("name", boundedText(values.name, 200, "") || "Untitled project");
    if ("description" in values) set("description", boundedText(values.description, 4000));
    if ("status" in values) set("status", oneOf(PROJECT_STATUS_VALUES, values.status, "Planning"));
    if ("priority" in values) set("priority", oneOf(PROJECT_PRIORITY_VALUES, values.priority, "Medium"));
    if ("color" in values) set("color", oneOf(PROJECT_COLOR_VALUES, values.color, "violet"));
    if ("icon" in values) set("icon", oneOf(PROJECT_ICON_VALUES, values.icon, "layout"));
    if ("category" in values) set("category", boundedText(values.category, 50, "Personal"));
    if ("startDate" in values) set("start_date", optionalDay(values.startDate));
    if ("dueDate" in values) set("due_date", optionalDay(values.dueDate));
    if ("favorite" in values) set("favorite", toBoolean(values.favorite));
    if ("archived" in values) set("archived", toBoolean(values.archived));
  } else if (kind === "tasks") {
    const taskWire = wire as TaskSyncRow;
    if ("title" in values) set("title", boundedText(values.title, 200, "") || "Untitled task");
    if ("description" in values) set("description", boundedText(values.description, 4000));
    if ("notes" in values) set("notes", boundedText(values.notes, 8000));
    if ("priority" in values) set("priority", oneOf(TASK_PRIORITY_VALUES, values.priority, "Medium"));
    if ("startDate" in values) set("start_date", optionalDay(values.startDate));
    if ("dueDate" in values) set("due_date", optionalDay(values.dueDate));
    if ("labels" in values) set("labels", parseLabels(values.labels));
    if ("estimateMinutes" in values) set("estimate_minutes", isNullish(values.estimateMinutes) ? null : Number(values.estimateMinutes) || null);
    if ("projectId" in values) set("project_id", isNullish(values.projectId) ? null : String(values.projectId));
    if ("milestoneId" in values) set("milestone_id", isNullish(values.milestoneId) ? null : String(values.milestoneId));
    // Workflow status is the source of truth; completed + completedAt mirror it.
    if (values.status !== undefined) {
      const status = oneOf(TASK_STATUS_VALUES, values.status, "todo");
      next.status = status;
      next.completed = status === "done";
      next.completed_at = status === "done" ? (taskWire.completed_at ?? new Date().toISOString()) : null;
    } else if (values.completed !== undefined) {
      const completed = toBoolean(values.completed);
      next.completed = completed;
      next.status = completed ? "done" : (next.status as string) !== "done" ? next.status : "todo";
      next.completed_at = completed ? (taskWire.completed_at ?? new Date().toISOString()) : null;
    }
  } else if (kind === "milestones") {
    const milestoneWire = wire as MilestoneSyncRow;
    if ("title" in values) set("title", boundedText(values.title, 120, "") || "Untitled milestone");
    if ("description" in values) set("description", boundedText(values.description, 2000));
    if ("dueDate" in values) set("due_date", optionalDay(values.dueDate));
    if ("completed" in values) {
      const completed = toBoolean(values.completed);
      set("completed", completed);
      set("completed_at", completed ? (milestoneWire.completed_at ?? new Date().toISOString()) : null);
    }
  } else if (kind === "subtasks") {
    const subtaskWire = wire as SubtaskSyncRow;
    if ("title" in values) set("title", boundedText(values.title, 200, "") || "Untitled step");
    if ("position" in values && typeof values.position === "number") set("position", Math.max(0, Math.round(values.position)));
    if ("completed" in values) {
      const completed = toBoolean(values.completed);
      set("completed", completed);
      set("completed_at", completed ? (subtaskWire.completed_at ?? new Date().toISOString()) : null);
    }
  } else if (kind === "ideas") {
    if ("title" in values) set("title", boundedText(values.title, 100, "") || "Untitled idea");
    if ("description" in values) set("description", boundedText(values.description, 4000));
    if ("category" in values) set("category", boundedText(values.category, 50, "Personal"));
    if ("color" in values) set("color", oneOf(PROJECT_COLOR_VALUES, values.color, "yellow"));
    if ("status" in values) set("status", oneOf(IDEA_STATUS_VALUES, values.status, "Just an idea"));
  }
  return next as unknown as SyncEntityRow;
}

/* ------------------------------------------------------------------ */
/* activity + touch parity with the server mutation path               */
/* ------------------------------------------------------------------ */

function localActivity(text: string, type: string, projectId: string | null, taskId: string | null = null): Activity {
  return { id: uuid(), text, type, projectId, taskId, createdAt: new Date().toISOString() };
}

function describeChange(kind: Resource, method: "POST" | "PATCH" | "DELETE", values: Record<string, unknown>, name: string): { text: string; type: string } {
  if (method === "POST") {
    if (kind === "projects") return { text: `Created project ${quote(name)}`, type: "project" };
    if (kind === "ideas") return { text: `Captured the idea ${quote(name)}`, type: "idea" };
    if (kind === "milestones") return { text: `Added milestone ${quote(name)}`, type: "milestone" };
    return { text: `Added ${quote(name)}`, type: "task" };
  }
  if (method === "DELETE") {
    const labels: Record<Resource, string> = { projects: "project", tasks: "task", ideas: "idea", milestones: "milestone", subtasks: "subtask" };
    return { text: `Deleted ${labels[kind]} ${quote(name)}`, type: kind === "subtasks" ? "subtask" : kind === "milestones" ? "milestone" : kind === "ideas" ? "idea" : kind === "projects" ? "project" : "task" };
  }
  if (values.status === "done") return { text: `Completed ${quote(name)}`, type: "complete" };
  if (typeof values.status === "string" && kind === "projects") return { text: `Updated ${quote(name)} · now ${values.status}`, type: "project" };
  if (values.archived === true) return { text: `Archived ${quote(name)}`, type: "project" };
  if (values.archived === false) return { text: `Restored ${quote(name)} from the archive`, type: "project" };
  if (values.favorite === true) return { text: `Starred ${quote(name)}`, type: "project" };
  if (values.favorite === false) return { text: `Unstarred ${quote(name)}`, type: "project" };
  return { text: `Updated ${quote(name)}`, type: kind === "milestones" ? "milestone" : kind === "ideas" ? "idea" : kind === "subtasks" ? "subtask" : kind === "projects" ? "project" : "task" };
}

/** Bump a parent project's updated_at (mirrors the server's touch behaviour). */
async function touchProject(projectId: string | null): Promise<Project | null> {
  if (!projectId) return null;
  const updated = await updateLocalEntity("projects", projectId, {});
  if (!updated) return null;
  return wireToUiProject(updated as ProjectSyncRow);
}

/** Bump a parent task's updated_at (subtask edits count as task updates). */
async function touchTask(taskId: string | null): Promise<{ id: string; updatedAt: string } | null> {
  if (!taskId) return null;
  const updated = await updateLocalEntity("tasks", taskId, {});
  return updated ? { id: updated.id, updatedAt: updated.updated_at } : null;
}

/* ------------------------------------------------------------------ */
/* wire → UI mappers (shared with the workspace hook)                  */
/* ------------------------------------------------------------------ */

function wireToUiProject(row: ProjectSyncRow): Project {
  return {
    id: row.id, name: row.name, description: row.description, status: row.status as Project["status"],
    priority: row.priority as Project["priority"], color: row.color as Project["color"], icon: row.icon,
    category: row.category, startDate: row.start_date, dueDate: row.due_date, favorite: row.favorite,
    archived: row.archived, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function wireToUiTask(row: TaskSyncRow): Task {
  return {
    id: row.id, title: row.title, description: row.description, projectId: row.project_id,
    milestoneId: row.milestone_id, status: row.status as Task["status"], completed: row.completed,
    priority: row.priority as Task["priority"], startDate: row.start_date, dueDate: row.due_date,
    labels: row.labels, estimateMinutes: row.estimate_minutes, notes: row.notes,
    completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function wireToUiMilestone(row: MilestoneSyncRow): Milestone {
  return {
    id: row.id, projectId: row.project_id, title: row.title, description: row.description,
    dueDate: row.due_date, completed: row.completed, completedAt: row.completed_at, createdAt: row.created_at,
  };
}

function wireToUiSubtask(row: SubtaskSyncRow): Subtask {
  return {
    id: row.id, taskId: row.task_id, title: row.title, completed: row.completed,
    completedAt: row.completed_at, position: row.position, createdAt: row.created_at,
  };
}

function wireToUiIdea(row: IdeaSyncRow): Idea {
  return {
    id: row.id, title: row.title, description: row.description, color: row.color as Idea["color"],
    category: row.category, status: row.status, createdAt: row.created_at,
  };
}

export function wireToUiItem(kind: SyncEntityType, row: SyncEntityRow): Item {
  switch (kind) {
    case "projects": return wireToUiProject(row as ProjectSyncRow);
    case "tasks": return wireToUiTask(row as TaskSyncRow);
    case "milestones": return wireToUiMilestone(row as MilestoneSyncRow);
    case "subtasks": return wireToUiSubtask(row as SubtaskSyncRow);
    case "ideas": return wireToUiIdea(row as IdeaSyncRow);
  }
}

/* ------------------------------------------------------------------ */
/* mutations                                                           */
/* ------------------------------------------------------------------ */

/**
 * The desktop twin of the /api/workspace mutation endpoint. Writes SQLite +
 * the outbox, then returns the response shape the UI expects.
 */
export async function desktopMutate(
  kind: Resource,
  method: "POST" | "PATCH" | "DELETE",
  values: Record<string, unknown>,
  id?: string,
): Promise<WorkspaceMutationResult> {
  const profile = await getCachedProfile();
  if (!profile) throw new Error("Your workspace is still syncing. Try again in a moment.");

  // Creation payloads that are not columns of the row itself.
  const creationSubtasks = kind === "tasks" && method === "POST" && Array.isArray(values.subtasks)
    ? (values.subtasks as unknown[]).filter((title): title is string => typeof title === "string" && title.trim().length > 0).slice(0, 50)
    : [];

  if (method === "POST") {
    let row: SyncEntityRow;
    if (kind === "projects") row = projectFromValues(values, profile.id);
    else if (kind === "tasks") row = taskFromValues(values, profile.id);
    else if (kind === "milestones") row = milestoneFromValues(values, profile.id);
    else if (kind === "subtasks") {
      const parent = await getLocalRow("tasks", String(values.taskId ?? ""));
      if (!parent) throw new Error("That task is not in your workspace.");
      const db = await getLocalDb();
      const siblings = await db.select<{ position: number | null }[]>(
        "SELECT position FROM local_subtasks WHERE task_id = $1 AND (deleted_at IS NULL OR deleted_at = '')",
        [parent.id],
      );
      const nextPosition = siblings.reduce((max: number, entry: { position: number | null }) => Math.max(max, Number(entry.position) || 0), -1) + 1;
      row = subtaskFromValues(values, profile.id, String(parent.id), nextPosition);
    } else row = ideaFromValues(values, profile.id);

    const stored = await insertLocalEntity(kind, row);
    const item = wireToUiItem(kind, stored);

    // Task creation may carry initial subtasks (same contract as the server).
    const createdSubtasks: Subtask[] = [];
    if (kind === "tasks" && creationSubtasks.length) {
      for (const [position, title] of creationSubtasks.entries()) {
        const stepRow = await insertLocalEntity("subtasks", subtaskFromValues({ title }, profile.id, stored.id, position));
        createdSubtasks.push(wireToUiSubtask(stepRow as SubtaskSyncRow));
      }
    }

    const description = describeChange(kind, "POST", values, "name" in values && typeof values.name === "string" ? values.name : "title" in values && typeof values.title === "string" ? values.title : "");
    const activity = localActivity(description.text, description.type, "projectId" in item ? (item.projectId as string | null) : null, kind === "tasks" ? item.id : null);
    await appendLocalActivity(activity);

    const touchedProjects: Project[] = [];
    const touchedTasks: { id: string; updatedAt: string }[] = [];
    if (kind === "tasks" || kind === "milestones") {
      const parentProjectId = (item as Task | Milestone).projectId;
      const touched = await touchProject(parentProjectId);
      if (touched) touchedProjects.push(touched);
    } else if (kind === "subtasks") {
      const touchedTask = await touchTask((item as Subtask).taskId);
      if (touchedTask) touchedTasks.push(touchedTask);
      const task = await getLocalRow("tasks", (item as Subtask).taskId);
      const parentProjectId = task && !isNullish(task.project_id) ? String(task.project_id) : null;
      const touched = await touchProject(parentProjectId);
      if (touched) touchedProjects.push(touched);
    }

    return { item, activity, projects: touchedProjects, tasks: touchedTasks, subtasks: createdSubtasks };
  }

  if (!id) throw new Error("This item was not found in your workspace.");
  const existing = await getLocalRow(kind, id);
  if (!existing) throw new Error("This item was not found in your workspace.");

  if (method === "DELETE") {
    const wire = localRowToWire(kind, existing);
    const name = "name" in wire ? wire.name : wire.title;

    // Cascades mirror the server exactly.
    if (kind === "projects") {
      const snapshot = await listLocalWorkspace(profile.id);
      for (const milestone of snapshot.milestones.filter((entry) => entry.projectId === id)) {
        await deleteLocalEntity("milestones", milestone.id);
      }
      for (const task of snapshot.tasks.filter((entry) => entry.projectId === id)) {
        await updateLocalEntity("tasks", task.id, { project_id: null, milestone_id: null } as Partial<TaskSyncRow>);
      }
    } else if (kind === "tasks") {
      const snapshot = await listLocalWorkspace(profile.id);
      for (const step of snapshot.subtasks.filter((entry) => entry.taskId === id)) {
        await deleteLocalEntity("subtasks", step.id);
      }
    } else if (kind === "milestones") {
      const snapshot = await listLocalWorkspace(profile.id);
      for (const task of snapshot.tasks.filter((entry) => entry.milestoneId === id)) {
        await updateLocalEntity("tasks", task.id, { milestone_id: null } as Partial<TaskSyncRow>);
      }
    }

    const stored = await deleteLocalEntity(kind, id);
    if (!stored) throw new Error("This item was not found in your workspace.");
    const item = wireToUiItem(kind, stored);
    const description = describeChange(kind, "DELETE", values, name);
    const activity = localActivity(description.text, description.type, "projectId" in item ? (item.projectId as string | null) : null);
    await appendLocalActivity(activity);

    const touchedProjects: Project[] = [];
    if (kind === "tasks" || kind === "milestones") {
      const touched = await touchProject("projectId" in item ? (item.projectId as string | null) : null);
      if (touched) touchedProjects.push(touched);
    }
    return { item, activity, projects: touchedProjects, tasks: [], subtasks: [] };
  }

  // PATCH
  const currentWire = localRowToWire(kind, existing);
  const nextWire = applyUiPatch(kind, currentWire, values);
  const stored = await updateLocalEntity(kind, id, nextWire as Partial<SyncEntityRow>);
  if (!stored) throw new Error("This item was not found in your workspace.");
  const item = wireToUiItem(kind, stored);

  const name = "name" in stored ? (stored as ProjectSyncRow).name : (stored as TaskSyncRow | MilestoneSyncRow | SubtaskSyncRow | IdeaSyncRow).title;
  const description = describeChange(kind, "PATCH", values, name);
  const activity = localActivity(description.text, description.type, "projectId" in item ? (item.projectId as string | null) : null, kind === "tasks" ? item.id : null);
  await appendLocalActivity(activity);

  const touchedProjects: Project[] = [];
  const touchedTasks: { id: string; updatedAt: string }[] = [];
  if (kind === "tasks" || kind === "milestones") {
    const beforeProject = "projectId" in currentWire ? (currentWire as TaskSyncRow | MilestoneSyncRow).project_id : null;
    const afterProject = "projectId" in stored ? (stored as TaskSyncRow | MilestoneSyncRow).project_id : null;
    for (const projectId of new Set([beforeProject, afterProject])) {
      const touched = await touchProject(projectId);
      if (touched) touchedProjects.push(touched);
    }
  } else if (kind === "subtasks") {
    const touchedTask = await touchTask((item as Subtask).taskId);
    if (touchedTask) touchedTasks.push(touchedTask);
    const task = await getLocalRow("tasks", (item as Subtask).taskId);
    const touched = await touchProject(task && !isNullish(task.project_id) ? String(task.project_id) : null);
    if (touched) touchedProjects.push(touched);
  }

  return { item, activity, projects: touchedProjects, tasks: touchedTasks, subtasks: [] };
}

/** The desktop twin of the bulk tasks endpoint. */
export async function desktopBulkTasks(ids: string[], change: Record<string, unknown> | "delete"): Promise<BulkMutationResult> {
  const profile = await getCachedProfile();
  if (!profile) throw new Error("Your workspace is still syncing. Try again in a moment.");
  const isDelete = change === "delete";
  const snapshot = await listLocalWorkspace(profile.id);

  const items: Task[] = [];
  const deleted: string[] = [];
  const touchedProjects = new Map<string, Project>();
  let missing = 0;

  for (const taskId of ids) {
    const existing = snapshot.tasks.find((task) => task.id === taskId);
    if (!existing) {
      missing += 1;
      continue;
    }
    if (isDelete) {
      for (const step of snapshot.subtasks.filter((entry) => entry.taskId === taskId)) {
        await deleteLocalEntity("subtasks", step.id);
      }
      const stored = await deleteLocalEntity("tasks", taskId);
      if (stored) deleted.push(taskId);
      const touched = await touchProject(existing.projectId);
      if (touched) touchedProjects.set(touched.id, touched);
    } else {
      const taskRow = await getLocalRow("tasks", taskId);
      if (!taskRow) {
        missing += 1;
        continue;
      }
      const currentWire = localRowToWire("tasks", taskRow);
      const nextWire = applyUiPatch("tasks", currentWire, change);
      const stored = await updateLocalEntity("tasks", taskId, nextWire as Partial<SyncEntityRow>);
      if (stored) items.push(wireToUiTask(stored as TaskSyncRow));
      for (const projectId of new Set([existing.projectId, typeof change.projectId === "string" ? change.projectId : null])) {
        const touched = await touchProject(projectId);
        if (touched) touchedProjects.set(touched.id, touched);
      }
    }
  }

  const activity = localActivity(
    isDelete ? `Deleted ${deleted.length} task${deleted.length === 1 ? "" : "s"}` : `Updated ${items.length} task${items.length === 1 ? "" : "s"}`,
    "task",
    null,
  );
  await appendLocalActivity(activity);

  return { items, deleted, missing, activity, projects: [...touchedProjects.values()] };
}

/** The desktop twin of idea → project conversion. */
export async function desktopConvertIdea(idea: Idea): Promise<{ item: Project; activity: Activity }> {
  const profile = await getCachedProfile();
  if (!profile) throw new Error("Your workspace is still syncing. Try again in a moment.");

  const projectRow = await insertLocalEntity(
    "projects",
    projectFromValues({ name: idea.title, description: idea.description, category: idea.category, color: idea.color, status: "Planning" }, profile.id),
  );
  await deleteLocalEntity("ideas", idea.id);

  const activity = localActivity(`Turned ${quote(idea.title)} into a project`, "project", projectRow.id);
  await appendLocalActivity(activity);
  return { item: wireToUiProject(projectRow as ProjectSyncRow), activity };
}
