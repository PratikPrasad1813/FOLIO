"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownWideNarrow, ArrowUpDown, ArrowUpNarrowWide, CalendarDays, CalendarPlus, ChevronDown, ChevronUp, CircleCheck, CloudOff, Columns3, FilterX, ListTodo, Plus, RefreshCw, Rows3, Rows4, Search, SearchX, Sparkles, X, Zap } from "lucide-react";
import { dateKey, formatDate, TASK_PRIORITIES, TASK_STATUSES, type Task, type TaskPriority, type TaskStatus } from "@/lib/types";
import { addDays, matchesFocus, parseQuickAdd, priorityLabel, statusLabel, weekStart, type TaskFocus, type TaskSortKey } from "@/lib/tasks";
import { usePersistentJson, usePersistentState } from "@/lib/use-persistent-state";
import type { WorkspaceActions } from "@/components/workspace-views";
import { ProjectsEmpty } from "@/components/projects-view";
import { allLabels, PriorityIcon, TaskStatusIcon, TASK_STATUS_TONE } from "@/components/task-parts";
import { TaskBoard } from "@/components/task-board";
import { TaskList } from "@/components/task-list";
import { TaskCalendar } from "@/components/task-calendar";
import { CollectionNotice, FilterPopover, MoreResults, SavedFilters } from "@/components/search-filters";
import { defaultFilters, type FilterConfig } from "@/lib/search-types";
import { useFilteredCollection } from "@/lib/use-filtered-collection";

type ViewMode = "board" | "list" | "calendar";
interface TaskFilters { statuses: TaskStatus[]; priorities: TaskPriority[]; projects: string[]; labels: string[]; from: string; to: string }
const NO_FILTERS: TaskFilters = { statuses: [], priorities: [], projects: [], labels: [], from: "", to: "" };
const FOCUS_KEYS: TaskFocus[] = ["all", "todo", "in_progress", "in_review", "done", "overdue", "today", "week", "upcoming", "no_date"];
const OVERVIEW: { key: TaskFocus; label: string; tone: string }[] = [
  { key: "all", label: "All", tone: "neutral" },
  { key: "todo", label: "To do", tone: "neutral" },
  { key: "in_progress", label: "In progress", tone: "blue" },
  { key: "in_review", label: "In review", tone: "amber" },
  { key: "done", label: "Completed", tone: "green" },
  { key: "overdue", label: "Overdue", tone: "red" },
];
const QUICK: { key: TaskFocus; label: string }[] = [
  { key: "all", label: "All tasks" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Completed" },
  { key: "no_date", label: "No due date" },
];
const SORTS: { key: TaskSortKey; label: string; dir: "asc" | "desc" }[] = [
  { key: "smart", label: "Smart order", dir: "asc" },
  { key: "due", label: "Due date", dir: "asc" },
  { key: "priority", label: "Priority", dir: "asc" },
  { key: "updated", label: "Recently updated", dir: "desc" },
  { key: "created", label: "Recently created", dir: "desc" },
  { key: "title", label: "Alphabetical", dir: "asc" },
  { key: "status", label: "Status", dir: "asc" },
  { key: "project", label: "Project", dir: "asc" },
];

function sanitizeFilters(raw: unknown): TaskFilters {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = (entry: unknown) => (Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : []);
  const day = (entry: unknown) => (typeof entry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry) ? entry : "");
  return {
    statuses: list(value.statuses).filter((item): item is TaskStatus => (TASK_STATUSES as string[]).includes(item)),
    priorities: list(value.priorities).filter((item): item is TaskPriority => (TASK_PRIORITIES as string[]).includes(item)),
    projects: list(value.projects),
    labels: list(value.labels),
    from: day(value.from),
    to: day(value.to),
  };
}

const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);

export function TasksSkeleton() {
  return (
    <div className="pj tk" role="status" aria-label="Loading your tasks">
      <div className="pj-sk pj-sk-title" />
      <div className="pj-sk tk-sk-strip" />
      <div className="pj-sk pj-sk-toolbar" />
      <div className="tk-board">{TASK_STATUSES.map((status) => <div key={status} className="pj-sk tk-sk-col" />)}</div>
      <span className="sr-only">Getting your tasks ready…</span>
    </div>
  );
}

export function TasksError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="pj tk">
      <ProjectsEmpty icon={<CloudOff size={24} strokeWidth={1.6} />} title="We couldn’t load your tasks" description={message || "Something interrupted the connection to your workspace. Your work is safe — let’s try again."}>
        <button type="button" className="pj-btn is-primary" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />Try again</button>
      </ProjectsEmpty>
    </div>
  );
}

function Insights({ tasks, today }: { tasks: Task[]; today: string }) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  const overdue = tasks.filter((task) => !task.completed && !!task.dueDate && task.dueDate < today).length;
  const rate = total ? Math.round((completed / total) * 100) : 0;
  const monday = weekStart(today);
  const week = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const perDay = week.map((day) => tasks.filter((task) => task.completed && task.completedAt && dateKey(new Date(task.completedAt)) === day).length);
  const thisWeek = perDay.reduce((sum, value) => sum + value, 0);
  const peak = Math.max(1, ...perDay);
  const circumference = 2 * Math.PI * 22;
  return (
    <section className="tk-insights" aria-label="Task insights">
      <div className="tk-insight-rate">
        <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
          <circle cx="29" cy="29" r="22" className="tk-ring-track" />
          <circle cx="29" cy="29" r="22" className="tk-ring-fill" strokeDasharray={`${(rate / 100) * circumference} ${circumference}`} transform="rotate(-90 29 29)" />
        </svg>
        <div><strong>{rate}%</strong><span>completion rate</span></div>
      </div>
      <dl className="tk-insight-stats">
        <div><dt>Total</dt><dd>{total}</dd></div>
        <div><dt>Completed</dt><dd className="is-green">{completed}</dd></div>
        <div><dt>Remaining</dt><dd>{total - completed}</dd></div>
        <div><dt>Overdue</dt><dd className={overdue ? "is-red" : ""}>{overdue}</dd></div>
      </dl>
      <div className="tk-insight-week">
        <div className="tk-week-head"><strong>{thisWeek}</strong><span>completed this week</span></div>
        <div className="tk-week-bars" role="img" aria-label={`Completed per day this week: ${week.map((day, index) => `${formatDate(day, { weekday: "short" })} ${perDay[index]}`).join(", ")}`}>
          {week.map((day, index) => (
            <span key={day} className={`${day === today ? "is-today" : ""} ${day > today ? "is-future" : ""}`} title={`${formatDate(day, { weekday: "long" })}: ${perDay[index]} completed`}>
              <i style={{ height: `${perDay[index] ? Math.max(14, (perDay[index] / peak) * 100) : 6}%` }} />
              <small>{formatDate(day, { weekday: "narrow" })}</small>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function TasksPanel({ actions }: { actions: WorkspaceActions }) {
  const { data } = actions;
  const [view, setView] = usePersistentState<ViewMode>("folio.tasks.view", "board", "local", ["board", "list", "calendar"]);
  const [density, setDensity] = usePersistentState<"comfortable" | "compact">("folio.tasks.density", "comfortable", "local", ["comfortable", "compact"]);
  const [sort, setSort] = usePersistentState<TaskSortKey>(`folio.tasks.${data.user.id}.sort`, "smart", "local", SORTS.map((entry) => entry.key));
  const [dir, setDir] = usePersistentState<"asc" | "desc">(`folio.tasks.${data.user.id}.dir`, "asc", "local", ["asc", "desc"]);
  const [insights, setInsights] = usePersistentState<"open" | "closed">("folio.tasks.insights", "open", "local", ["open", "closed"]);
  const [focus, setFocus] = usePersistentState<TaskFocus>(`folio.tasks.${data.user.id}.focus`, "all", "session", FOCUS_KEYS);
  const [query, setQuery] = usePersistentState<string>(`folio.tasks.${data.user.id}.query`, "", "session");
  const [filters, setFilters] = usePersistentJson<TaskFilters>(`folio.tasks.${data.user.id}.filters`, NO_FILTERS, "session", sanitizeFilters);
  const [quick, setQuick] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const quickLock = useRef(false);
  const quickRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const serverFilters: FilterConfig = { ...defaultFilters("tasks"), ...filters, focus, q: query, sort, dir };
  const collection = useFilteredCollection<Task>("tasks", serverFilters, data, actions.pending.size);
  const today = collection.today ?? dateKey();
  function applySaved(next: FilterConfig) {
    setFocus(next.focus); setQuery(next.q); setSort(next.sort as TaskSortKey); setDir(next.dir);
    setFilters({ statuses: next.statuses as TaskStatus[], priorities: next.priorities as TaskPriority[], projects: next.projects, labels: next.labels, from: next.from, to: next.to });
  }

  const projects = useMemo(() => new Map(data.projects.map((project) => [project.id, project])), [data.projects]);
  const liveProjects = data.projects.filter((project) => !project.archived);
  const labels = useMemo(() => allLabels(data.tasks), [data.tasks]);
  const counts = useMemo(() => Object.fromEntries(FOCUS_KEYS.map((key) => [key, data.tasks.filter((task) => matchesFocus(task, key, today)).length])) as Record<TaskFocus, number>, [data.tasks, today]);
  const advancedCount = filters.statuses.length + filters.priorities.length + filters.projects.length + filters.labels.length + (filters.from || filters.to ? 1 : 0);

  const q = query.trim().toLowerCase();
  const visible = collection.items.map(task => actions.pending.has(task.id)
    ? data.tasks.find(current => current.id === task.id) ?? task : task);

  // New tasks inherit the context you're looking at, so they land where you expect.
  const context = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    if (focus === "todo" || focus === "in_progress" || focus === "in_review" || focus === "done") defaults.status = focus;
    else if (filters.statuses.length === 1) defaults.status = filters.statuses[0];
    if (focus === "today") defaults.dueDate = today;
    if (focus === "upcoming") defaults.dueDate = addDays(today, 1);
    if (filters.projects.length === 1 && filters.projects[0] !== "none" && projects.has(filters.projects[0])) defaults.projectId = filters.projects[0];
    if (filters.priorities.length === 1) defaults.priority = filters.priorities[0];
    return defaults;
  }, [focus, filters, today, projects]);

  const parsed = useMemo(() => parseQuickAdd(quick, data.projects, today), [quick, data.projects, today]);
  const lands = [
    context.status ? statusLabel(context.status as TaskStatus) : "To do",
    !parsed.projectId && typeof context.projectId === "string" ? projects.get(context.projectId)?.name : null,
    !parsed.dueDate && typeof context.dueDate === "string" ? (context.dueDate === today ? "due today" : `due ${formatDate(context.dueDate)}`) : null,
  ].filter(Boolean).join(" · ");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || document.querySelector(".modal-backdrop, .fm-menu, .sf-popover")) return;
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === "q") { event.preventDefault(); quickRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function submitQuick(event: FormEvent) {
    event.preventDefault();
    if (!parsed.title || quickLock.current) return;
    quickLock.current = true;
    setQuickBusy(true);
    try {
      await actions.mutate("tasks", "POST", {
        ...context,
        title: parsed.title.slice(0, 200),
        ...(parsed.priority ? { priority: parsed.priority } : {}),
        ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
        ...(parsed.labels.length ? { labels: parsed.labels } : {}),
      });
      setQuick("");
    } catch { /* toast already shown; keep the text */ } finally {
      quickLock.current = false;
      setQuickBusy(false);
    }
  }

  const clearAll = () => { setFocus("all"); setFilters(NO_FILTERS); setQuery(""); };
  const filtered = focus !== "all" || advancedCount > 0 || q.length > 0;
  const sortBy = (key: TaskSortKey) => {
    if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(key); setDir(SORTS.find((entry) => entry.key === key)?.dir ?? "asc"); }
  };

  let empty: ReactNode = null;
  if (!collection.loading && !collection.error && !data.tasks.length && !visible.length) {
    empty = (
      <ProjectsEmpty art title="Your task list is a blank page" description="Capture the first thing on your mind. Give it a priority and a date, connect it to a project, and watch the progress add up.">
        <button type="button" className="pj-btn is-primary" onClick={() => actions.openEditor({ kind: "tasks" })}><Plus size={15} aria-hidden="true" />Create your first task</button>
        <button type="button" className="pj-btn is-secondary" onClick={() => quickRef.current?.focus()}><Zap size={15} aria-hidden="true" />Use quick add</button>
      </ProjectsEmpty>
    );
  } else if (!collection.loading && !collection.error && !visible.length && view !== "calendar") {
    const onlyFocus = !advancedCount && !q;
    if (q) empty = <ProjectsEmpty icon={<SearchX size={24} strokeWidth={1.6} />} title={`No tasks match “${query.trim()}”`} description="We searched titles, descriptions, notes, labels and project names. Try a shorter word."><button type="button" className="pj-btn is-secondary" onClick={() => setQuery("")}><X size={15} aria-hidden="true" />Clear search</button>{(advancedCount > 0 || focus !== "all") && <button type="button" className="pj-btn is-ghost" onClick={clearAll}><FilterX size={15} aria-hidden="true" />Clear all filters</button>}</ProjectsEmpty>;
    else if (onlyFocus && focus === "today") empty = <ProjectsEmpty icon={<CalendarDays size={24} strokeWidth={1.6} />} title="Nothing due today" description="A clear day. Pull something forward, or enjoy the breathing room."><button type="button" className="pj-btn is-primary" onClick={() => actions.openEditor({ kind: "tasks", defaults: { dueDate: today } })}><CalendarPlus size={15} aria-hidden="true" />Plan something for today</button><button type="button" className="pj-btn is-ghost" onClick={() => setFocus("upcoming")}>See upcoming</button></ProjectsEmpty>;
    else if (onlyFocus && focus === "overdue") empty = <ProjectsEmpty icon={<CircleCheck size={24} strokeWidth={1.6} />} title="No overdue tasks" description="You’re all caught up — nothing has slipped past its date." />;
    else if (onlyFocus && focus === "upcoming") empty = <ProjectsEmpty icon={<CalendarDays size={24} strokeWidth={1.6} />} title="Nothing coming up" description="No tasks are scheduled after today. Give your next steps a date to see them here." />;
    else if (onlyFocus && focus === "no_date") empty = <ProjectsEmpty icon={<CircleCheck size={24} strokeWidth={1.6} />} title="Every task has a date" description="Nice planning. Undated tasks will gather here." />;
    else if (onlyFocus && focus === "done") empty = <ProjectsEmpty icon={<Sparkles size={24} strokeWidth={1.6} />} title="Nothing completed yet" description="Finish a task and it will land here. Small wins count." />;
    else empty = <ProjectsEmpty icon={<FilterX size={24} strokeWidth={1.6} />} title="No tasks match these filters" description="Try removing a filter or two, or create a task that fits."><button type="button" className="pj-btn is-secondary" onClick={clearAll}><FilterX size={15} aria-hidden="true" />Clear filters</button><button type="button" className="pj-btn is-ghost" onClick={() => actions.openEditor({ kind: "tasks", defaults: context })}><Plus size={15} aria-hidden="true" />New task</button></ProjectsEmpty>;
  }

  const distribution = TASK_STATUSES.map((status) => ({ status, count: counts[status] }));

  return (
    <div className="pj tk">
      <header className="pj-header">
        <div className="pj-header-copy">
          <div className="pj-title-row"><h1>Tasks</h1><span className="pj-count" title={`${data.tasks.length} tasks in total`}>{data.tasks.length}</span></div>
          <p>Plan your work. Prioritise what matters. Make progress.</p>
        </div>
        <div className="pj-header-actions">
          <button type="button" className="pj-btn is-ghost" onClick={() => setInsights(insights === "open" ? "closed" : "open")} aria-expanded={insights === "open"}>{insights === "open" ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}Insights</button>
          <button type="button" className="pj-btn is-secondary" onClick={() => quickRef.current?.focus()}><Zap size={15} aria-hidden="true" />Quick add<kbd>Q</kbd></button>
          <button type="button" className="pj-btn is-primary" onClick={() => actions.openEditor({ kind: "tasks", defaults: context })}><Plus size={16} aria-hidden="true" />New task<kbd>T</kbd></button>
        </div>
      </header>

      <form className={`tk-quick ${quickBusy ? "is-busy" : ""}`} onSubmit={submitQuick}>
        <Zap size={16} className="tk-quick-icon" aria-hidden="true" />
        <input ref={quickRef} value={quick} onChange={(event) => setQuick(event.target.value)} maxLength={300} placeholder="Quick add — try “Draft the brief tomorrow !high #client @mobile”" aria-label="Quick add a task" aria-describedby="tk-quick-help" />
        {parsed.tokens.length > 0 && <span className="tk-quick-tokens" aria-hidden="true">{parsed.tokens.map((token) => <span key={`${token.kind}-${token.label}`} className={`tk-token is-${token.kind}`}>{token.label}</span>)}</span>}
        <button type="submit" className="pj-btn is-primary is-sm" disabled={!parsed.title || quickBusy}>Add</button>
      </form>
      <p id="tk-quick-help" className="tk-quick-help">Shortcuts: <kbd>!urgent</kbd> <kbd>!high</kbd> <kbd>#label</kbd> <kbd>@project</kbd> <kbd>today</kbd> <kbd>tomorrow</kbd> <kbd>friday</kbd> · lands in <strong>{lands}</strong></p>

      <section className="tk-overview" aria-label="Task status overview">
        <div className="tk-dist" aria-hidden="true">{distribution.map(({ status, count }) => count > 0 && <i key={status} className={`tone-${TASK_STATUS_TONE[status]}`} style={{ flexGrow: count }} />)}</div>
        <div className="tk-overview-chips" role="group" aria-label="Filter by status">
          {OVERVIEW.map((entry) => (
            <button key={entry.key} type="button" aria-pressed={focus === entry.key} className={`tk-ov tone-${entry.tone} ${focus === entry.key ? "is-active" : ""}`} onClick={() => setFocus(entry.key)}>
              {entry.key === "all" ? <ListTodo size={14} aria-hidden="true" /> : entry.key === "overdue" ? <span className="tk-ov-alert" aria-hidden="true">!</span> : <TaskStatusIcon status={entry.key as TaskStatus} size={14} />}
              <span>{entry.label}</span>
              <strong>{counts[entry.key]}</strong>
            </button>
          ))}
        </div>
      </section>

      {insights === "open" && data.tasks.length > 0 && <Insights tasks={data.tasks} today={today} />}

      <div className="tk-toolbar">
        <div className="tk-quickfilters" role="group" aria-label="Quick filters">
          {QUICK.map((entry) => <button key={entry.key} type="button" aria-pressed={focus === entry.key} className={focus === entry.key ? "is-active" : ""} onClick={() => setFocus(entry.key)}>{entry.label}<span>{counts[entry.key]}</span></button>)}
        </div>
        <div className="pj-segmented tk-views" role="group" aria-label="Task view">
          <button type="button" aria-pressed={view === "board"} className={`tk-seg-text ${view === "board" ? "is-active" : ""}`} onClick={() => setView("board")}><Columns3 size={15} aria-hidden="true" />Board</button>
          <button type="button" aria-pressed={view === "list"} className={`tk-seg-text ${view === "list" ? "is-active" : ""}`} onClick={() => setView("list")}><Rows3 size={15} aria-hidden="true" />List</button>
          <button type="button" aria-pressed={view === "calendar"} className={`tk-seg-text ${view === "calendar" ? "is-active" : ""}`} onClick={() => setView("calendar")}><CalendarDays size={15} aria-hidden="true" />Calendar</button>
        </div>
      </div>

      <div className="pj-toolbar tk-searchbar">
        <label className="pj-search">
          <Search size={16} aria-hidden="true" />
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); } }} placeholder="Search tasks, descriptions, labels or projects…" aria-label="Search tasks" maxLength={200} />
          {query ? <button type="button" className="pj-search-clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={14} /></button> : <kbd aria-hidden="true">/</kbd>}
        </label>
        <div className="pj-toolbar-controls">
          <FilterPopover count={advancedCount + (focus !== "all" ? 1 : 0)} onClear={clearAll}>
            <section className="tk-filter-panel sf-task-fields" aria-label="Advanced filters">
          <div className="tk-filter-group">
            <h4>Status</h4>
            <div>{TASK_STATUSES.map((status) => <button key={status} type="button" aria-pressed={filters.statuses.includes(status)} className={`tk-fchip ${filters.statuses.includes(status) ? "is-on" : ""}`} onClick={() => setFilters({ ...filters, statuses: toggleIn(filters.statuses, status) })}><TaskStatusIcon status={status} size={13} />{statusLabel(status)}</button>)}</div>
          </div>
          <div className="tk-filter-group">
            <h4>Priority</h4>
            <div>{TASK_PRIORITIES.map((priority) => <button key={priority} type="button" aria-pressed={filters.priorities.includes(priority)} className={`tk-fchip ${filters.priorities.includes(priority) ? "is-on" : ""}`} onClick={() => setFilters({ ...filters, priorities: toggleIn(filters.priorities, priority) })}><PriorityIcon priority={priority} size={13} />{priorityLabel(priority)}</button>)}</div>
          </div>
          <div className="tk-filter-group">
            <h4>Project</h4>
            <div>
              {liveProjects.map((project) => <button key={project.id} type="button" aria-pressed={filters.projects.includes(project.id)} className={`tk-fchip ${filters.projects.includes(project.id) ? "is-on" : ""}`} onClick={() => setFilters({ ...filters, projects: toggleIn(filters.projects, project.id) })}><i className={`tk-fdot c-${project.color}`} aria-hidden="true" />{project.name}</button>)}
              <button type="button" aria-pressed={filters.projects.includes("none")} className={`tk-fchip ${filters.projects.includes("none") ? "is-on" : ""}`} onClick={() => setFilters({ ...filters, projects: toggleIn(filters.projects, "none") })}>No project</button>
            </div>
          </div>
          <div className="tk-filter-group">
            <h4>Labels</h4>
            <div>{labels.length ? labels.map((label) => <button key={label} type="button" aria-pressed={filters.labels.includes(label.toLowerCase())} className={`tk-fchip ${filters.labels.includes(label.toLowerCase()) ? "is-on" : ""}`} onClick={() => setFilters({ ...filters, labels: toggleIn(filters.labels, label.toLowerCase()) })}>#{label}</button>) : <span className="tk-muted">No labels yet — add some to a task.</span>}</div>
          </div>
          <div className="tk-filter-group">
            <h4>Due between</h4>
            <div className="tk-range">
              <input type="date" aria-label="Due on or after" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
              <span aria-hidden="true">→</span>
              <input type="date" aria-label="Due on or before" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
              <button type="button" className="tk-fchip" onClick={() => setFilters({ ...filters, from: weekStart(today), to: addDays(weekStart(today), 6) })}>This week</button>
              <button type="button" className="tk-fchip" onClick={() => setFilters({ ...filters, from: today, to: addDays(today, 6) })}>Next 7 days</button>
              {(filters.from || filters.to) && <button type="button" className="pj-link" onClick={() => setFilters({ ...filters, from: "", to: "" })}>Clear dates</button>}
            </div>
          </div>
        </section>
          </FilterPopover>
          <SavedFilters kind="tasks" config={serverFilters} onApply={applySaved} />
          <label className="pj-select">
            <ArrowUpDown size={14} aria-hidden="true" />
            <select value={sort} onChange={(event) => { const next = SORTS.find((entry) => entry.key === event.target.value); if (next) { setSort(next.key); setDir(next.dir); } }} aria-label="Sort tasks">
              {SORTS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          <button type="button" className="pj-icon-btn is-boxed" onClick={() => setDir(dir === "asc" ? "desc" : "asc")} aria-label={`Sort direction: ${dir === "asc" ? "ascending" : "descending"}. Switch to ${dir === "asc" ? "descending" : "ascending"}`} title={dir === "asc" ? "Ascending" : "Descending"}>
            {dir === "asc" ? <ArrowUpNarrowWide size={16} aria-hidden="true" /> : <ArrowDownWideNarrow size={16} aria-hidden="true" />}
          </button>
          {view === "list" && (
            <div className="pj-segmented" role="group" aria-label="Row density">
              <button type="button" aria-pressed={density === "comfortable"} className={density === "comfortable" ? "is-active" : ""} onClick={() => setDensity("comfortable")} aria-label="Comfortable rows" title="Comfortable"><Rows3 size={15} aria-hidden="true" /></button>
              <button type="button" aria-pressed={density === "compact"} className={density === "compact" ? "is-active" : ""} onClick={() => setDensity("compact")} aria-label="Compact rows" title="Compact"><Rows4 size={15} aria-hidden="true" /></button>
            </div>
          )}
        </div>
      </div>


      <div className="pj-results-bar">
        <span className="pj-results-count" aria-live="polite">{collection.loading ? "Updating results…" : <><strong>{collection.total}</strong> matching task{collection.total === 1 ? "" : "s"}{collection.total > visible.length ? ` · ${visible.length} loaded` : ""}</>}</span>
        {focus !== "all" && <button type="button" className="pj-chip" onClick={() => setFocus("all")} aria-label="Remove quick filter">{[...OVERVIEW, ...QUICK].find((entry) => entry.key === focus)?.label}<X size={12} aria-hidden="true" /></button>}
        {filters.statuses.map((status) => <button key={status} type="button" className="pj-chip" onClick={() => setFilters({ ...filters, statuses: toggleIn(filters.statuses, status) })}>{statusLabel(status)}<X size={12} aria-hidden="true" /></button>)}
        {filters.priorities.map((priority) => <button key={priority} type="button" className="pj-chip" onClick={() => setFilters({ ...filters, priorities: toggleIn(filters.priorities, priority) })}>{priorityLabel(priority)}<X size={12} aria-hidden="true" /></button>)}
        {filters.projects.map((id) => <button key={id} type="button" className="pj-chip" onClick={() => setFilters({ ...filters, projects: toggleIn(filters.projects, id) })}>{id === "none" ? "No project" : projects.get(id)?.name ?? "Project"}<X size={12} aria-hidden="true" /></button>)}
        {filters.labels.map((label) => <button key={label} type="button" className="pj-chip" onClick={() => setFilters({ ...filters, labels: toggleIn(filters.labels, label) })}>#{label}<X size={12} aria-hidden="true" /></button>)}
        {(filters.from || filters.to) && <button type="button" className="pj-chip" onClick={() => setFilters({ ...filters, from: "", to: "" })}>Due {filters.from ? formatDate(filters.from) : "…"} – {filters.to ? formatDate(filters.to) : "…"}<X size={12} aria-hidden="true" /></button>}
        {q && <button type="button" className="pj-chip" onClick={() => setQuery("")}>“{query.trim()}”<X size={12} aria-hidden="true" /></button>}
        {filtered && <button type="button" className="pj-link" onClick={clearAll}><FilterX size={13} aria-hidden="true" />Clear filters</button>}
      </div>

      <CollectionNotice loading={collection.loading} error={collection.error} onRetry={collection.retry} />
      <div key={view} className={`pj-switch ${collection.loading ? "sf-results-pending" : ""}`} aria-busy={collection.loading}>
        {empty ?? (view === "board"
          ? <TaskBoard tasks={visible} actions={actions} today={today} sort={sort} dir={dir} createDefaults={context} serverOrdered />
          : view === "list"
            ? <TaskList tasks={visible} actions={actions} today={today} sort={sort} dir={dir} onSort={sortBy} density={density} />
            : <TaskCalendar actions={actions} tasks={visible} persistKey="tasks" createDefaults={context} preserveTaskOrder partialResults={Boolean(collection.hasMore)} />)}
      </div>
      <MoreResults hasMore={Boolean(collection.hasMore)} loading={collection.loadingMore} count={visible.length} total={collection.total} onMore={() => { void collection.loadMore(); }} />
    </div>
  );
}
