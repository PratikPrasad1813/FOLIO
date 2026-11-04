import { PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES, type Idea, type Project, type Task } from "@/lib/types";

export type SearchKind = "projects" | "tasks" | "ideas";
export type FilterKind = "projects" | "tasks";
export type SearchScope = "all" | SearchKind;
export const SEARCH_SCOPES: SearchScope[] = ["all", "projects", "tasks", "ideas"];
export const SEARCH_LABELS: Record<SearchScope, string> = { all: "Everything", projects: "Projects", tasks: "Tasks", ideas: "Ideas" };
export const DATE_PRESETS = ["all", "overdue", "today", "week", "upcoming", "no_date"] as const;
export type DatePreset = typeof DATE_PRESETS[number];
export const DATE_PRESET_LABELS: Record<DatePreset, string> = { all: "Any deadline", overdue: "Overdue", today: "Due today", week: "Due this week", upcoming: "Next 7 days", no_date: "No deadline" };
export const TASK_FOCUS = ["all", ...TASK_STATUSES, "overdue", "today", "week", "upcoming", "no_date"] as const;
export const TASK_SORTS = ["smart", "title", "status", "priority", "project", "due", "updated", "created"];
export const PROJECT_SORTS = ["updated", "created", "due", "priority", "name", "progress"];
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Versioned, portable view configuration. No user IDs or arbitrary SQL fields. */
export interface FilterConfig {
  version: 1;
  q: string;
  statuses: string[];
  priorities: string[];
  projects: string[];
  labels: string[];
  focus: typeof TASK_FOCUS[number];
  from: string;
  to: string;
  startFrom: string;
  startTo: string;
  deadline: DatePreset;
  progressMin: number | null;
  progressMax: number | null;
  archived: boolean;
  sort: string;
  dir: "asc" | "desc";
}
export const defaultFilters = (kind: FilterKind): FilterConfig => ({ version: 1, q: "", statuses: [], priorities: [], projects: [], labels: [], focus: "all", from: "", to: "", startFrom: "", startTo: "", deadline: "all", progressMin: null, progressMax: null, archived: false, sort: kind === "tasks" ? "smart" : "updated", dir: kind === "tasks" ? "asc" : "desc" });

export class SearchInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function objectInput(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SearchInputError("Please provide a valid object.");
  return raw as Record<string, unknown>;
}
export function queryText(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 200 || /[\u0000-\u001f]/.test(raw)) throw new SearchInputError("Search must be text, up to 200 characters.");
  return raw.trim().replace(/\s+/g, " ");
}
export function filterKind(raw: unknown): FilterKind {
  if (raw !== "projects" && raw !== "tasks") throw new SearchInputError("Choose Projects or Tasks.");
  return raw;
}
export function searchScope(raw: unknown): SearchScope {
  if (!SEARCH_SCOPES.includes(raw as SearchScope)) throw new SearchInputError("Unknown search category.");
  return raw as SearchScope;
}
export function validDay(raw: unknown): string {
  if (raw === undefined || raw === "") return "";
  if (typeof raw !== "string" || !/^(19[7-9]\d|2[01]\d\d)-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString().slice(0, 10) !== raw) throw new SearchInputError("Enter a valid calendar date.");
  return raw;
}
function list(raw: unknown, name: string, allowed?: readonly string[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 30 || raw.some(v => typeof v !== "string" || !v.trim() || v.length > 80 || /[\u0000-\u001f]/.test(v) || (allowed && !allowed.includes(v)))) throw new SearchInputError(`Invalid ${name} filter.`);
  return [...new Set(raw as string[])].sort();
}
export function parseFilters(kind: FilterKind, raw: unknown): FilterConfig {
  const input = objectInput(raw);
  const base = defaultFilters(kind);
  if (Object.keys(input).some(key => !Object.hasOwn(base, key))) throw new SearchInputError("Unknown filter field.");
  if (input.version !== undefined && input.version !== 1) throw new SearchInputError("This saved filter version is not supported.");
  const out: FilterConfig = {
    ...base,
    q: queryText(input.q ?? ""),
    statuses: list(input.statuses, "status", kind === "tasks" ? TASK_STATUSES : PROJECT_STATUSES),
    priorities: list(input.priorities, "priority", kind === "tasks" ? TASK_PRIORITIES : ["High", "Medium", "Low"]),
    projects: list(input.projects, "project"), labels: list(input.labels, "label").map(s => s.toLowerCase()),
    from: validDay(input.from), to: validDay(input.to), startFrom: validDay(input.startFrom), startTo: validDay(input.startTo),
  };
  if (out.projects.some(id => id !== "none" && !UUID_PATTERN.test(id))) throw new SearchInputError("Invalid project ID.");
  if (out.labels.some(label => label.length > 24)) throw new SearchInputError("Labels must be at most 24 characters.");
  if (input.focus !== undefined) {
    if (!(TASK_FOCUS as readonly unknown[]).includes(input.focus)) throw new SearchInputError("Invalid task focus.");
    out.focus = input.focus as FilterConfig["focus"];
  }
  if (input.deadline !== undefined) {
    if (!(DATE_PRESETS as readonly unknown[]).includes(input.deadline)) throw new SearchInputError("Invalid deadline filter.");
    out.deadline = input.deadline as DatePreset;
  }
  if (input.archived !== undefined) {
    if (typeof input.archived !== "boolean") throw new SearchInputError("Invalid archive filter.");
    out.archived = input.archived;
  }
  for (const key of ["progressMin", "progressMax"] as const) {
    const value = input[key];
    if (value !== undefined && value !== null) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) throw new SearchInputError("Progress must be a whole percentage from 0 to 100.");
      out[key] = value;
    }
  }
  if (input.sort !== undefined) {
    if (typeof input.sort !== "string" || !(kind === "tasks" ? TASK_SORTS : PROJECT_SORTS).includes(input.sort)) throw new SearchInputError("Invalid sort order.");
    out.sort = input.sort;
  }
  if (input.dir !== undefined) {
    if (input.dir !== "asc" && input.dir !== "desc") throw new SearchInputError("Invalid sort direction.");
    out.dir = input.dir;
  }
  if ((out.from && out.to && out.from > out.to) || (out.startFrom && out.startTo && out.startFrom > out.startTo)) throw new SearchInputError("The start of a date range must be on or before its end.");
  if (out.progressMin !== null && out.progressMax !== null && out.progressMin > out.progressMax) throw new SearchInputError("Minimum progress must not exceed maximum progress.");
  if (kind === "projects" && (out.projects.length || out.labels.length || out.focus !== "all")) throw new SearchInputError("Task-specific filters cannot be applied to Projects.");
  if (kind === "projects" && (out.statuses.length > 1 || out.priorities.length > 1)) throw new SearchInputError("Choose one project status and priority, or leave them on All.");
  if (kind === "tasks" && (out.archived || out.startFrom || out.startTo || out.progressMin !== null || out.progressMax !== null || out.deadline !== "all")) throw new SearchInputError("Project-only filters cannot be applied to Tasks. Use task focus and due-date ranges instead.");
  return out;
}
export function pageNumber(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) throw new SearchInputError("Invalid pagination value.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max) throw new SearchInputError("Pagination value is out of range.");
  return value;
}
export function savedName(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || raw.trim().length > 50 || /[\u0000-\u001f]/.test(raw)) throw new SearchInputError("Name your filter using 1–50 characters.");
  return raw.trim().replace(/\s+/g, " ");
}
export interface SearchResult { id: string; kind: SearchKind; title: string; description: string; status: string; priority: string | null; projectId: string | null; projectName: string | null; color: string; icon: string; archived: boolean; labels: string[] }
export interface SearchGroup { kind: SearchKind; items: SearchResult[]; hasMore: boolean }
export interface SearchResponse { query: string; groups: SearchGroup[] }
export interface RecentSearch { id: string; query: string; scope: SearchScope; lastUsedAt: string }
export interface SavedFilter { id: string; kind: FilterKind; name: string; config: FilterConfig; createdAt: string }
export interface BrowseResponse<T> { items: T[]; total: number; hasMore: boolean; offset: number; limit: number; today: string }
export interface SearchEntityResponse { kind: SearchKind; item: Project | Task | Idea }
