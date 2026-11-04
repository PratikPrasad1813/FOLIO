import { regionalPreferences } from "@/lib/personalization";
// Pure task-domain helpers shared by every task surface. No React in here.
import { dateKey, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type Project, type Subtask, type Task, type TaskPriority, type TaskStatus } from "@/lib/types";

/** Drag payload type for tasks (board columns and calendar days). */
export const TASK_DRAG_TYPE = "application/x-folio-task";
export const isTaskDrag = (event: { dataTransfer: DataTransfer }) => Array.from(event.dataTransfer.types).includes(TASK_DRAG_TYPE);

export const PRIORITY_RANK: Record<TaskPriority, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3, None: 4 };
export const STATUS_RANK: Record<TaskStatus, number> = { todo: 0, in_progress: 1, in_review: 2, done: 3 };
export const statusLabel = (status: TaskStatus) => TASK_STATUS_LABELS[status] ?? status;
export const priorityLabel = (priority: TaskPriority) => TASK_PRIORITY_LABELS[priority] ?? priority;

/** Optimistic patch for a status change. Keeps `completed` in sync, like the API does. */
export function statusPatch(status: TaskStatus, task?: Pick<Task, "completed" | "completedAt">) {
  const done = status === "done";
  return { status, completed: done, completedAt: done ? (task?.completed && task.completedAt ? task.completedAt : new Date().toISOString()) : null };
}

/** Optimistic patch for ticking a task on/off. Reopened tasks go back to "To do". */
export function completionPatch(done: boolean, task?: Pick<Task, "status" | "completed" | "completedAt">) {
  return statusPatch(done ? "done" : task && task.status !== "done" ? task.status : "todo", task);
}

export function isOverdue(task: Pick<Task, "completed" | "dueDate">, today: string = dateKey()) {
  return !task.completed && !!task.dueDate && task.dueDate < today;
}

export function addDays(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0,10);
}

/** Monday of the week containing `key` (weeks start on Monday across Folio). */
export function weekStart(key: string) {
  const date = new Date(`${key}T12:00:00Z`);
  return addDays(key, -((date.getUTCDay() - regionalPreferences().weekStart + 7) % 7));
}

export type TaskFocus = "all" | "todo" | "in_progress" | "in_review" | "done" | "overdue" | "today" | "week" | "upcoming" | "no_date";

/** The primary filter. Status presets match the workflow; date presets match on due date only. */
export function matchesFocus(task: Task, focus: TaskFocus, today: string) {
  switch (focus) {
    case "all": return true;
    case "todo": case "in_progress": case "in_review": case "done": return task.status === focus;
    case "overdue": return isOverdue(task, today);
    case "today": return task.dueDate === today;
    case "week": return !!task.dueDate && task.dueDate >= weekStart(today) && task.dueDate <= addDays(weekStart(today), 6);
    case "upcoming": return !!task.dueDate && task.dueDate > today;
    case "no_date": return !task.dueDate;
  }
}

export function subtaskStats(taskId: string, subtasks: Subtask[]) {
  let total = 0, done = 0;
  for (const subtask of subtasks) if (subtask.taskId === taskId) { total++; if (subtask.completed) done++; }
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

export type TaskSortKey = "smart" | "title" | "status" | "priority" | "project" | "due" | "updated" | "created";

export function compareTasks(a: Task, b: Task, key: TaskSortKey, projectName: (id: string | null) => string) {
  const due = (task: Task) => task.dueDate || "9999-12-31";
  switch (key) {
    case "title": return a.title.localeCompare(b.title);
    case "status": return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    case "priority": return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    case "project": return projectName(a.projectId).localeCompare(projectName(b.projectId));
    case "due": return due(a).localeCompare(due(b));
    case "updated": return (a.updatedAt || a.createdAt).localeCompare(b.updatedAt || b.createdAt);
    case "created": return a.createdAt.localeCompare(b.createdAt);
    case "smart":
    default:
      return Number(a.completed) - Number(b.completed) || due(a).localeCompare(due(b)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt.localeCompare(b.createdAt);
  }
}

const LABEL_TONES = ["violet", "blue", "green", "amber", "pink", "teal", "peach", "slate"] as const;
/** Stable colour for a label name, so the same label looks the same everywhere. */
export function labelTone(label: string) {
  let hash = 0;
  for (const char of label.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return LABEL_TONES[Math.abs(hash) % LABEL_TONES.length];
}

export function normaliseLabel(raw: string) {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").slice(0, 24);
}

export const ESTIMATE_PRESETS = [15, 30, 60, 120, 240, 480];
export function formatEstimate(minutes: number | null | undefined) {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/* ------------------------------------------------------------------ */
/* Quick add: "Email Sam tomorrow !high #client @mobile"               */
/* ------------------------------------------------------------------ */

const PRIORITY_TOKENS: Record<string, TaskPriority> = {
  "!urgent": "Urgent", "!u": "Urgent", "!1": "Urgent",
  "!high": "High", "!h": "High", "!2": "High",
  "!medium": "Medium", "!med": "Medium", "!m": "Medium", "!3": "Medium",
  "!low": "Low", "!l": "Low", "!4": "Low",
  "!none": "None",
};
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface QuickAddToken { kind: "priority" | "label" | "due" | "project"; label: string }
export interface QuickAddResult { title: string; priority?: TaskPriority; labels: string[]; dueDate?: string; projectId?: string; tokens: QuickAddToken[] }

export function parseQuickAdd(input: string, projects: Project[], today: string = dateKey()): QuickAddResult {
  const kept: string[] = [];
  const labels: string[] = [];
  const tokens: QuickAddToken[] = [];
  let priority: TaskPriority | undefined, dueDate: string | undefined, projectId: string | undefined;
  for (const word of input.split(/\s+/).filter(Boolean)) {
    const lower = word.toLowerCase();
    if (!priority && PRIORITY_TOKENS[lower]) { priority = PRIORITY_TOKENS[lower]; tokens.push({ kind: "priority", label: priorityLabel(priority) }); continue; }
    if (/^#[\p{L}\p{N}_-]{1,24}$/u.test(word) && labels.length < 8) {
      const label = normaliseLabel(word);
      if (!labels.some((entry) => entry.toLowerCase() === label.toLowerCase())) { labels.push(label); tokens.push({ kind: "label", label: `#${label}` }); }
      continue;
    }
    if (!projectId && /^@[\p{L}\p{N}_-]+$/u.test(word)) {
      const query = lower.slice(1);
      const live = projects.filter((project) => !project.archived);
      const squash = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      const exact = live.filter((project) => squash(project.name) === query);
      const matches = exact.length ? exact : live.filter((project) => squash(project.name).startsWith(query) || project.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(query)));
      if (matches.length === 1) { projectId = matches[0].id; tokens.push({ kind: "project", label: matches[0].name }); continue; }
    }
    if (!dueDate) {
      let offset: number | null = null;
      if (lower === "today") offset = 0;
      else if (lower === "tomorrow" || lower === "tmrw") offset = 1;
      else if (WEEKDAYS.includes(lower)) offset = (WEEKDAYS.indexOf(lower) - new Date(`${today}T12:00:00`).getDay() + 7) % 7;
      if (offset !== null) {
        dueDate = addDays(today, offset);
        tokens.push({ kind: "due", label: offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : new Date(`${dueDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) });
        continue;
      }
    }
    kept.push(word);
  }
  return { title: kept.join(" ").trim(), priority, labels, dueDate, projectId, tokens };
}
