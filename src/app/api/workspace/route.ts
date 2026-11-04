import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { activities, ideas, milestones, notificationPreferences, projects, subtasks, tasks } from "@/db/schema";
import { getUser, publicUser, sameOrigin } from "@/lib/auth";
import { formatDate, statusLabel, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, type TaskPriority, type TaskStatus } from "@/lib/types";
import {
  emitMilestoneMutationNotifications,
  emitProjectMutationNotifications,
  getOrCreatePreferences,
  processUserReminders,
  reconcileBulkTaskLifecycle,
  reconcileTaskLifecycle,
  upsertTaskReminder,
} from "@/lib/reminder-processor";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL = "00000000-0000-4000-8000-000000000000";
type Input = Record<string, unknown>;
type Kind = "projects" | "tasks" | "ideas" | "milestones" | "subtasks";
type Method = "POST" | "PATCH" | "DELETE";
const KINDS: Kind[] = ["projects", "tasks", "ideas", "milestones", "subtasks"];
class InputError extends Error {}
class NotFoundError extends Error {}
interface Log { text: string; type: string; projectId: string | null; taskId?: string | null }
interface Outcome { item: { id: string } | undefined; log: Log | null; touch: string[]; touchTasks?: string[]; subtasks?: (typeof subtasks.$inferSelect)[] }
type TaskRow = typeof tasks.$inferSelect;

function text(value: unknown, label: string, max = 200, required = false) {
  if (typeof value !== "string") { if (value == null && !required) return ""; throw new InputError(`Please enter a valid ${label}.`); }
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new InputError(`${label.charAt(0).toUpperCase()}${label.slice(1)} must be ${required ? "1" : "0"}–${max} characters.`);
  return result;
}
function choice(value: unknown, choices: string[], fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !choices.includes(value)) throw new InputError("Please select a valid option.");
  return value;
}
function date(value: unknown) {
  if (!value) return null;
  if (typeof value !== "string" || !/^(19[7-9]\d|2[01]\d\d)-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new InputError("Please enter a valid date.");
  return value;
}
function bool(value: unknown) { if (typeof value !== "boolean") throw new InputError("Please enter a valid checkbox value."); return value; }
const quote = (value: string) => `“${value}”`;
const colors = ["violet", "green", "peach", "blue", "yellow", "pink"];
const priorities = ["Low", "Medium", "High"];
const statuses = ["Planning", "In progress", "On hold", "Completed"];
const icons = ["layout", "smartphone", "pen", "code", "book", "megaphone", "heart", "coffee"];

function projectValues(data: Input, partial: boolean) {
  const v: Partial<typeof projects.$inferInsert> = {};
  if (!partial || "name" in data) v.name = text(data.name, "project name", 100, true);
  if (!partial || "description" in data) v.description = text(data.description, "description", 4000);
  if (!partial || "category" in data) v.category = text(data.category ?? "Personal", "category", 50) || "Personal";
  if (!partial || "status" in data) v.status = choice(data.status, statuses, "Planning");
  if (!partial || "priority" in data) v.priority = choice(data.priority, priorities, "Medium");
  if (!partial || "color" in data) v.color = choice(data.color, colors, "violet");
  if (!partial || "icon" in data) v.icon = choice(data.icon, icons, "layout");
  if (!partial || "startDate" in data) v.startDate = date(data.startDate);
  if (!partial || "dueDate" in data) v.dueDate = date(data.dueDate);
  if ("favorite" in data) v.favorite = bool(data.favorite);
  if ("archived" in data) v.archived = bool(data.archived);
  return v;
}
function assertDateOrder(start: string | null | undefined, due: string | null | undefined) {
  if (start && due && start > due) throw new InputError("The start date needs to be on or before the due date.");
}
async function ownedProject(userId: string, id: unknown) {
  if (typeof id !== "string" || !uuid.test(id)) throw new InputError("Select a valid project.");
  const [p] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.id, id), eq(projects.userId, userId))).limit(1);
  if (!p) throw new InputError("That project is not in your workspace.");
  return p;
}
function labelList(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError("Labels must be a list.");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") throw new InputError("Each label must be text.");
    const label = raw.trim().replace(/^#+/, "").replace(/\s+/g, "-");
    if (!label) continue;
    if (label.length > 24) throw new InputError("Labels must be 24 characters or fewer.");
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  if (out.length > 8) throw new InputError("Use up to 8 labels per task.");
  return out;
}
function estimate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 43_200) throw new InputError("Estimated duration must be between 1 minute and 30 days.");
  return value;
}
async function taskValues(data: Input, partial: boolean, userId: string, existing?: TaskRow) {
  const v: Partial<typeof tasks.$inferInsert> = {};
  if (!partial || "title" in data) v.title = text(data.title, "task title", 200, true);
  if (!partial || "description" in data) v.description = text(data.description, "description", 4000);
  if (!partial || "notes" in data) v.notes = text(data.notes, "notes", 8000);
  if (!partial || "priority" in data) v.priority = choice(data.priority, TASK_PRIORITIES, "Medium");
  if (!partial || "startDate" in data) v.startDate = date(data.startDate);
  if (!partial || "dueDate" in data) v.dueDate = date(data.dueDate);
  if (!partial || "labels" in data) v.labels = labelList(data.labels);
  if (!partial || "estimateMinutes" in data) v.estimateMinutes = estimate(data.estimateMinutes);
  // Workflow status is the source of truth; `completed` always mirrors it.
  if (data.status !== undefined) {
    v.status = choice(data.status, TASK_STATUSES, "todo");
    v.completed = v.status === "done";
  } else if (data.completed !== undefined) {
    v.completed = bool(data.completed);
    v.status = v.completed ? "done" : existing && existing.status !== "done" ? existing.status : "todo";
  } else if (!partial) {
    v.status = "todo";
    v.completed = false;
  }
  if (v.completed !== undefined) v.completedAt = v.completed ? (existing?.completed && existing.completedAt ? existing.completedAt : new Date()) : null;
  if (!partial || "projectId" in data) v.projectId = data.projectId ? (await ownedProject(userId, data.projectId)).id : null;
  const projectId = "projectId" in v ? v.projectId ?? null : existing?.projectId ?? null;
  if (!partial || "milestoneId" in data) {
    if (!data.milestoneId) v.milestoneId = null;
    else {
      if (typeof data.milestoneId !== "string" || !uuid.test(data.milestoneId)) throw new InputError("Select a valid milestone.");
      const [m] = await db.select({ id: milestones.id, projectId: milestones.projectId }).from(milestones).where(and(eq(milestones.id, data.milestoneId), eq(milestones.userId, userId))).limit(1);
      if (!m) throw new InputError("That milestone is not in your workspace.");
      if (m.projectId !== projectId) throw new InputError("Choose a milestone from the same project.");
      v.milestoneId = m.id;
    }
  } else if ("projectId" in v && existing?.milestoneId && v.projectId !== existing.projectId) {
    // Moving a task to another project detaches it from the old project's milestone.
    v.milestoneId = null;
  }
  assertDateOrder("startDate" in v ? v.startDate : existing?.startDate, "dueDate" in v ? v.dueDate : existing?.dueDate);
  return v;
}
function subtaskTitles(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError("Subtasks must be a list.");
  const titles = value.map((entry) => text(entry, "subtask", 200, true));
  if (titles.length > 50) throw new InputError("Add up to 50 subtasks at a time.");
  return titles;
}
function ideaValues(data: Input, partial: boolean) {
  const v: Partial<typeof ideas.$inferInsert> = {};
  if (!partial || "title" in data) v.title = text(data.title, "idea title", 100, true);
  if (!partial || "description" in data) v.description = text(data.description, "description", 4000);
  if (!partial || "category" in data) v.category = text(data.category ?? "Personal", "category", 50);
  if (!partial || "color" in data) v.color = choice(data.color, colors, "yellow");
  if (!partial || "status" in data) v.status = choice(data.status, ["Just an idea", "Exploring", "Ready to start"], "Just an idea");
  return v;
}
async function milestoneValues(data: Input, partial: boolean, userId: string) {
  const v: Partial<typeof milestones.$inferInsert> = {};
  if (!partial || "title" in data) v.title = text(data.title, "milestone title", 120, true);
  if (!partial || "description" in data) v.description = text(data.description, "description", 2000);
  if (!partial || "dueDate" in data) v.dueDate = date(data.dueDate);
  if ("completed" in data) { v.completed = bool(data.completed); v.completedAt = v.completed ? new Date() : null; }
  if (!partial) v.projectId = (await ownedProject(userId, data.projectId)).id;
  return v;
}

function describeProjectChange(before: typeof projects.$inferSelect, after: typeof projects.$inferSelect, changed: string[]) {
  const name = quote(after.name);
  if (changed.length === 1) {
    const [key] = changed;
    if (key === "status") return `Moved ${name} to ${statusLabel(after.status)}`;
    if (key === "archived") return after.archived ? `Archived ${name}` : `Restored ${name} from the archive`;
    if (key === "favorite") return after.favorite ? `Starred ${name}` : `Unstarred ${name}`;
    if (key === "name") return `Renamed ${quote(before.name)} to ${name}`;
    if (key === "priority") return `Set ${name} to ${after.priority.toLowerCase()} priority`;
    if (key === "dueDate") return after.dueDate ? `Moved the deadline of ${name} to ${formatDate(after.dueDate)}` : `Cleared the deadline of ${name}`;
  }
  if (changed.includes("status")) return `Updated ${name} · now ${statusLabel(after.status)}`;
  return `Updated the details of ${name}`;
}

async function handleProjects(method: Method, userId: string, id: string, data: Input): Promise<Outcome> {
  const condition = and(eq(projects.id, id), eq(projects.userId, userId));
  if (method === "POST") {
    const values = projectValues(data, false);
    assertDateOrder(values.startDate, values.dueDate);
    const [item] = await db.insert(projects).values({ ...values, name: values.name!, userId }).returning();
    return { item, log: item ? { text: `Created project ${quote(item.name)}`, type: "project", projectId: item.id } : null, touch: [] };
  }
  if (method === "DELETE") {
    const [item] = await db.delete(projects).where(condition).returning();
    if (item) await emitProjectMutationNotifications(userId, item, null).catch(() => {});
    return { item, log: item ? { text: `Deleted project ${quote(item.name)}`, type: "project", projectId: null } : null, touch: [] };
  }
  const values = projectValues(data, true);
  if (!Object.keys(values).length) throw new InputError("No changes to save.");
  const [before] = await db.select().from(projects).where(condition).limit(1);
  if (!before) throw new NotFoundError();
  assertDateOrder("startDate" in values ? values.startDate : before.startDate, "dueDate" in values ? values.dueDate : before.dueDate);
  const changed = (Object.keys(values) as (keyof typeof values)[]).filter(key => (values[key] ?? null) !== (before[key as keyof typeof before] ?? null));
  if (changed.some(key => key !== "favorite")) values.updatedAt = new Date();
  const [item] = await db.update(projects).set(values).where(condition).returning();
  if (item && changed.length) {
    await emitProjectMutationNotifications(userId, before, item).catch(() => {});
    if (changed.includes("dueDate") && item.dueDate) {
      await processUserReminders(userId).catch(() => {});
    }
  }
  return { item, log: item && changed.length ? { text: describeProjectChange(before, item, changed), type: "project", projectId: item.id } : null, touch: [] };
}

function describeTaskChange(before: TaskRow, after: TaskRow, changed: string[]): Log {
  const name = quote(after.title);
  const base = { projectId: after.projectId, taskId: after.id };
  const only = (...keys: string[]) => changed.length > 0 && changed.every((key) => keys.includes(key));
  if (changed.includes("status") && before.status !== after.status) {
    if (after.status === "done") return { ...base, type: "complete", text: `Completed ${name}` };
    if (before.status === "done") return { ...base, type: "task", text: `Reopened ${name} · ${TASK_STATUS_LABELS[after.status as TaskStatus]}` };
    if (only("status", "completed", "completedAt")) return { ...base, type: "task", text: `Moved ${name} to ${TASK_STATUS_LABELS[after.status as TaskStatus]}` };
  }
  if (only("priority")) return { ...base, type: "task", text: after.priority === "None" ? `Cleared the priority of ${name}` : `Set ${name} to ${TASK_PRIORITY_LABELS[after.priority as TaskPriority].toLowerCase()} priority` };
  if (only("dueDate")) return { ...base, type: "task", text: after.dueDate ? `Rescheduled ${name} to ${formatDate(after.dueDate)}` : `Cleared the due date of ${name}` };
  if (only("title")) return { ...base, type: "task", text: `Renamed ${quote(before.title)} to ${name}` };
  if (only("labels")) return { ...base, type: "task", text: after.labels.length ? `Labelled ${name} ${after.labels.map((label) => `#${label}`).join(" ")}` : `Removed the labels from ${name}` };
  if (only("projectId", "milestoneId") && changed.includes("projectId")) return { ...base, type: "task", text: after.projectId ? `Moved ${name} to another project` : `Removed ${name} from its project` };
  if (only("milestoneId")) return { ...base, type: "task", text: after.milestoneId ? `Linked ${name} to a milestone` : `Unlinked ${name} from its milestone` };
  return { ...base, type: "task", text: `Updated ${name}` };
}

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value, index) => value === b[index]) : (a ?? null) === (b ?? null));

async function handleTasks(method: Method, userId: string, id: string, data: Input): Promise<Outcome> {
  const condition = and(eq(tasks.id, id), eq(tasks.userId, userId));
  if (method === "POST") {
    const values = await taskValues(data, false, userId);
    const titles = subtaskTitles(data.subtasks);
    const created = await db.transaction(async (tx) => {
      const [item] = await tx.insert(tasks).values({ ...values, title: values.title!, labels: values.labels ?? [], userId }).returning();
      const steps = item && titles.length ? await tx.insert(subtasks).values(titles.map((title, position) => ({ userId, taskId: item.id, title, position }))).returning() : [];
      return { item, steps };
    });
    const item = created.item;
    if (!item) return { item, log: null, touch: [] };
    if ("reminder" in data && data.reminder && typeof data.reminder === "object" && !Array.isArray(data.reminder)) {
      const rem = data.reminder as Record<string, unknown>;
      if (rem.enabled === true) {
        await upsertTaskReminder(userId, {
          taskId: item.id,
          enabled: true,
          timing: typeof rem.timing === "string" ? rem.timing : "1h_before",
          dueTime: typeof rem.dueTime === "string" ? rem.dueTime : null,
          customLocal: typeof rem.customLocal === "string" ? rem.customLocal : null,
        }).catch(() => {});
      }
    } else if (!("reminder" in data) && item.dueDate && !item.completed) {
      // Quick-added tasks with a due date inherit the user's default reminder timing.
      const prefs = await getOrCreatePreferences(userId).catch(() => null);
      if (prefs && prefs.defaultReminderTiming !== "none") {
        await upsertTaskReminder(userId, {
          taskId: item.id,
          enabled: true,
          timing: prefs.defaultReminderTiming,
          dueTime: prefs.defaultDueTime,
          customLocal: null,
        }).catch(() => {});
      }
    }
    if (item.dueDate && !item.completed) {
      await processUserReminders(userId).catch(() => {});
    }
    const project = item.projectId ? await ownedProject(userId, item.projectId) : null;
    const extra = created.steps.length ? ` with ${created.steps.length} subtask${created.steps.length === 1 ? "" : "s"}` : "";
    return { item, log: { text: project ? `Added ${quote(item.title)} to ${quote(project.name)}${extra}` : `Added ${quote(item.title)}${extra}`, type: "task", projectId: item.projectId, taskId: item.id }, touch: item.projectId ? [item.projectId] : [], subtasks: created.steps };
  }
  if (method === "DELETE") {
    const [item] = await db.delete(tasks).where(condition).returning();
    if (item) await reconcileTaskLifecycle(userId, item, null).catch(() => {});
    // taskId stays null: the row is gone, the history entry survives in the feed.
    return { item, log: item ? { text: `Deleted task ${quote(item.title)}`, type: "task", projectId: item.projectId, taskId: null } : null, touch: item?.projectId ? [item.projectId] : [] };
  }
  const [before] = await db.select().from(tasks).where(condition).limit(1);
  if (!before) throw new NotFoundError();
  const values = await taskValues(data, true, userId, before);
  if (!Object.keys(values).length) throw new InputError("No changes to save.");
  const changed = Object.keys(values).filter((key) => !same(values[key as keyof typeof values], before[key as keyof TaskRow]));
  if (changed.length) values.updatedAt = new Date();
  const [item] = await db.update(tasks).set(values).where(condition).returning();
  if (!item) return { item, log: null, touch: [] };
  if (changed.length) {
    await reconcileTaskLifecycle(userId, before, item).catch(() => {});
    if (changed.includes("dueDate") && item.dueDate && !item.completed) {
      await processUserReminders(userId).catch(() => {});
    }
  }
  return { item, log: changed.length ? describeTaskChange(before, item, changed) : null, touch: changed.length ? [before.projectId, item.projectId].filter((value): value is string => Boolean(value)) : [] };
}

async function ownedTask(userId: string, id: unknown) {
  if (typeof id !== "string" || !uuid.test(id)) throw new InputError("Select a valid task.");
  const [t] = await db.select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId))).limit(1);
  if (!t) throw new InputError("That task is not in your workspace.");
  return t;
}

async function handleSubtasks(method: Method, userId: string, id: string, data: Input): Promise<Outcome> {
  const condition = and(eq(subtasks.id, id), eq(subtasks.userId, userId));
  if (method === "POST") {
    const parent = await ownedTask(userId, data.taskId);
    const title = text(data.title, "subtask", 200, true);
    const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${subtasks.position}), -1) + 1` }).from(subtasks).where(eq(subtasks.taskId, parent.id));
    const [item] = await db.insert(subtasks).values({ userId, taskId: parent.id, title, position: Number(next) || 0 }).returning();
    return { item, log: item ? { text: `Added the subtask ${quote(item.title)} to ${quote(parent.title)}`, type: "subtask", projectId: parent.projectId, taskId: parent.id } : null, touch: parent.projectId ? [parent.projectId] : [], touchTasks: [parent.id] };
  }
  const [before] = await db.select().from(subtasks).where(condition).limit(1);
  if (!before) throw new NotFoundError();
  const parent = await ownedTask(userId, before.taskId);
  const scope = { touch: parent.projectId ? [parent.projectId] : [], touchTasks: [parent.id] };
  if (method === "DELETE") {
    const [item] = await db.delete(subtasks).where(condition).returning();
    return { item, log: item ? { text: `Removed the subtask ${quote(item.title)} from ${quote(parent.title)}`, type: "subtask", projectId: parent.projectId, taskId: parent.id } : null, ...scope };
  }
  const values: Partial<typeof subtasks.$inferInsert> = {};
  if ("title" in data) values.title = text(data.title, "subtask", 200, true);
  if ("completed" in data) { values.completed = bool(data.completed); values.completedAt = values.completed ? before.completedAt ?? new Date() : null; }
  if ("position" in data) {
    if (typeof data.position !== "number" || !Number.isInteger(data.position) || data.position < 0 || data.position > 100_000) throw new InputError("Invalid position.");
    values.position = data.position;
  }
  if (!Object.keys(values).length) throw new InputError("No changes to save.");
  const [item] = await db.update(subtasks).set(values).where(condition).returning();
  const toggled = item && values.completed !== undefined && before.completed !== item.completed;
  return { item, log: toggled ? { text: item.completed ? `Checked off ${quote(item.title)} in ${quote(parent.title)}` : `Unchecked ${quote(item.title)} in ${quote(parent.title)}`, type: "subtask", projectId: parent.projectId, taskId: parent.id } : null, ...scope };
}

const BULK_FIELDS = ["status", "completed", "priority", "projectId", "dueDate"];

/** One transaction for many tasks: either every change lands, or none does. */
async function bulkTasks(method: Method, userId: string, rawIds: unknown[], data: Input) {
  if (method === "POST") throw new InputError("Bulk create isn’t supported.");
  const ids = [...new Set(rawIds)];
  if (!ids.length || ids.length > 500) throw new InputError("Select between 1 and 500 tasks.");
  if (!ids.every((value): value is string => typeof value === "string" && uuid.test(value))) throw new InputError("Invalid task selection.");
  const unknownKeys = Object.keys(data).filter((key) => !BULK_FIELDS.includes(key));
  if (method === "PATCH" && unknownKeys.length) throw new InputError(`These fields can’t be changed in bulk: ${unknownKeys.join(", ")}.`);
  return db.transaction(async (tx) => {
    const owned = await tx.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)));
    if (!owned.length) throw new NotFoundError();
    const ownedIds = owned.map((row) => row.id);
    const where = and(eq(tasks.userId, userId), inArray(tasks.id, ownedIds));
    const n = owned.length;
    const plural = `${n} task${n === 1 ? "" : "s"}`;
    let log: Log;
    let items: TaskRow[] = [];
    let deleted: string[] = [];
    const touch = new Set(owned.map((row) => row.projectId).filter((value): value is string => Boolean(value)));
    if (method === "DELETE") {
      deleted = (await tx.delete(tasks).where(where).returning({ id: tasks.id })).map((row) => row.id);
      log = { text: `Deleted ${plural}`, type: "task", projectId: null, taskId: null };
    } else {
      const set: PgUpdateSetSource<typeof tasks> = {};
      const parts: string[] = [];
      let type = "task";
      if (data.status !== undefined || data.completed === true) {
        const status = data.status !== undefined ? choice(data.status, TASK_STATUSES, "todo") : "done";
        set.status = status;
        set.completed = status === "done";
        set.completedAt = status === "done" ? sql`coalesce(${tasks.completedAt}, now())` : null;
        parts.push(status === "done" ? "Completed" : `Moved to ${TASK_STATUS_LABELS[status as TaskStatus]}`);
        if (status === "done") type = "complete";
      } else if (data.completed === false) {
        set.completed = false;
        set.completedAt = null;
        set.status = sql`CASE WHEN ${tasks.status} = 'done' THEN 'todo' ELSE ${tasks.status} END`;
        parts.push("Reopened");
      } else if (data.completed !== undefined) bool(data.completed);
      if (data.priority !== undefined) { set.priority = choice(data.priority, TASK_PRIORITIES, "Medium"); parts.push(`Set to ${TASK_PRIORITY_LABELS[set.priority as TaskPriority].toLowerCase()} priority`); }
      if ("dueDate" in data) { set.dueDate = date(data.dueDate); parts.push(set.dueDate ? `Rescheduled to ${formatDate(set.dueDate as string)}` : "Cleared due dates"); }
      let target: { id: string; name: string } | null = null;
      if ("projectId" in data) {
        if (data.projectId) {
          if (typeof data.projectId !== "string" || !uuid.test(data.projectId)) throw new InputError("Select a valid project.");
          [target] = await tx.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.id, data.projectId), eq(projects.userId, userId))).limit(1);
          if (!target) throw new InputError("That project is not in your workspace.");
        }
        const targetId = target?.id ?? null;
        set.projectId = targetId;
        // Milestones belong to a project: only tasks that actually change project lose theirs.
        set.milestoneId = sql`CASE WHEN ${tasks.projectId} IS DISTINCT FROM ${targetId}::uuid THEN NULL ELSE ${tasks.milestoneId} END`;
        if (targetId) touch.add(targetId);
        parts.push(target ? `Moved to ${quote(target.name)}` : "Removed from their project");
      }
      if (!parts.length) throw new InputError("No changes to save.");
      set.updatedAt = new Date();
      items = await tx.update(tasks).set(set).where(where).returning();
      log = { text: `${parts.join(" · ")} — ${plural}`, type, projectId: target?.id ?? (touch.size === 1 ? [...touch][0] : null), taskId: n === 1 ? ownedIds[0] : null };
    }
    const [activity] = await tx.insert(activities).values({ userId, ...log }).returning();
    const touched = touch.size ? await tx.update(projects).set({ updatedAt: new Date() }).where(and(eq(projects.userId, userId), inArray(projects.id, [...touch]))).returning() : [];
    return { items, deleted, missing: ids.length - n, activity, projects: touched };
  });
}

async function handleMilestones(method: Method, userId: string, id: string, data: Input): Promise<Outcome> {
  const condition = and(eq(milestones.id, id), eq(milestones.userId, userId));
  if (method === "POST") {
    const values = await milestoneValues(data, false, userId);
    const [item] = await db.insert(milestones).values({ ...values, title: values.title!, projectId: values.projectId!, userId }).returning();
    return { item, log: item ? { text: `Added milestone ${quote(item.title)}`, type: "milestone", projectId: item.projectId } : null, touch: item ? [item.projectId] : [] };
  }
  if (method === "DELETE") {
    const [item] = await db.delete(milestones).where(condition).returning();
    return { item, log: item ? { text: `Removed milestone ${quote(item.title)}`, type: "milestone", projectId: item.projectId } : null, touch: item ? [item.projectId] : [] };
  }
  const [before] = await db.select().from(milestones).where(condition).limit(1);
  if (!before) throw new NotFoundError();
  const values = await milestoneValues(data, true, userId);
  if (!Object.keys(values).length) throw new InputError("No changes to save.");
  const [item] = await db.update(milestones).set(values).where(condition).returning();
  if (!item) return { item, log: null, touch: [] };
  const toggled = typeof data.completed === "boolean" && before.completed !== item.completed;
  await emitMilestoneMutationNotifications(userId, before, item).catch(() => {});
  if (item.dueDate && !item.completed) {
    await processUserReminders(userId).catch(() => {});
  }
  return {
    item,
    log: { text: toggled ? (item.completed ? `Reached milestone ${quote(item.title)}` : `Reopened milestone ${quote(item.title)}`) : `Updated milestone ${quote(item.title)}`, type: "milestone", projectId: item.projectId },
    touch: [item.projectId],
  };
}

async function handleIdeas(method: Method, userId: string, id: string, data: Input): Promise<Outcome> {
  const condition = and(eq(ideas.id, id), eq(ideas.userId, userId));
  if (method === "POST") {
    const values = ideaValues(data, false);
    const [item] = await db.insert(ideas).values({ ...values, title: values.title!, userId }).returning();
    return { item, log: item ? { text: `Captured the idea ${quote(item.title)}`, type: "idea", projectId: null } : null, touch: [] };
  }
  if (method === "DELETE") {
    const [item] = await db.delete(ideas).where(condition).returning();
    return { item, log: item ? { text: `Deleted the idea ${quote(item.title)}`, type: "idea", projectId: null } : null, touch: [] };
  }
  const values = ideaValues(data, true);
  if (!Object.keys(values).length) throw new InputError("No changes to save.");
  const [item] = await db.update(ideas).set(values).where(condition).returning();
  return { item, log: item ? { text: `Updated the idea ${quote(item.title)}`, type: "idea", projectId: null } : null, touch: [] };
}

export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Please sign in to see your workspace." }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const taskActivity = params.get("taskActivity");
    if (taskActivity !== null) {
      if (!uuid.test(taskActivity)) return Response.json({ error: "Invalid task ID." }, { status: 400 });
      const list = await db.select().from(activities).where(and(eq(activities.userId, user.id), eq(activities.taskId, taskActivity))).orderBy(desc(activities.createdAt)).limit(60);
      return Response.json({ activities: list }, { headers: { "Cache-Control": "no-store" } });
    }
    const projectActivity = params.get("projectActivity");
    if (projectActivity !== null) {
      if (!uuid.test(projectActivity)) return Response.json({ error: "Invalid project ID." }, { status: 400 });
      const list = await db.select().from(activities).where(and(eq(activities.userId, user.id), eq(activities.projectId, projectActivity))).orderBy(desc(activities.createdAt)).limit(60);
      return Response.json({ activities: list }, { headers: { "Cache-Control": "no-store" } });
    }
    const [projectList, taskList, subtaskList, ideaList, milestoneList, activityList, [regional]] = await Promise.all([
      db.select().from(projects).where(eq(projects.userId, user.id)).orderBy(projects.createdAt),
      db.select().from(tasks).where(eq(tasks.userId, user.id)).orderBy(tasks.createdAt),
      db.select().from(subtasks).where(eq(subtasks.userId, user.id)).orderBy(asc(subtasks.position), asc(subtasks.createdAt)),
      db.select().from(ideas).where(eq(ideas.userId, user.id)).orderBy(desc(ideas.createdAt)),
      db.select().from(milestones).where(eq(milestones.userId, user.id)).orderBy(milestones.dueDate, milestones.createdAt),
      db.select().from(activities).where(eq(activities.userId, user.id)).orderBy(desc(activities.createdAt)).limit(40),
      db.select({ timezone: notificationPreferences.timezone }).from(notificationPreferences).where(eq(notificationPreferences.userId, user.id)).limit(1),
    ]);
    return Response.json({ user: { ...publicUser(user), timezone: regional?.timezone || "UTC" }, projects: projectList, tasks: taskList, subtasks: subtaskList, ideas: ideaList, milestones: milestoneList, activities: activityList }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { console.error("Workspace load failed:", error); return Response.json({ error: "Your workspace couldn’t be loaded. Please try again." }, { status: 500 }); }
}

async function mutate(request: Request, method: Method) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Your session expired. Please refresh and sign in." }, { status: 401 });
    const body = await request.json();
    const { kind, id } = body as { kind: unknown; id: unknown };
    if (typeof kind !== "string" || !KINDS.includes(kind as Kind)) throw new InputError("Unknown resource.");
    if (Array.isArray(body.ids)) {
      if (kind !== "tasks") throw new InputError("Bulk changes are only available for tasks.");
      const bulkData: Input = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
      const bulkOutcome = await bulkTasks(method, user.id, body.ids, bulkData);
      await reconcileBulkTaskLifecycle(
        user.id,
        method === "DELETE" ? bulkOutcome.deleted : bulkOutcome.items.map((t) => t.id),
        method === "DELETE",
      ).catch(() => {});
      return Response.json(bulkOutcome);
    }
    if (method !== "POST" && (typeof id !== "string" || !uuid.test(id))) throw new InputError("Invalid item ID.");
    const data: Input = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};

    const isConvertIdea =
      method === "POST" &&
      kind === "ideas" &&
      (body.action === "convert" || (body.data && typeof body.data === "object" && (body.data as Input).action === "convert"));

    if (isConvertIdea) {
      const ideaId = (typeof id === "string" && uuid.test(id))
        ? id
        : (typeof (body.data as Input)?.id === "string" && uuid.test((body.data as Input).id as string))
          ? (body.data as Input).id as string
          : "";
      if (!ideaId) throw new InputError("Invalid idea ID.");
      const result = await db.transaction(async tx => {
        const [idea] = await tx.select().from(ideas).where(and(eq(ideas.id, ideaId), eq(ideas.userId, user.id))).for("update");
        if (!idea) throw new InputError("That idea no longer exists.");
        const [item] = await tx.insert(projects).values({ userId: user.id, name: idea.title, description: idea.description, category: idea.category, color: idea.color, status: "Planning" }).returning();
        await tx.delete(ideas).where(eq(ideas.id, ideaId));
        const [activity] = await tx.insert(activities).values({ userId: user.id, projectId: item.id, text: `Turned ${quote(idea.title)} into a project`, type: "project" }).returning();
        return { item, activity };
      });
      await emitProjectMutationNotifications(user.id, null, result.item, { convertedFromIdea: true }).catch(() => {});
      return Response.json(result, { status: 201 });
    }

    const itemId = typeof id === "string" ? id : NIL;
    const handler = kind === "projects" ? handleProjects : kind === "tasks" ? handleTasks : kind === "milestones" ? handleMilestones : kind === "subtasks" ? handleSubtasks : handleIdeas;
    const outcome = await handler(method, user.id, itemId, data);
    if (!outcome.item) return Response.json({ error: "This item was not found in your workspace." }, { status: 404 });
    const [activity] = outcome.log ? await db.insert(activities).values({ userId: user.id, ...outcome.log }).returning() : [null];
    // Work inside a project counts as an update to that project ("last updated").
    const touchIds = [...new Set(outcome.touch)];
    const touched = touchIds.length
      ? await db.update(projects).set({ updatedAt: new Date() }).where(and(eq(projects.userId, user.id), inArray(projects.id, touchIds))).returning()
      : [];
    const touchedTasks = outcome.touchTasks?.length
      ? await db.update(tasks).set({ updatedAt: new Date() }).where(and(eq(tasks.userId, user.id), inArray(tasks.id, [...new Set(outcome.touchTasks)]))).returning({ id: tasks.id, updatedAt: tasks.updatedAt })
      : [];
    return Response.json({ item: outcome.item, activity, projects: touched, tasks: touchedTasks, subtasks: outcome.subtasks ?? [] }, { status: method === "POST" ? 201 : 200 });
  } catch (error) {
    if (error instanceof InputError || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return Response.json({ error: "This item was not found in your workspace." }, { status: 404 });
    console.error("Workspace mutation failed:", error);
    return Response.json({ error: "We couldn’t save that change. Please try again." }, { status: 500 });
  }
}
export async function POST(request: Request) { return mutate(request, "POST"); }
export async function PATCH(request: Request) { return mutate(request, "PATCH"); }
export async function DELETE(request: Request) { return mutate(request, "DELETE"); }
