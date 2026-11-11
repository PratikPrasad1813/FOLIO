"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePersistentJson, usePersistentState } from "@/lib/use-persistent-state";
import { Archive, ArrowDownWideNarrow, ArrowLeft, ArrowUpDown, ArrowUpNarrowWide, Check, ChevronDown, Clock3, CloudOff, Download, FilterX, FolderPlus, LayoutGrid, Lightbulb, ListChecks, Milestone as MilestoneIcon, Plus, RefreshCw, Rows3, Search, SearchX, Star, X } from "lucide-react";
import { dateKey, formatDate, PRIORITIES, PROJECT_STATUSES, statusLabel, timeAgo, type Priority, type Project, type ProjectStatus } from "@/lib/types";
import { ProjectIcon, Status } from "@/components/ui";
import type { WorkspaceActions } from "@/components/workspace-views";
import { computeStats, DueBadge, HealthBadge, PriorityBadge, ProgressBar, ProjectActionsMenu, projectHealth, STATUS_TONE, type ProjectStats } from "@/components/project-parts";

import { CollectionNotice, FilterPopover, MoreResults, ProjectFilterFields, SavedFilters } from "@/components/search-filters";
import { DATE_PRESET_LABELS, defaultFilters, parseFilters, type FilterConfig } from "@/lib/search-types";
import { useFilteredCollection } from "@/lib/use-filtered-collection";

type Advanced = Pick<FilterConfig, "from" | "to" | "startFrom" | "startTo" | "progressMin" | "progressMax" | "deadline">;
const advancedPart = (f: FilterConfig): Advanced => ({ from: f.from, to: f.to, startFrom: f.startFrom, startTo: f.startTo, progressMin: f.progressMin, progressMax: f.progressMax, deadline: f.deadline });
const NO_ADVANCED = advancedPart(defaultFilters("projects"));
function sanitizeAdvanced(raw: unknown): Advanced {
  try { return advancedPart(parseFilters("projects", raw)); } catch { return NO_ADVANCED; }
}
type BrowsedProject = Project & { progress: number; taskCount: number; completedTaskCount: number };
type ViewMode = "grid" | "list";
type SortKey = "updated" | "created" | "due" | "name" | "progress" | "priority";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | ProjectStatus | "archived";
type PriorityFilter = "all" | Priority;

const SORTS: { key: SortKey; label: string; dir: SortDir }[] = [
  { key: "updated", label: "Recently updated", dir: "desc" },
  { key: "created", label: "Recently created", dir: "desc" },
  { key: "due", label: "Due date", dir: "asc" },
  { key: "priority", label: "Priority", dir: "asc" },
  { key: "name", label: "Alphabetical", dir: "asc" },
  { key: "progress", label: "Progress", dir: "desc" },
];
const OVERVIEW: { key: Exclude<StatusFilter, "archived">; label: string; tone: string }[] = [
  { key: "all", label: "All projects", tone: "neutral" },
  { key: "In progress", label: "In progress", tone: STATUS_TONE["In progress"] },
  { key: "Planning", label: "Planned", tone: STATUS_TONE.Planning },
  { key: "Completed", label: "Completed", tone: STATUS_TONE.Completed },
  { key: "On hold", label: "On hold", tone: STATUS_TONE["On hold"] },
];

function exportCsv(projects: Project[], statsMap: Map<string, ProjectStats>) {
  const header = ["Name", "Status", "Priority", "Category", "Start date", "Due date", "Progress (%)", "Tasks done", "Tasks total", "Milestones reached", "Milestones total", "Favorite", "Archived", "Created", "Last updated", "Description"];
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`; // keep spreadsheets from evaluating formulas
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = projects.map((project) => {
    const stats = statsMap.get(project.id);
    return [project.name, statusLabel(project.status), project.priority, project.category, project.startDate ?? "", project.dueDate ?? "", stats?.percent ?? 0, stats?.done ?? 0, stats?.total ?? 0, stats?.milestonesDone ?? 0, stats?.milestones ?? 0, project.favorite ? "Yes" : "No", project.archived ? "Yes" : "No", project.createdAt.slice(0, 10), (project.updatedAt || project.createdAt).slice(0, 10), project.description].map(cell).join(",");
  });
  const blob = new Blob([`\ufeff${[header.join(","), ...rows].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `folio-projects-${dateKey()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */

function ProjectCard({ project, stats, actions, today, isNew, index }: { project: Project; stats: ProjectStats; actions: WorkspaceActions; today: string; isNew: boolean; index: number }) {
  const health = projectHealth(project, stats, today);
  const updated = project.updatedAt || project.createdAt;
  return (
    <article className={`pj-card ${isNew ? "is-new" : ""} ${project.archived ? "is-archived" : ""}`} style={{ animationDelay: `${Math.min(index, 9) * 32}ms` }}>
      <span className={`pj-card-wash c-${project.color}`} aria-hidden="true" />
      <header className="pj-card-top">
        <ProjectIcon icon={project.icon} color={project.color} />
        <div className="pj-card-tools">
          <button type="button" className={`pj-icon-btn pj-star ${project.favorite ? "is-on" : ""}`} aria-pressed={project.favorite} aria-label={project.favorite ? `Remove ${project.name} from favorites` : `Add ${project.name} to favorites`} onClick={() => { void actions.mutate("projects", "PATCH", { favorite: !project.favorite }, project.id).catch(() => {}); }}>
            <Star size={15} fill={project.favorite ? "currentColor" : "none"} aria-hidden="true" />
          </button>
          <ProjectActionsMenu project={project} actions={actions} />
        </div>
      </header>
      <div className="pj-card-heading">
        <h3><button type="button" className="pj-card-link" onClick={() => actions.openProject(project.id)}>{project.name}</button></h3>
        <span className="pj-card-category">{project.category}</span>
      </div>
      <p className="pj-card-desc">{project.description || "No description yet — add a goal so future you remembers why this matters."}</p>
      <div className="pj-card-badges">
        <Status status={project.status} />
        <PriorityBadge priority={project.priority} />
        <DueBadge due={project.dueDate} today={today} completed={project.status === "Completed"} />
      </div>
      <div className="pj-card-progress">
        <div className="pj-progress-head"><span>Progress</span><strong>{stats.percent}<small>%</small></strong></div>
        <ProgressBar percent={stats.percent} color={project.color} label={`${project.name} progress`} />
        <div className="pj-progress-meta">
          <span title="Completed tasks"><ListChecks size={13} aria-hidden="true" />{stats.done}/{stats.total} tasks</span>
          <span title="Milestones reached"><MilestoneIcon size={13} aria-hidden="true" />{stats.milestonesDone}/{stats.milestones} milestones</span>
        </div>
      </div>
      <footer className="pj-card-footer">
        <HealthBadge health={health} />
        <span className="pj-updated" title={`Last updated ${new Date(updated).toLocaleString()}`}><Clock3 size={12} aria-hidden="true" />{timeAgo(updated)}</span>
      </footer>
    </article>
  );
}

function ProjectTable({ projects, statsMap, actions, today, sort, dir, onSort, newIds }: { projects: Project[]; statsMap: Map<string, ProjectStats>; actions: WorkspaceActions; today: string; sort: SortKey; dir: SortDir; onSort: (key: SortKey) => void; newIds: Set<string> }) {
  const ariaSort = (key: SortKey) => (sort === key ? (dir === "asc" ? "ascending" : "descending") : "none");
  const head = (key: SortKey, label: string) => (
    <button type="button" className={`pj-th-btn ${sort === key ? "is-sorted" : ""}`} onClick={() => onSort(key)}>
      {label}
      {sort === key ? (dir === "asc" ? <ArrowUpNarrowWide size={12} aria-hidden="true" /> : <ArrowDownWideNarrow size={12} aria-hidden="true" />) : <ArrowUpDown size={11} className="pj-th-idle" aria-hidden="true" />}
    </button>
  );
  return (
    <div className="pj-table" role="table" aria-label="Projects" aria-rowcount={projects.length + 1}>
      <div className="pj-tr pj-thead" role="row">
        <span role="columnheader" aria-sort={ariaSort("name")}>{head("name", "Project")}</span>
        <span role="columnheader" className="pj-col-status">Status</span>
        <span role="columnheader" aria-sort={ariaSort("progress")}>{head("progress", "Progress")}</span>
        <span role="columnheader" className="pj-col-due" aria-sort={ariaSort("due")}>{head("due", "Due date")}</span>
        <span role="columnheader" className="pj-col-tasks">Tasks</span>
        <span role="columnheader" className="pj-col-updated" aria-sort={ariaSort("updated")}>{head("updated", "Updated")}</span>
        <span role="columnheader"><span className="sr-only">Actions</span></span>
      </div>
      {projects.map((project, index) => {
        const stats = statsMap.get(project.id) ?? computeStats(project, actions.data, today);
        return (
          <div key={project.id} role="row" className={`pj-tr ${newIds.has(project.id) ? "is-new" : ""}`} style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }} onClick={() => actions.openProject(project.id)}>
            <div role="cell" className="pj-td-project">
              <ProjectIcon icon={project.icon} color={project.color} small />
              <div>
                <button type="button" className="pj-row-link" onClick={(event) => { event.stopPropagation(); actions.openProject(project.id); }}>{project.name}</button>
                <span>{project.category}{project.favorite && <Star size={11} fill="currentColor" className="pj-row-star" aria-label="Favorite" />}</span>
              </div>
            </div>
            <div role="cell" className="pj-col-status"><Status status={project.status} /></div>
            <div role="cell" className="pj-td-progress"><ProgressBar size="sm" percent={stats.percent} color={project.color} label={`${project.name} progress`} /><strong>{stats.percent}%</strong></div>
            <div role="cell" className="pj-col-due"><DueBadge due={project.dueDate} today={today} completed={project.status === "Completed"} /></div>
            <div role="cell" className="pj-col-tasks"><span className="pj-td-muted"><ListChecks size={13} aria-hidden="true" />{stats.done}/{stats.total}</span></div>
            <div role="cell" className="pj-col-updated"><span className="pj-td-muted">{timeAgo(project.updatedAt || project.createdAt)}</span></div>
            <div role="cell" className="pj-td-actions"><ProjectActionsMenu project={project} actions={actions} /></div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyArt() {
  return (
    <svg className="pj-art" width="148" height="104" viewBox="0 0 148 104" aria-hidden="true">
      <rect className="pj-art-back" x="30" y="10" width="88" height="62" rx="12" transform="rotate(-7 74 41)" />
      <rect className="pj-art-card" x="24" y="22" width="100" height="70" rx="13" />
      <rect className="pj-art-accent" x="36" y="34" width="20" height="20" rx="6" />
      <rect className="pj-art-line strong" x="62" y="37" width="44" height="6" rx="3" />
      <rect className="pj-art-line" x="62" y="48" width="30" height="5" rx="2.5" />
      <rect className="pj-art-track" x="36" y="68" width="76" height="6" rx="3" />
      <rect className="pj-art-fill" x="36" y="68" width="46" height="6" rx="3" />
      <circle className="pj-art-plus" cx="122" cy="24" r="12" />
      <path className="pj-art-plus-mark" d="M122 18.5v11M116.5 24h11" />
    </svg>
  );
}

export function ProjectsEmpty({ icon, title, description, art = false, children }: { icon?: ReactNode; title: string; description: string; art?: boolean; children?: ReactNode }) {
  return (
    <div className="pj-empty" role="status">
      {art ? <EmptyArt /> : <span className="pj-empty-icon">{icon}</span>}
      <h3>{title}</h3>
      <p>{description}</p>
      {children && <div className="pj-empty-actions">{children}</div>}
    </div>
  );
}

export function ProjectsSkeleton() {
  return (
    <div className="pj pj-skeleton" role="status" aria-label="Loading your projects">
      <div className="pj-sk pj-sk-title" />
      <div className="pj-sk-row">{Array.from({ length: 5 }).map((_, index) => <div className="pj-sk pj-sk-stat" key={index} />)}</div>
      <div className="pj-sk pj-sk-toolbar" />
      <div className="pj-grid">{Array.from({ length: 6 }).map((_, index) => <div className="pj-sk pj-sk-card" key={index} />)}</div>
      <span className="sr-only">Getting your projects ready…</span>
    </div>
  );
}

export function ProjectsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="pj">
      <ProjectsEmpty icon={<CloudOff size={24} strokeWidth={1.6} />} title="We couldn’t load your projects" description={message || "Something interrupted the connection to your workspace. Your work is safe — let’s try again."}>
        <button type="button" className="pj-btn is-primary" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />Try again</button>
      </ProjectsEmpty>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** True when the row carries a tombstone in any of its possible spellings. */
function hasTombstone(project: Project & { deletedAt?: unknown; deleted_at?: unknown }): boolean {
  return [project.deletedAt, project.deleted_at].some((value) => value !== null && value !== undefined && value !== "");
}

/**
 * A project is visible when it is not archived and carries no tombstone.
 * All three spellings are checked defensively: the UI camelCase field, the
 * wire snake_case field, and the literal string "null" — the exact SQLite
 * type-handling bug that previously hid projects behind "0 matching results".
 */
function isProjectActive(project: Project & { deletedAt?: unknown; deleted_at?: unknown }): boolean {
  return !project.archived && !hasTombstone(project);
}

export function ProjectsPanel({ actions }: { actions: WorkspaceActions }) {
  const { data } = actions;
  const [view, setView] = usePersistentState<ViewMode>("folio.projects.view", "grid", "local", ["grid", "list"]);
  const [sort, setSort] = usePersistentState<SortKey>(`folio.projects.${data.user.id}.sort`, "updated", "local", SORTS.map((entry) => entry.key));
  const [dir, setDir] = usePersistentState<SortDir>(`folio.projects.${data.user.id}.dir`, "desc", "local", ["asc", "desc"]);
  const [status, setStatus] = usePersistentState<StatusFilter>(`folio.projects.${data.user.id}.status`, "all", "session", ["all", ...PROJECT_STATUSES, "archived"]);
  const [priority, setPriority] = usePersistentState<PriorityFilter>(`folio.projects.${data.user.id}.priority`, "all", "session", ["all", ...PRIORITIES]);
  const [query, setQuery] = usePersistentState<string>(`folio.projects.${data.user.id}.query`, "", "session");
  const [advanced, setAdvanced] = usePersistentJson<Advanced>(`folio.projects.${data.user.id}.advanced`, NO_ADVANCED, "session", sanitizeAdvanced);
  const serverFilters: FilterConfig = { ...defaultFilters("projects"), ...advanced, q: query, sort, dir, archived: status === "archived", statuses: status === "all" || status === "archived" ? [] : [status], priorities: priority === "all" ? [] : [priority] };
  const collection = useFilteredCollection<BrowsedProject>("projects", serverFilters, data, actions.pending.size, data);
  const today = collection.today ?? dateKey();
  const advancedCount = (advanced.deadline !== "all" ? 1 : 0) + (advanced.progressMin !== null || advanced.progressMax !== null ? 1 : 0) + (advanced.startFrom || advanced.startTo ? 1 : 0) + (advanced.from || advanced.to ? 1 : 0);
  function applyFilters(next: FilterConfig) {
    setStatus(next.archived ? "archived" : (next.statuses[0] as ProjectStatus ?? "all"));
    setPriority(next.priorities[0] as Priority ?? "all");
    setAdvanced(advancedPart(next)); setQuery(next.q); setSort(next.sort as SortKey); setDir(next.dir);
  }
  const [exported, setExported] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const statsMap = useMemo(() => {
    const map = new Map(data.projects.map(project => [project.id, computeStats(project, data, today)]));
    for (const project of collection.items) map.set(project.id, { ...computeStats(project, data, today), percent: project.progress, total: project.taskCount, done: project.completedTaskCount, open: project.taskCount - project.completedTaskCount });
    return map;
  }, [data, today, collection.items]);
  const active = useMemo(() => data.projects.filter(isProjectActive), [data.projects]);
  const archivedCount = data.projects.length - active.length;
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: active.length };
    for (const value of PROJECT_STATUSES) result[value] = active.filter((project) => project.status === value).length;
    return result;
  }, [active]);

  const pool = status === "archived" ? data.projects.filter((project) => project.archived && !hasTombstone(project)) : active;
  const q = query.trim().toLowerCase();
  const visible = collection.items;

  // Briefly highlight projects that appear after the page has loaded (e.g. just created).
  const ids = useMemo(() => data.projects.map((project) => project.id), [data.projects]);
  const [known, setKnown] = useState(() => new Set(ids));
  const newIds = useMemo(() => new Set(ids.filter((id) => !known.has(id))), [ids, known]);
  useEffect(() => {
    if (!newIds.size) return;
    const timer = window.setTimeout(() => setKnown(new Set(ids)), 2400);
    return () => window.clearTimeout(timer);
  }, [newIds, ids]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || document.querySelector(".modal-backdrop, .sf-popover")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!exported) return;
    const timer = window.setTimeout(() => setExported(false), 2200);
    return () => window.clearTimeout(timer);
  }, [exported]);

  const filtersActive = (status !== "all" && status !== "archived") || priority !== "all" || advancedCount > 0 || q.length > 0;
  const clearFilters = () => { setStatus("all"); setPriority("all"); setAdvanced(NO_ADVANCED); setQuery(""); };
  const sortBy = (key: SortKey) => {
    if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(key); setDir(SORTS.find((entry) => entry.key === key)?.dir ?? "desc"); }
  };
  const statusName = status === "all" ? "" : status === "archived" ? "archived" : statusLabel(status).toLowerCase();

  let empty: ReactNode = null;
  if (!collection.loading && !collection.error && !visible.length) {
    if (status === "archived" && !pool.length) {
      empty = <ProjectsEmpty icon={<Archive size={24} strokeWidth={1.6} />} title="Nothing in the archive" description="Archive finished or paused projects to keep this space focused. They’ll wait here, safe and restorable."><button type="button" className="pj-btn is-secondary" onClick={() => setStatus("all")}><ArrowLeft size={15} aria-hidden="true" />Back to active projects</button></ProjectsEmpty>;
    } else if (!data.projects.length) {
      empty = <ProjectsEmpty art title="Your next big thing starts here" description="Projects give your goals a home. Create one, break it into milestones and tasks, and watch the progress add up."><button type="button" className="pj-btn is-primary" onClick={() => actions.openEditor({ kind: "projects" })}><FolderPlus size={15} aria-hidden="true" />Create your first project</button><button type="button" className="pj-btn is-secondary" onClick={() => actions.navigate("ideas")}><Lightbulb size={15} aria-hidden="true" />Browse your ideas</button></ProjectsEmpty>;
    } else if (q) {
      empty = <ProjectsEmpty icon={<SearchX size={24} strokeWidth={1.6} />} title={`No projects match “${query.trim()}”`} description={`We searched names, descriptions and categories${filtersActive && (status !== "all" || priority !== "all") ? " within your current filters" : ""}. Try a shorter word or clear the search.`}><button type="button" className="pj-btn is-secondary" onClick={() => setQuery("")}><X size={15} aria-hidden="true" />Clear search</button>{(priority !== "all" || (status !== "all" && status !== "archived")) && <button type="button" className="pj-btn is-ghost" onClick={clearFilters}><FilterX size={15} aria-hidden="true" />Clear all filters</button>}</ProjectsEmpty>;
    } else {
      empty = <ProjectsEmpty icon={<FilterX size={24} strokeWidth={1.6} />} title="No projects match these filters" description={`There are no ${[priority !== "all" ? `${priority.toLowerCase()}-priority` : "", statusName].filter(Boolean).join(" ")} projects right now.`}><button type="button" className="pj-btn is-secondary" onClick={clearFilters}><FilterX size={15} aria-hidden="true" />Clear filters</button><button type="button" className="pj-btn is-ghost" onClick={() => actions.openEditor({ kind: "projects", defaults: { ...(status !== "all" && status !== "archived" ? { status } : {}), ...(priority !== "all" ? { priority } : {}) } })}><Plus size={15} aria-hidden="true" />New project</button></ProjectsEmpty>;
    }
  }

  return (
    <div className="pj">
      <header className="pj-header">
        <div className="pj-header-copy">
          <div className="pj-title-row">
            <h1>Projects</h1>
            <span className="pj-count" title={`${data.projects.length} projects in total`}>{data.projects.length}</span>
          </div>
          <p>Everything you&rsquo;re building, organised in one place.</p>
        </div>
        <div className="pj-header-actions">
          <button type="button" className={`pj-btn is-ghost ${status === "archived" ? "is-active" : ""}`} aria-pressed={status === "archived"} onClick={() => setStatus(status === "archived" ? "all" : "archived")}>
            <Archive size={15} aria-hidden="true" />Archive<span className="pj-btn-count">{archivedCount}</span>
          </button>
          <button type="button" className={`pj-btn is-secondary ${exported ? "is-done" : ""}`} disabled={!visible.length} onClick={() => { exportCsv(visible, statsMap); setExported(true); }} title="Download the projects you’re viewing as a CSV file">
            {exported ? <Check size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{exported ? "Exported" : "Export CSV"}
          </button>
          <button type="button" className="pj-btn is-primary" onClick={() => actions.openEditor({ kind: "projects" })}>
            <Plus size={16} aria-hidden="true" />New project<kbd>N</kbd>
          </button>
        </div>
      </header>

      {status === "archived" ? (
        <div className="pj-archive-banner" role="status">
          <Archive size={16} aria-hidden="true" />
          <span><strong>Viewing the archive.</strong> {archivedCount} archived project{archivedCount === 1 ? "" : "s"} — restore any of them from its menu.</span>
          <button type="button" className="pj-link" onClick={() => setStatus("all")}><ArrowLeft size={14} aria-hidden="true" />Back to active projects</button>
        </div>
      ) : (
        <section className="pj-overview" aria-label="Project status overview">
          <div className="pj-overview-grid" role="group" aria-label="Filter projects by status">
            {OVERVIEW.map((entry) => {
              const count = counts[entry.key] ?? 0;
              const share = active.length ? Math.round((count / active.length) * 100) : 0;
              return (
                <button key={entry.key} type="button" aria-pressed={status === entry.key} className={`pj-stat tone-${entry.tone} ${status === entry.key ? "is-active" : ""}`} onClick={() => setStatus(entry.key)}>
                  <span className="pj-stat-label"><i aria-hidden="true" />{entry.label}</span>
                  <strong>{count}</strong>
                  {entry.key === "all" ? (
                    <span className="pj-stat-dist" aria-hidden="true">{PROJECT_STATUSES.map((value) => (counts[value] ?? 0) > 0 && <i key={value} className={`tone-${STATUS_TONE[value]}`} style={{ flexGrow: counts[value] }} />)}</span>
                  ) : (
                    <span className="pj-stat-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
                  )}
                  <small>{entry.key === "all" ? `${archivedCount} archived` : `${share}% of active`}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="pj-toolbar">
        <label className="pj-search">
          <Search size={16} aria-hidden="true" />
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); } }} placeholder="Search projects by name or description…" aria-label="Search projects" maxLength={200} />
          {query ? <button type="button" className="pj-search-clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={14} /></button> : <kbd aria-hidden="true">/</kbd>}
        </label>
        <div className="pj-toolbar-controls">
          <FilterPopover count={advancedCount + (priority !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0)} onClear={clearFilters}>
            <ProjectFilterFields value={serverFilters} onChange={applyFilters} />
          </FilterPopover>
          <SavedFilters kind="projects" config={serverFilters} onApply={applyFilters} />
          <label className="pj-select">
            <ArrowUpDown size={14} aria-hidden="true" />
            <select value={sort} onChange={(event) => { const next = SORTS.find((entry) => entry.key === event.target.value); if (next) { setSort(next.key); setDir(next.dir); } }} aria-label="Sort projects">
              {SORTS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          <button type="button" className="pj-icon-btn is-boxed" onClick={() => setDir(dir === "asc" ? "desc" : "asc")} aria-label={`Sort direction: ${dir === "asc" ? "ascending" : "descending"}. Switch to ${dir === "asc" ? "descending" : "ascending"}`} title={dir === "asc" ? "Ascending" : "Descending"}>
            {dir === "asc" ? <ArrowUpNarrowWide size={16} aria-hidden="true" /> : <ArrowDownWideNarrow size={16} aria-hidden="true" />}
          </button>
          <div className="pj-segmented" role="group" aria-label="Layout">
            <button type="button" aria-pressed={view === "grid"} className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")} aria-label="Grid view" title="Grid view"><LayoutGrid size={15} aria-hidden="true" /></button>
            <button type="button" aria-pressed={view === "list"} className={view === "list" ? "is-active" : ""} onClick={() => setView("list")} aria-label="List view" title="List view"><Rows3 size={15} aria-hidden="true" /></button>
          </div>
        </div>
      </div>

      <div className="pj-results-bar">
        <span className="pj-results-count" aria-live="polite">
          {collection.loading ? "Updating results…" : <><strong>{collection.total}</strong> matching {status === "archived" ? "archived " : ""}project{collection.total === 1 ? "" : "s"}{collection.total > visible.length ? ` · ${visible.length} loaded` : ""}</>}
        </span>
        {status !== "all" && status !== "archived" && <button type="button" className="pj-chip" onClick={() => setStatus("all")} aria-label={`Remove status filter ${statusLabel(status)}`}>Status: {statusLabel(status)}<X size={12} aria-hidden="true" /></button>}
        {priority !== "all" && <button type="button" className="pj-chip" onClick={() => setPriority("all")} aria-label={`Remove priority filter ${priority}`}>Priority: {priority}<X size={12} aria-hidden="true" /></button>}
        {q && <button type="button" className="pj-chip" onClick={() => setQuery("")} aria-label="Clear search">“{query.trim()}”<X size={12} aria-hidden="true" /></button>}
        {advanced.deadline !== "all" && <button className="pj-chip" aria-label="Remove deadline filter" onClick={() => setAdvanced({ ...advanced, deadline: "all" })}>{DATE_PRESET_LABELS[advanced.deadline]}<X size={12} /></button>}
        {(advanced.progressMin !== null || advanced.progressMax !== null) && <button className="pj-chip" aria-label="Remove progress filter" onClick={() => setAdvanced({ ...advanced, progressMin: null, progressMax: null })}>Progress: {advanced.progressMin ?? 0}–{advanced.progressMax ?? 100}%<X size={12} /></button>}
        {(advanced.startFrom || advanced.startTo) && <button className="pj-chip" aria-label="Remove start date filter" onClick={() => setAdvanced({ ...advanced, startFrom: "", startTo: "" })}>Starts {advanced.startFrom ? formatDate(advanced.startFrom) : "…"} – {advanced.startTo ? formatDate(advanced.startTo) : "…"}<X size={12} /></button>}
        {(advanced.from || advanced.to) && <button className="pj-chip" aria-label="Remove deadline range" onClick={() => setAdvanced({ ...advanced, from: "", to: "" })}>Due {advanced.from ? formatDate(advanced.from) : "…"} – {advanced.to ? formatDate(advanced.to) : "…"}<X size={12} /></button>}
        {filtersActive && <button type="button" className="pj-link" onClick={clearFilters}><FilterX size={13} aria-hidden="true" />Clear filters</button>}
        <span className="pj-results-sort">Sorted by {SORTS.find((entry) => entry.key === sort)?.label.toLowerCase()}</span>
      </div>

      <CollectionNotice loading={collection.loading} error={collection.error} onRetry={collection.retry} />
      {empty ?? (
        <div key={view} aria-busy={collection.loading} className={`${view === "grid" ? "pj-grid pj-switch" : "pj-switch"} ${collection.loading ? "sf-results-pending" : ""}`}>
          {view === "grid"
            ? visible.map((project, index) => <ProjectCard key={project.id} project={project} stats={statsMap.get(project.id) ?? computeStats(project, data, today)} actions={actions} today={today} isNew={newIds.has(project.id)} index={index} />)
            : <ProjectTable projects={visible} statsMap={statsMap} actions={actions} today={today} sort={sort} dir={dir} onSort={sortBy} newIds={newIds} />}
          {view === "grid" && status !== "archived" && (
            <button type="button" className="pj-card-new" onClick={() => actions.openEditor({ kind: "projects" })}>
              <span><Plus size={18} aria-hidden="true" /></span>
              <strong>New project</strong>
              <small>Give your next big thing a home</small>
            </button>
          )}
        </div>
      )}
      <MoreResults hasMore={Boolean(collection.hasMore)} loading={collection.loadingMore} count={visible.length} total={collection.total} onMore={() => { void collection.loadMore(); }} />
    </div>
  );
}
