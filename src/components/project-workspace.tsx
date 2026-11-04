"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Archive, ArrowLeft, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, CircleCheck, CornerDownLeft, Ellipsis, FolderKanban, History, Lightbulb, ListTodo, Milestone as MilestoneIcon, Pencil, Plus, RefreshCw, Sparkles, Star, Timer, Trash2 } from "lucide-react";
import { daysBetween, dateKey, formatDate, milestoneProgress, TASK_PRIORITIES, TASK_PRIORITY_LABELS, PROJECT_STATUSES, relativeDay, statusLabel, timeAgo, type Activity, type Milestone, type Project, type Task, type TaskPriority } from "@/lib/types";
import { ProjectIcon, Spinner, Status } from "@/components/ui";
import type { WorkspaceActions } from "@/components/workspace-views";
import { MenuButton, MenuItem, MenuSeparator } from "@/components/menu";
import { computeStats, DueBadge, HealthBadge, PriorityBadge, ProgressBar, ProjectActionsMenu, projectHealth, STATUS_ICON, STATUS_TONE, type ProjectStats } from "@/components/project-parts";
import { ProjectsEmpty } from "@/components/projects-view";
import { completionPatch, PRIORITY_RANK } from "@/lib/tasks";

const byDue = (a: { dueDate: string | null }, b: { dueDate: string | null }) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31");

export function ProjectNotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="pj">
      <ProjectsEmpty icon={<FolderKanban size={24} strokeWidth={1.6} />} title="This project isn’t here anymore" description="It may have been deleted, or the link is out of date. Everything else in your workspace is just where you left it.">
        <button type="button" className="pj-btn is-primary" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />Back to projects</button>
      </ProjectsEmpty>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* overview cards                                                      */
/* ------------------------------------------------------------------ */

function ProgressCard({ project, stats }: { project: Project; stats: ProjectStats }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  return (
    <section className="pw-card pw-progress" aria-label="Project progress">
      <div className="pw-ring">
        <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
          <circle className="pw-ring-track" cx="48" cy="48" r={radius} />
          <circle className={`pw-ring-fill c-${project.color}`} cx="48" cy="48" r={radius} strokeDasharray={`${(stats.percent / 100) * circumference} ${circumference}`} transform="rotate(-90 48 48)" />
        </svg>
        <div><strong>{stats.percent}<small>%</small></strong><span>complete</span></div>
      </div>
      <div className="pw-progress-body">
        <h3>Progress</h3>
        <p>{stats.total ? `${stats.done} of ${stats.total} tasks done` : "No tasks yet — add the first step below."}</p>
        <dl className="pw-mini-stats">
          <div><dt>Done</dt><dd>{stats.done}</dd></div>
          <div><dt>Open</dt><dd>{stats.open}</dd></div>
          <div className={stats.overdue ? "is-alert" : ""}><dt>Overdue</dt><dd>{stats.overdue}</dd></div>
        </dl>
      </div>
    </section>
  );
}

function TimelineCard({ project, stats, today, onEdit }: { project: Project; stats: ProjectStats; today: string; onEdit: () => void }) {
  const { startDate: start, dueDate: due } = project;
  if (!start || !due) {
    return (
      <section className="pw-card pw-timeline is-empty" aria-label="Timeline">
        <header><h3><Timer size={15} aria-hidden="true" />Timeline</h3></header>
        <p>Add a start and due date to compare time elapsed against work completed.</p>
        <button type="button" className="pj-btn is-secondary is-sm" onClick={onEdit}><CalendarDays size={14} aria-hidden="true" />Set dates</button>
      </section>
    );
  }
  const total = Math.max(1, daysBetween(start, due));
  const dayNumber = Math.min(total, Math.max(0, daysBetween(start, today)));
  const elapsed = stats.elapsed ?? 0;
  const left = daysBetween(today, due);
  const schedule = project.status === "Completed" ? { key: "done", label: "Completed" }
    : left < 0 ? { key: "late", label: `${Math.abs(left)} day${left === -1 ? "" : "s"} past due` }
    : today < start ? { key: "upcoming", label: `Starts ${relativeDay(start, today).toLowerCase()}` }
    : stats.total === 0 ? { key: "neutral", label: "Add tasks to track pace" }
    : stats.percent - elapsed >= 10 ? { key: "ahead", label: "Ahead of schedule" }
    : stats.percent - elapsed >= -15 ? { key: "on", label: "On schedule" }
    : { key: "behind", label: "Behind schedule" };
  return (
    <section className="pw-card pw-timeline" aria-label="Timeline">
      <header><h3><Timer size={15} aria-hidden="true" />Timeline</h3><span className={`pw-schedule is-${schedule.key}`}>{schedule.label}</span></header>
      <div className="pw-track" role="img" aria-label={`${elapsed}% of the time window elapsed, ${stats.percent}% of the work complete`}>
        <i className="pw-track-time" style={{ width: `${elapsed}%` }} />
        <i className={`pw-track-work c-${project.color}`} style={{ width: `${stats.percent}%` }} />
        {today >= start && today <= due && <span className="pw-today" style={{ left: `${elapsed}%` }}><em>Today</em></span>}
      </div>
      <div className="pw-legend"><span><i className="is-time" />Time {elapsed}%</span><span><i className={`is-work c-${project.color}`} />Work {stats.percent}%</span></div>
      <footer>
        <div><small>Start</small><strong>{formatDate(start)}</strong></div>
        <span>{left >= 0 ? `${left} day${left === 1 ? "" : "s"} left · day ${dayNumber} of ${total}` : `Ended ${formatDate(due)}`}</span>
        <div><small>Due</small><strong>{formatDate(due)}</strong></div>
      </footer>
    </section>
  );
}

function MilestoneSummary({ milestones, today, onAdd }: { milestones: Milestone[]; today: string; onAdd: () => void }) {
  const reached = milestones.filter((milestone) => milestone.completed).length;
  const next = milestones.filter((milestone) => !milestone.completed).sort(byDue)[0];
  return (
    <section className="pw-card pw-ms-summary" aria-label="Milestone summary">
      <header><h3><MilestoneIcon size={15} aria-hidden="true" />Milestones</h3><span className="pw-ms-count">{reached}<small>/{milestones.length}</small></span></header>
      {milestones.length ? (
        <>
          <div className="pw-segments" aria-hidden="true">{milestones.map((milestone) => <i key={milestone.id} className={milestone.completed ? "is-done" : milestone.dueDate && milestone.dueDate < today ? "is-late" : ""} />)}</div>
          {next ? (
            <div className="pw-next"><small>Next up</small><strong>{next.title}</strong><DueBadge due={next.dueDate} today={today} /></div>
          ) : (
            <div className="pw-next is-complete"><Sparkles size={15} aria-hidden="true" />Every milestone reached</div>
          )}
        </>
      ) : (
        <>
          <p>Split this project into a few meaningful checkpoints.</p>
          <button type="button" className="pj-btn is-secondary is-sm" onClick={onAdd}><Plus size={14} aria-hidden="true" />Add a milestone</button>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* tasks                                                               */
/* ------------------------------------------------------------------ */

type TaskFilter = "open" | "overdue" | "done" | "all";
type TaskSort = "smart" | "due" | "priority" | "newest";

function TaskRow({ task, milestone, actions, today }: { task: Task; milestone?: Milestone; actions: WorkspaceActions; today: string }) {
  const pending = actions.pending.has(task.id);
  const late = !task.completed && !!task.dueDate && task.dueDate < today;
  const dueLabel = !task.dueDate ? "No date" : task.dueDate === today ? "Today" : late ? relativeDay(task.dueDate, today) : formatDate(task.dueDate);
  return (
    <li className={`pw-task ${task.completed ? "is-done" : ""} ${pending ? "is-pending" : ""}`}>
      <button type="button" className={`pw-check ${task.completed ? "is-checked" : ""}`} role="checkbox" aria-checked={task.completed} aria-label={`${task.completed ? "Mark as not done" : "Complete"}: ${task.title}`} disabled={pending} onClick={() => { void actions.mutate("tasks", "PATCH", completionPatch(!task.completed, task), task.id).catch(() => {}); }}>
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </button>
      <button type="button" className="pw-task-main" onClick={() => actions.openEditor({ kind: "tasks", item: task })}>
        <strong>{task.title}</strong>
        {(milestone || task.description) && (
          <span className="pw-task-meta">
            {milestone && <span className="pw-task-ms"><MilestoneIcon size={11} aria-hidden="true" />{milestone.title}</span>}
            {task.description && <span className="pw-task-desc">{task.description}</span>}
          </span>
        )}
      </button>
      <PriorityBadge priority={task.priority} />
      <span className={`pw-task-due ${late ? "is-late" : task.dueDate === today && !task.completed ? "is-today" : ""} ${!task.dueDate ? "is-none" : ""}`}><CalendarDays size={12} aria-hidden="true" />{dueLabel}</span>
      <button type="button" className="pj-icon-btn pw-task-edit" aria-label={`Edit ${task.title}`} onClick={() => actions.openEditor({ kind: "tasks", item: task })}><Pencil size={14} aria-hidden="true" /></button>
    </li>
  );
}

function ProjectTasks({ project, tasks, milestones, actions, today }: { project: Project; tasks: Task[]; milestones: Milestone[]; actions: WorkspaceActions; today: string }) {
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [sort, setSort] = useState<TaskSort>("smart");
  const [milestoneFilter, setMilestoneFilter] = useState("all");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("Medium");
  const [due, setDue] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const counts: Record<TaskFilter, number> = {
    open: tasks.filter((task) => !task.completed).length,
    overdue: tasks.filter((task) => !task.completed && !!task.dueDate && task.dueDate < today).length,
    done: tasks.filter((task) => task.completed).length,
    all: tasks.length,
  };
  const milestoneById = useMemo(() => new Map(milestones.map((milestone) => [milestone.id, milestone])), [milestones]);
  const validMilestoneFilter = milestoneFilter === "all" || milestoneFilter === "none" || milestoneById.has(milestoneFilter) ? milestoneFilter : "all";

  const list = tasks
    .filter((task) => filter === "all" || (filter === "done" ? task.completed : filter === "open" ? !task.completed : !task.completed && !!task.dueDate && task.dueDate < today))
    .filter((task) => validMilestoneFilter === "all" || (validMilestoneFilter === "none" ? !task.milestoneId : task.milestoneId === validMilestoneFilter))
    .sort((a, b) => {
      if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
      if (sort === "priority") return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byDue(a, b);
      if (sort === "due") return byDue(a, b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      return Number(a.completed) - Number(b.completed) || byDue(a, b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) { setError("Give the task a short name first."); inputRef.current?.focus(); return; }
    if (submitting.current) return; // guards against double submits within one tick
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await actions.mutate("tasks", "POST", { title: value, projectId: project.id, priority, dueDate: due || null, milestoneId: milestoneId && milestoneById.has(milestoneId) ? milestoneId : null });
      setTitle("");
      setDue("");
      if (filter === "done") setFilter("open");
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t add that task. Please try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const tabs: { key: TaskFilter; label: string }[] = [{ key: "open", label: "Open" }, { key: "overdue", label: "Overdue" }, { key: "done", label: "Completed" }, { key: "all", label: "All" }];

  return (
    <section className="pw-panel pw-tasks" aria-labelledby="pw-tasks-title">
      <header className="pw-panel-head">
        <div>
          <h2 id="pw-tasks-title"><ListTodo size={16} aria-hidden="true" />Tasks <span className="pj-count is-sm">{tasks.length}</span></h2>
          <p>{counts.open} open · {counts.done} completed{counts.overdue ? ` · ${counts.overdue} overdue` : ""}</p>
        </div>
        <div className="pw-panel-tools">
          {milestones.length > 0 && (
            <label className="pj-select is-sm">
              <MilestoneIcon size={13} aria-hidden="true" />
              <select value={validMilestoneFilter} onChange={(event) => setMilestoneFilter(event.target.value)} aria-label="Filter tasks by milestone">
                <option value="all">All milestones</option>
                {milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
                <option value="none">No milestone</option>
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
          )}
          <label className="pj-select is-sm">
            <select value={sort} onChange={(event) => setSort(event.target.value as TaskSort)} aria-label="Sort tasks">
              <option value="smart">Smart order</option>
              <option value="due">Due date</option>
              <option value="priority">Priority</option>
              <option value="newest">Newest first</option>
            </select>
            <ChevronDown size={13} aria-hidden="true" />
          </label>
        </div>
      </header>

      <form className={`pw-quick-add ${busy ? "is-busy" : ""}`} onSubmit={add} noValidate>
        <span className="pw-quick-icon" aria-hidden="true">{busy ? <Spinner size={15} /> : <Plus size={15} />}</span>
        <input ref={inputRef} value={title} onChange={(event) => { setTitle(event.target.value); if (error) setError(""); }} placeholder={`Add a task to ${project.name}…`} aria-label="New task title" aria-invalid={Boolean(error)} maxLength={200} />
        <div className="pw-quick-fields">
          <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} aria-label="New task priority">{TASK_PRIORITIES.map((value) => <option key={value} value={value}>{TASK_PRIORITY_LABELS[value]}</option>)}</select>
          <input type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label="New task due date" />
          {milestones.length > 0 && (
            <select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)} aria-label="New task milestone">
              <option value="">No milestone</option>
              {milestones.filter((milestone) => !milestone.completed).map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
            </select>
          )}
          <button type="submit" className="pj-btn is-primary is-sm" disabled={busy}><CornerDownLeft size={13} aria-hidden="true" />Add</button>
        </div>
      </form>
      {error && <p className="pw-inline-error" role="alert">{error}</p>}

      <div className="pw-tabs" role="group" aria-label="Filter tasks">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" aria-pressed={filter === tab.key} className={`${filter === tab.key ? "is-active" : ""} ${tab.key === "overdue" && counts.overdue ? "has-alert" : ""}`} onClick={() => setFilter(tab.key)}>
            {tab.label}<span>{counts[tab.key]}</span>
          </button>
        ))}
      </div>

      {list.length ? (
        <ul className="pw-task-list">
          {list.map((task) => <TaskRow key={task.id} task={task} milestone={task.milestoneId ? milestoneById.get(task.milestoneId) : undefined} actions={actions} today={today} />)}
        </ul>
      ) : tasks.length ? (
        <ProjectsEmpty icon={filter === "overdue" ? <CircleCheck size={22} strokeWidth={1.6} /> : <ListTodo size={22} strokeWidth={1.6} />} title={filter === "overdue" ? "Nothing overdue" : filter === "done" ? "Nothing completed yet" : filter === "open" ? "Every task is done" : "No tasks match"} description={filter === "overdue" ? "Every open task is on time. Lovely." : filter === "open" ? "All caught up on this project. Add the next step above, or celebrate a little." : "Try another filter or milestone."} />
      ) : (
        <ProjectsEmpty icon={<ListTodo size={22} strokeWidth={1.6} />} title="Break it into small steps" description="This project doesn’t have any tasks yet. Add the first one above — small and specific works best.">
          <button type="button" className="pj-btn is-secondary is-sm" onClick={() => inputRef.current?.focus()}><Plus size={14} aria-hidden="true" />Add the first task</button>
        </ProjectsEmpty>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* milestones                                                          */
/* ------------------------------------------------------------------ */

function MilestoneItem({ milestone, tasks, actions, today, color }: { milestone: Milestone; tasks: Task[]; actions: WorkspaceActions; today: string; color: string }) {
  const progress = milestoneProgress(milestone, tasks);
  const pending = actions.pending.has(milestone.id);
  const late = !milestone.completed && !!milestone.dueDate && milestone.dueDate < today;
  const toggle = () => { void actions.mutate("milestones", "PATCH", { completed: !milestone.completed }, milestone.id).catch(() => {}); };
  return (
    <li className={`pw-ms ${milestone.completed ? "is-done" : ""} ${late ? "is-late" : ""} ${pending ? "is-pending" : ""}`}>
      <button type="button" className="pw-ms-check" role="checkbox" aria-checked={milestone.completed} aria-label={`${milestone.completed ? "Mark as not reached" : "Mark as reached"}: ${milestone.title}`} disabled={pending} onClick={toggle}>
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </button>
      <div className="pw-ms-body">
        <div className="pw-ms-top">
          <button type="button" className="pw-ms-title" onClick={() => actions.openEditor({ kind: "milestones", item: milestone })}>{milestone.title}</button>
          <MenuButton label={`Actions for milestone ${milestone.title}`} trigger={<Ellipsis size={15} aria-hidden="true" />} triggerClassName="pj-icon-btn is-sm" width={220}>
            {(close) => (
              <>
                <MenuItem icon={<Pencil size={15} />} onSelect={() => { close(); actions.openEditor({ kind: "milestones", item: milestone }); }}>Edit milestone</MenuItem>
                <MenuItem icon={<Plus size={15} />} onSelect={() => { close(); actions.openEditor({ kind: "tasks", defaults: { projectId: milestone.projectId, milestoneId: milestone.id } }); }}>Add a task to it</MenuItem>
                <MenuItem icon={<CircleCheck size={15} />} onSelect={() => { close(); toggle(); }}>{milestone.completed ? "Mark as not reached" : "Mark as reached"}</MenuItem>
                <MenuSeparator />
                <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => { close(); actions.deleteItem("milestones", milestone); }}>Delete milestone…</MenuItem>
              </>
            )}
          </MenuButton>
        </div>
        {milestone.description && <p>{milestone.description}</p>}
        <div className="pw-ms-meta">
          <DueBadge due={milestone.dueDate} today={today} completed={milestone.completed} />
          <span>{progress.total ? `${progress.done}/${progress.total} tasks` : "No linked tasks"}</span>
          <strong>{progress.percent}%</strong>
        </div>
        <ProgressBar size="sm" percent={progress.percent} color={milestone.completed ? "green" : color} label={`${milestone.title} progress`} />
      </div>
    </li>
  );
}

function ProjectMilestones({ project, milestones, tasks, actions, today }: { project: Project; milestones: Milestone[]; tasks: Task[]; actions: WorkspaceActions; today: string }) {
  const reached = milestones.filter((milestone) => milestone.completed).length;
  const add = () => actions.openEditor({ kind: "milestones", defaults: { projectId: project.id } });
  return (
    <section className="pw-panel pw-milestones" aria-labelledby="pw-ms-title">
      <header className="pw-panel-head">
        <div>
          <h2 id="pw-ms-title"><MilestoneIcon size={16} aria-hidden="true" />Milestones <span className="pj-count is-sm">{milestones.length}</span></h2>
          <p>{milestones.length ? `${reached} of ${milestones.length} reached` : "Checkpoints that make big goals feel doable"}</p>
        </div>
        <button type="button" className="pj-btn is-secondary is-sm" onClick={add}><Plus size={14} aria-hidden="true" />Add</button>
      </header>
      {milestones.length ? (
        <ol className="pw-ms-list">
          {milestones.map((milestone) => <MilestoneItem key={milestone.id} milestone={milestone} tasks={tasks} actions={actions} today={today} color={project.color} />)}
        </ol>
      ) : (
        <ProjectsEmpty icon={<MilestoneIcon size={22} strokeWidth={1.6} />} title="No milestones yet" description="Divide this project into a few meaningful achievements, then link tasks to each one to track it.">
          <button type="button" className="pj-btn is-secondary is-sm" onClick={add}><Plus size={14} aria-hidden="true" />Add a milestone</button>
        </ProjectsEmpty>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* activity                                                            */
/* ------------------------------------------------------------------ */

const ACTIVITY_STYLE: Record<string, { icon: typeof CheckCheck; tone: string }> = {
  complete: { icon: CheckCheck, tone: "green" },
  task: { icon: ListTodo, tone: "blue" },
  milestone: { icon: MilestoneIcon, tone: "violet" },
  idea: { icon: Lightbulb, tone: "amber" },
  project: { icon: FolderKanban, tone: "neutral" },
};

function dayLabel(iso: string, today: string) {
  const key = dateKey(new Date(iso));
  const diff = daysBetween(key, today);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? "This week" : "Earlier";
}

function ProjectActivity({ project, actions, today }: { project: Project; actions: WorkspaceActions; today: string }) {
  const [history, setHistory] = useState<{ status: "loading" | "ready" | "error"; items: Activity[] }>({ status: "loading", items: [] });
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workspace?projectActivity=${encodeURIComponent(project.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load activity.");
        return result.activities as Activity[];
      })
      .then((items) => { if (!cancelled) setHistory({ status: "ready", items }); })
      .catch(() => { if (!cancelled) setHistory((current) => ({ status: "error", items: current.items })); });
    return () => { cancelled = true; };
  }, [project.id, attempt]);

  // Merge persisted history with events created during this session.
  const items = useMemo(() => {
    const merged = new Map<string, Activity>();
    for (const activity of [...actions.data.activities.filter((entry) => entry.projectId === project.id), ...history.items]) merged.set(activity.id, activity);
    return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [actions.data.activities, history.items, project.id]);
  const shown = expanded ? items : items.slice(0, 7);

  return (
    <section className="pw-panel pw-activity" aria-labelledby="pw-activity-title">
      <header className="pw-panel-head">
        <div>
          <h2 id="pw-activity-title"><History size={16} aria-hidden="true" />Activity</h2>
          <p>Everything that happened on this project</p>
        </div>
      </header>
      {history.status === "loading" && !items.length ? (
        <div className="pw-activity-loading" aria-label="Loading activity" role="status">{[0, 1, 2].map((index) => <span key={index} className="pj-sk pw-sk-line" />)}</div>
      ) : history.status === "error" && !items.length ? (
        <ProjectsEmpty icon={<RefreshCw size={22} strokeWidth={1.6} />} title="Couldn’t load the history" description="Your work is safe — the activity feed just didn’t arrive.">
          <button type="button" className="pj-btn is-secondary is-sm" onClick={() => { setHistory({ status: "loading", items: [] }); setAttempt((value) => value + 1); }}><RefreshCw size={14} aria-hidden="true" />Try again</button>
        </ProjectsEmpty>
      ) : items.length ? (
        <>
          <ol className="pw-feed">
            {shown.map((activity, index) => {
              const style = ACTIVITY_STYLE[activity.type] ?? ACTIVITY_STYLE.project;
              const label = dayLabel(activity.createdAt, today);
              const showLabel = index === 0 || dayLabel(shown[index - 1].createdAt, today) !== label;
              return (
                <li key={activity.id}>
                  {showLabel && <span className="pw-feed-day">{label}</span>}
                  <div className="pw-feed-item">
                    <span className={`pw-feed-icon tone-${style.tone}`}><style.icon size={13} aria-hidden="true" /></span>
                    <div>
                      <p>{activity.text}</p>
                      <time dateTime={activity.createdAt} title={new Date(activity.createdAt).toLocaleString()}>{timeAgo(activity.createdAt)}</time>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {items.length > 7 && <button type="button" className="pj-link pw-feed-more" onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : `Show all ${items.length} events`}</button>}
        </>
      ) : (
        <ProjectsEmpty icon={<History size={22} strokeWidth={1.6} />} title="No activity yet" description="As you add tasks, reach milestones and update details, the story of this project will appear here." />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* the workspace                                                       */
/* ------------------------------------------------------------------ */

function StatusPicker({ project, actions }: { project: Project; actions: WorkspaceActions }) {
  return (
    <MenuButton label={`Status: ${statusLabel(project.status)}. Change status`} trigger={<><Status status={project.status} /><ChevronDown size={13} aria-hidden="true" /></>} triggerClassName="pw-status-trigger" width={210}>
      {(close) => PROJECT_STATUSES.map((status) => {
        const Icon = STATUS_ICON[status];
        return (
          <MenuItem key={status} checked={project.status === status} icon={<Icon size={15} className={`tone-text-${STATUS_TONE[status]}`} />} onSelect={() => { close(); if (status !== project.status) void actions.mutate("projects", "PATCH", { status }, project.id).catch(() => {}); }}>
            {statusLabel(status)}
          </MenuItem>
        );
      })}
    </MenuButton>
  );
}

export function ProjectWorkspace({ project, actions, onBack }: { project: Project; actions: WorkspaceActions; onBack: () => void }) {
  const today = dateKey();
  const stats = computeStats(project, actions.data, today);
  const health = projectHealth(project, stats, today);
  const tasks = actions.data.tasks.filter((task) => task.projectId === project.id);
  const milestones = actions.data.milestones.filter((milestone) => milestone.projectId === project.id).sort((a, b) => byDue(a, b) || a.createdAt.localeCompare(b.createdAt));
  const edit = () => actions.openEditor({ kind: "projects", item: project });

  useEffect(() => {
    const previous = document.title;
    document.title = `${project.name} · Projects · folio`;
    return () => { document.title = previous; };
  }, [project.name]);

  return (
    <div className="pj pw">
      <nav className="pw-crumbs" aria-label="Breadcrumb">
        <button type="button" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />Projects</button>
        <ChevronRight size={13} aria-hidden="true" />
        <span aria-current="page">{project.name}</span>
      </nav>

      <header className={`pw-hero c-${project.color}`}>
        <span className="pw-hero-wash" aria-hidden="true" />
        <div className="pw-hero-main">
          <ProjectIcon icon={project.icon} color={project.color} />
          <div className="pw-hero-copy">
            <div className="pw-kicker">
              <span>{project.category}</span>
              {project.archived && <span className="pw-archived"><Archive size={12} aria-hidden="true" />Archived</span>}
              <span className="pw-kicker-dim">Created {formatDate(project.createdAt.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })} · updated {timeAgo(project.updatedAt || project.createdAt)}</span>
            </div>
            <h1>{project.name}</h1>
            <p className={project.description ? "" : "is-placeholder"}>{project.description || "No description yet. Add the goal, the why, or the definition of done."}</p>
            <div className="pw-props">
              <StatusPicker project={project} actions={actions} />
              <PriorityBadge priority={project.priority} />
              <span className={`pj-due ${project.startDate ? "" : "is-none"}`}><CalendarDays size={12} aria-hidden="true" /><span className="pj-due-prefix">Start</span>{project.startDate ? formatDate(project.startDate) : "not set"}</span>
              <DueBadge due={project.dueDate} today={today} completed={project.status === "Completed"} prefix="Due" />
              <HealthBadge health={health} />
            </div>
          </div>
        </div>
        <div className="pw-hero-actions">
          <button type="button" className={`pj-icon-btn is-boxed pj-star ${project.favorite ? "is-on" : ""}`} aria-pressed={project.favorite} aria-label={project.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => { void actions.mutate("projects", "PATCH", { favorite: !project.favorite }, project.id).catch(() => {}); }}>
            <Star size={16} fill={project.favorite ? "currentColor" : "none"} aria-hidden="true" />
          </button>
          <button type="button" className="pj-btn is-secondary" onClick={edit}><Pencil size={15} aria-hidden="true" />Edit</button>
          <button type="button" className="pj-btn is-primary" onClick={() => actions.openEditor({ kind: "tasks", defaults: { projectId: project.id } })}><Plus size={16} aria-hidden="true" />Add task<kbd>T</kbd></button>
          <ProjectActionsMenu project={project} actions={actions} showOpen={false} triggerClassName="pj-icon-btn is-boxed" />
        </div>
      </header>

      <div className="pw-overview">
        <ProgressCard project={project} stats={stats} />
        <TimelineCard project={project} stats={stats} today={today} onEdit={edit} />
        <MilestoneSummary milestones={milestones} today={today} onAdd={() => actions.openEditor({ kind: "milestones", defaults: { projectId: project.id } })} />
      </div>

      <div className="pw-grid">
        <ProjectTasks project={project} tasks={tasks} milestones={milestones} actions={actions} today={today} />
        <div className="pw-side">
          <ProjectMilestones project={project} milestones={milestones} tasks={tasks} actions={actions} today={today} />
          <ProjectActivity key={project.id} project={project} actions={actions} today={today} />
        </div>
      </div>
    </div>
  );
}
