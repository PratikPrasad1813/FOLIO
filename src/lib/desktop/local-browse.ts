"use client";

/**
 * Offline twin of the server's browseWorkspace (src/lib/search-service.ts).
 *
 * In the desktop shell the Projects and Tasks views filter the LOCAL SQLite
 * mirror with exactly the same semantics as /api/workspace/browse: the same
 * status/priority/date/progress predicates, the same "overdue/upcoming
 * exclude Completed projects" rule, the same sort keys with nulls-last, and
 * the same pagination contract. This is what keeps the status overview counts
 * ("All projects: N") and the visible card list in agreement when offline —
 * the class of mismatch where the header said 1 project but the list showed
 * "0 matching projects".
 */

import type { FilterConfig, FilterKind } from "@/lib/search-types";
import type { Project, Task, WorkspaceData } from "@/lib/types";
import { getZonedParts, safeTimezone, shiftDateKey } from "@/lib/timezone";

export interface LocalBrowseResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
  today: string;
}

export type BrowsedLocalProject = Project & { progress: number; taskCount: number; completedTaskCount: number };

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const TASK_STATUS_RANK: Record<string, number> = { todo: 0, in_progress: 1, in_review: 2, done: 3 };

/** Today in the user's own timezone (same rule as the server's workspaceToday). */
export function localToday(timezone?: string): string {
  return getZonedParts(new Date(), safeTimezone(timezone)).dateKey;
}

function weekStartDate(today: string, weekStartDay: number): string {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return shiftDateKey(today, -((weekday - weekStartDay + 7) % 7));
}

/** Date-preset predicate shared with the server's dates() helper. */
function dateMatches(preset: string, value: string | null, today: string, weekStartDay: number): boolean {
  if (!value) return preset === "no_date";
  switch (preset) {
    case "overdue": return value < today;
    case "today": return value === today;
    case "week": {
      const first = weekStartDate(today, weekStartDay);
      return value >= first && value <= shiftDateKey(first, 6);
    }
    case "upcoming": return value >= today && value <= shiftDateKey(today, 7);
    case "no_date": return false;
    default: return true;
  }
}

/**
 * Query matching, mirroring the server's dominant branch: every token must
 * appear (case-insensitively) somewhere in the searchable document. Tokens
 * prefixed with "#" lose their hash, exactly like the server.
 */
function queryMatches(query: string, document: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 20);
  if (!tokens.length) return true;
  const haystack = document.toLowerCase();
  return tokens.every((token) => haystack.includes(token.replace(/^#/, "")));
}

/** Comparator with nulls always last, independent of direction. */
function compareNullable<T>(a: T | null | undefined, b: T | null | undefined, dir: "asc" | "desc"): number {
  const left = a === undefined ? null : a;
  const right = b === undefined ? null : b;
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const order = left < right ? -1 : left > right ? 1 : 0;
  return dir === "asc" ? order : -order;
}

function compareStrings(a: string, b: string, dir: "asc" | "desc"): number {
  const order = a < b ? -1 : a > b ? 1 : 0;
  return dir === "asc" ? order : -order;
}

function paginate<T>(rows: T[], offset: number, limit: number): { items: T[]; total: number; hasMore: boolean } {
  return { items: rows.slice(offset, offset + limit), total: rows.length, hasMore: offset + rows.slice(offset, offset + limit).length < rows.length };
}

/** Progress statistics per project, using the server's exact ratio. */
function projectStats(projectId: string | null, tasks: Task[]): { percent: number; total: number; done: number } {
  const list = projectId ? tasks.filter((task) => task.projectId === projectId) : [];
  const done = list.filter((task) => task.completed).length;
  return { percent: list.length ? Math.round((done / list.length) * 100) : 0, total: list.length, done };
}

/* ------------------------------------------------------------------ */
/* projects                                                            */
/* ------------------------------------------------------------------ */

export function browseLocalProjects(data: WorkspaceData, f: FilterConfig, offset: number, limit: number): LocalBrowseResult<BrowsedLocalProject> {
  const today = localToday(data.user.timezone);
  const weekStartDay = data.user.personal?.weekStart ?? 1;

  const stats = new Map<string, { percent: number; total: number; done: number }>();
  for (const project of data.projects) stats.set(project.id, projectStats(project.id, data.tasks));

  const rows = data.projects
    .filter((project) => project.archived === f.archived)
    .filter((project) => !f.statuses.length || f.statuses.includes(project.status))
    .filter((project) => !f.priorities.length || f.priorities.includes(project.priority))
    .filter((project) => !f.q || queryMatches(f.q, `${project.name} ${project.description} ${project.category}`))
    .filter((project) => !f.from || (project.dueDate ?? "") >= f.from)
    .filter((project) => !f.to || (project.dueDate ?? "") <= f.to)
    .filter((project) => !f.startFrom || (project.startDate ?? "") >= f.startFrom)
    .filter((project) => !f.startTo || (project.startDate ?? "") <= f.startTo)
    .filter((project) => f.progressMin === null || (stats.get(project.id)?.percent ?? 0) >= f.progressMin)
    .filter((project) => f.progressMax === null || (stats.get(project.id)?.percent ?? 0) <= f.progressMax)
    // "Overdue"/"upcoming" never include completed projects.
    .filter((project) => !["overdue", "upcoming"].includes(f.deadline) || project.status !== "Completed")
    .filter((project) => f.deadline === "all" ? true : dateMatches(f.deadline, project.dueDate, today, weekStartDay));

  const dir = f.dir;
  const sorted = [...rows].sort((a, b) => {
    const stat = (project: Project) => stats.get(project.id)?.percent ?? 0;
    switch (f.sort) {
      case "name": return compareStrings(a.name.toLowerCase(), b.name.toLowerCase(), dir) || a.id.localeCompare(b.id);
      case "priority": return (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4) || a.id.localeCompare(b.id);
      case "created": return compareNullable(a.createdAt, b.createdAt, dir) || a.id.localeCompare(b.id);
      case "due": return compareNullable(a.dueDate, b.dueDate, dir) || a.id.localeCompare(b.id);
      case "progress": return (dir === "asc" ? 1 : -1) * (stat(a) - stat(b)) || a.id.localeCompare(b.id);
      case "updated":
      default: return compareNullable(a.updatedAt || a.createdAt, b.updatedAt || b.createdAt, dir) || a.id.localeCompare(b.id);
    }
  });

  const page = paginate(sorted, offset, limit);
  return {
    items: page.items.map((project) => {
      const entry = stats.get(project.id) ?? projectStats(project.id, data.tasks);
      return { ...project, progress: entry.percent, taskCount: entry.total, completedTaskCount: entry.done };
    }),
    total: page.total,
    hasMore: page.hasMore,
    offset,
    limit,
    today,
  };
}

/* ------------------------------------------------------------------ */
/* tasks                                                               */
/* ------------------------------------------------------------------ */

export function browseLocalTasks(data: WorkspaceData, f: FilterConfig, offset: number, limit: number): LocalBrowseResult<Task> {
  const today = localToday(data.user.timezone);
  const projectName = new Map(data.projects.map((project) => [project.id, project.name.toLowerCase()]));

  const rows = data.tasks
    .filter((task) => !f.statuses.length || f.statuses.includes(task.status))
    .filter((task) => !f.priorities.length || f.priorities.includes(task.priority))
    .filter((task) => {
      if (!f.projects.length) return true;
      const wantsNone = f.projects.includes("none");
      const wanted = f.projects.filter((id) => id !== "none");
      if (wantsNone && task.projectId === null) return true;
      return task.projectId !== null && wanted.includes(task.projectId);
    })
    .filter((task) => {
      if (!f.labels.length) return true;
      const lower = task.labels.map((label) => label.toLowerCase());
      return f.labels.every((label) => lower.includes(label.toLowerCase()));
    })
    .filter((task) => !f.from || (task.dueDate ?? "") >= f.from)
    .filter((task) => !f.to || (task.dueDate ?? "") <= f.to)
    .filter((task) => !f.startFrom || (task.startDate ?? "") >= f.startFrom)
    .filter((task) => !f.startTo || (task.startDate ?? "") <= f.startTo)
    .filter((task) => {
      if (["todo", "in_progress", "in_review", "done"].includes(f.focus)) return task.status === f.focus;
      if (f.focus === "overdue") return !task.completed && task.dueDate !== null && task.dueDate < today;
      if (f.focus === "today") return task.dueDate === today;
      if (f.focus === "week") return task.dueDate !== null && dateMatches("week", task.dueDate, today, data.user.personal?.weekStart ?? 1);
      if (f.focus === "upcoming") return task.dueDate !== null && task.dueDate > today;
      if (f.focus === "no_date") return task.dueDate === null;
      return true;
    })
    .filter((task) => f.deadline === "all" ? true : (f.deadline === "overdue" ? !task.completed : true) && dateMatches(f.deadline, task.dueDate, today, data.user.personal?.weekStart ?? 1))
    .filter((task) => !f.q || queryMatches(f.q, `${task.title} ${task.description} ${task.notes} ${task.projectId ? projectName.get(task.projectId) ?? "" : ""} ${task.labels.map((label) => `#${label}`).join(" ")}`));

  const dir = f.dir;
  const sorted = [...rows].sort((a, b) => {
    const tiebreak = a.id.localeCompare(b.id);
    switch (f.sort) {
      case "title": return compareStrings(a.title.toLowerCase(), b.title.toLowerCase(), dir) || tiebreak;
      case "priority": return (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4) || tiebreak;
      case "status": return (TASK_STATUS_RANK[a.status] ?? 3) - (TASK_STATUS_RANK[b.status] ?? 3) || tiebreak;
      case "due": return compareNullable(a.dueDate, b.dueDate, dir) || tiebreak;
      case "created": return compareNullable(a.createdAt, b.createdAt, dir) || tiebreak;
      case "updated": return compareNullable(a.updatedAt, b.updatedAt, dir) || tiebreak;
      case "project": return compareStrings(a.projectId ? projectName.get(a.projectId) ?? "" : "", b.projectId ? projectName.get(b.projectId) ?? "" : "", dir) || tiebreak;
      case "smart":
      default: {
        // Not completed first, then due date, then priority.
        const completed = Number(a.completed) - Number(b.completed);
        if (completed !== 0) return completed;
        const due = compareNullable(a.dueDate, b.dueDate, "asc");
        if (due !== 0) return due;
        const priority = (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4);
        return priority !== 0 ? priority : tiebreak;
      }
    }
  });

  const page = paginate(sorted, offset, limit);
  return { items: page.items, total: page.total, hasMore: page.hasMore, offset, limit, today };
}

export function browseLocal<T extends { id: string }>(kind: FilterKind, data: WorkspaceData, f: FilterConfig, offset: number, limit: number): LocalBrowseResult<T> {
  return (kind === "tasks" ? browseLocalTasks(data, f, offset, limit) : browseLocalProjects(data, f, offset, limit)) as unknown as LocalBrowseResult<T>;
}
