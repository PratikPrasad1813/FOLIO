"use client";
import { regionalDate, regionalPreferences, regionalTimezone, personalAddress } from "@/lib/personalization";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock3,
  Flag,
  FolderKanban,
  Lightbulb,
  ListTodo,
  Plus,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { dateKey, formatDate, projectProgress, type Project, type Task, type View } from "@/lib/types";
import { getZonedParts } from "@/lib/timezone";
import { addDays, weekStart as weekStartKey } from "@/lib/tasks";
import { ProjectIcon, Status } from "@/components/ui";
import { completionPatch } from "@/lib/tasks";
import type { WorkspaceActions } from "@/components/workspace-views";
import { WorkspaceConcierge } from "@/components/workspace-concierge";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function timeAgo(date: string) {
  const minutes = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  const days = Math.floor(minutes / 1440);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

function msSince(date: string) {
  return Date.now() - new Date(date).getTime();
}

function shiftKey(offset: number) {
  return addDays(dateKey(), offset);
}

function daysBetween(from: string, to: string) {
  const a = new Date(`${from.slice(0, 10)}T12:00:00`).getTime();
  const b = new Date(`${to.slice(0, 10)}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function relativeDay(due: string, today: string) {
  const diff = daysBetween(today, due);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${Math.abs(diff)} days late`;
  if (diff < 7) return `in ${diff} days`;
  if (diff < 14) return "next week";
  return `in ${Math.ceil(diff / 7)} weeks`;
}

const PRIORITY_WEIGHT: Record<string, number> = { Urgent: -1, High: 0, Medium: 1, Low: 2, None: 3 };

/* ------------------------------------------------------------------ */
/* welcome header                                                      */
/* ------------------------------------------------------------------ */

function WelcomeHeader({
  actions,
  dueToday,
  overdue,
  weekDone,
  weeklyPercent,
}: {
  actions: WorkspaceActions;
  dueToday: number;
  overdue: number;
  weekDone: number;
  weeklyPercent: number;
}) {
  const now = new Date();
  const hour = getZonedParts(now, regionalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone).hour;
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = actions.data.user.greetingName || personalAddress(actions.data.user.name, actions.data.user.personal);
  const longDate = regionalDate(now, { weekday: "long", month: "long", day: "numeric" });

  const summary = overdue
    ? `${dueToday} ${dueToday === 1 ? "task is" : "tasks are"} due today and ${overdue} slipped past their date.`
    : dueToday
      ? `${dueToday} ${dueToday === 1 ? "task is" : "tasks are"} due today. Nothing overdue — lovely.`
      : "Nothing is due today. A good day to move something forward.";

  const quickActions = [
    { label: "New project", icon: Plus, onClick: () => actions.openEditor({ kind: "projects" }), primary: true },
    { label: "Add task", icon: ListTodo, onClick: () => actions.openEditor({ kind: "tasks", defaults: { dueDate: dateKey() } }) },
    { label: "Capture idea", icon: Lightbulb, onClick: () => actions.openEditor({ kind: "ideas" }) },
    { label: "Open calendar", icon: CalendarDays, onClick: () => actions.navigate("calendar") },
  ];

  const ringLength = 2 * Math.PI * 34;

  return (
    <section className="dash-hero dash-rise">
      <div className="dash-hero-copy">
        <span className="dash-hero-date">
          <CalendarDays size={13} strokeWidth={1.9} />
          {longDate}
        </span>
        <h1>
          Good {partOfDay}, {firstName}
          <span className="dash-hero-wave" aria-hidden="true">
            ✦
          </span>
        </h1>
        <p>{summary}</p>
        <div className="dash-quick-actions">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`dash-quick ${action.primary ? "is-primary" : ""}`}
              onClick={action.onClick}
            >
              <action.icon size={15} strokeWidth={1.9} />
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dash-hero-focus">
        <div className="dash-focus-head">
          <span>
            <Target size={14} strokeWidth={1.9} />
            Weekly focus
          </span>
          <button type="button" className="dash-ghost-icon" aria-label="Adjust your weekly goal" onClick={() => actions.navigate("settings")}>
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="dash-focus-body">
          <div className="dash-ring">
            <svg width="82" height="82" viewBox="0 0 82 82" aria-hidden="true">
              <circle cx="41" cy="41" r="34" fill="none" stroke="var(--dash-ring-track)" strokeWidth="7" />
              <circle
                cx="41"
                cy="41"
                r="34"
                fill="none"
                stroke="url(#dashRing)"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={`${(weeklyPercent / 100) * ringLength} ${ringLength}`}
                transform="rotate(-90 41 41)"
              />
              <defs>
                <linearGradient id="dashRing" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#a08bd9" />
                  <stop offset="100%" stopColor="#7fb79c" />
                </linearGradient>
              </defs>
            </svg>
            <strong>
              {weeklyPercent}
              <span>%</span>
            </strong>
          </div>
          <div className="dash-focus-meta">
            <strong>
              {weekDone}
              <span> / {actions.data.user.weeklyGoal}</span>
            </strong>
            <p>tasks completed this week</p>
            <span className="dash-focus-note">
              {weeklyPercent >= 100 ? "Goal reached \u2728" : weeklyPercent >= 50 ? "Over halfway \u2728" : "One step closer \u2728"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* overview statistics                                                 */
/* ------------------------------------------------------------------ */

interface StatCard {
  label: string;
  value: number;
  note: string;
  icon: typeof FolderKanban;
  tone: "violet" | "blue" | "green" | "amber";
  percent: number;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  view: View;
}

function StatGrid({ stats, actions }: { stats: StatCard[]; actions: WorkspaceActions }) {
  return (
    <div className="dash-stat-grid">
      {stats.map((stat, index) => (
        <button
          key={stat.label}
          type="button"
          className={`dash-stat tone-${stat.tone} dash-rise`}
          style={{ animationDelay: `${60 + index * 50}ms` }}
          onClick={() => actions.navigate(stat.view)}
        >
          <span className="dash-stat-head">
            <span className="dash-stat-icon">
              <stat.icon size={16} strokeWidth={1.85} />
            </span>
            <span className="dash-stat-label">{stat.label}</span>
            {stat.trend && (
              <span className={`dash-trend trend-${stat.trend.direction}`}>
                {stat.trend.direction === "down" ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
                {stat.trend.label}
              </span>
            )}
          </span>
          <span className="dash-stat-value">{new Intl.NumberFormat(regionalPreferences().locale, { minimumIntegerDigits: 2 }).format(stat.value)}</span>
          <span className="dash-stat-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, Math.max(4, stat.percent))}%` }} />
          </span>
          <span className="dash-stat-note">{stat.note}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* projects                                                            */
/* ------------------------------------------------------------------ */

function DashProjectCard({ project, actions }: { project: Project; actions: WorkspaceActions }) {
  const progress = projectProgress(project.id, actions.data.tasks);
  const today = dateKey();
  const late = !!project.dueDate && project.dueDate < today && project.status !== "Completed";

  return (
    <article className="dash-project">
      <header>
        <button type="button" className="dash-project-id" onClick={() => actions.openProject(project.id)}>
          <ProjectIcon icon={project.icon} color={project.color} small />
          <span>
            <strong>{project.name}</strong>
            <small>{project.category}</small>
          </span>
        </button>
        <Status status={project.status} />
      </header>

      <p className="dash-project-copy">{project.description || "A fresh start. Add a description and make this project your own."}</p>

      <div className="dash-project-progress">
        <div>
          <span>{progress.done} of {progress.total || 0} tasks</span>
          <strong>{progress.percent}%</strong>
        </div>
        <span className="dash-track">
          <i className={`fill-${project.color}`} style={{ width: `${progress.percent}%` }} />
        </span>
      </div>

      <footer>
        <span className={`dash-chip ${late ? "is-late" : ""}`}>
          <CalendarDays size={12} />
          {project.dueDate ? (late ? `${formatDate(project.dueDate)} · late` : formatDate(project.dueDate)) : "No deadline"}
        </span>
        <span className={`dash-chip priority-${project.priority.toLowerCase()}`}>
          <Flag size={11} />
          {project.priority}
        </span>
        <button type="button" className="dash-project-open" onClick={() => actions.openProject(project.id)} aria-label={`Open ${project.name}`}>
          <ArrowUpRight size={15} />
        </button>
      </footer>
    </article>
  );
}

function ProjectSection({ actions }: { actions: WorkspaceActions }) {
  const [filter, setFilter] = useState("Active");
  const projects = useMemo(() => actions.data.projects.filter((project) => !project.archived), [actions.data.projects]);

  const filters = useMemo(
    () => [
      { label: "Active", count: projects.filter((project) => project.status === "In progress").length },
      { label: "Planning", count: projects.filter((project) => project.status === "Planning").length },
      { label: "Completed", count: projects.filter((project) => project.status === "Completed").length },
      { label: "All", count: projects.length },
    ],
    [projects],
  );

  const visible = useMemo(() => {
    const matched = projects.filter((project) =>
      filter === "All" ? true : filter === "Active" ? project.status === "In progress" : project.status === filter,
    );
    return [...matched]
      .sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"))
      .slice(0, 4);
  }, [projects, filter]);

  return (
    <section className="dash-panel dash-rise" style={{ animationDelay: "160ms" }}>
      <header className="dash-panel-head">
        <div>
          <h2>
            Projects in motion <span className="dash-count">{projects.length}</span>
          </h2>
          <p>Sorted by what needs you soonest.</p>
        </div>
        <button type="button" className="dash-link" onClick={() => actions.navigate("projects")}>
          View all <ArrowRight size={14} />
        </button>
      </header>

      <div className="dash-chips" role="tablist" aria-label="Filter projects">
        {filters.map((entry) => (
          <button
            key={entry.label}
            type="button"
            role="tab"
            aria-selected={filter === entry.label}
            className={`dash-filter ${filter === entry.label ? "is-active" : ""}`}
            onClick={() => setFilter(entry.label)}
          >
            {entry.label === "Planning" ? "Planned" : entry.label}
            <span>{entry.count}</span>
          </button>
        ))}
      </div>

      {visible.length ? (
        <div className="dash-project-grid">
          {visible.map((project) => (
            <DashProjectCard key={project.id} project={project} actions={actions} />
          ))}
          <button
            type="button"
            className={`dash-project-new ${visible.length % 2 === 1 ? "is-inline" : ""}`}
            onClick={() => actions.openEditor({ kind: "projects" })}
          >
            <span>
              <Plus size={16} />
            </span>
            Make room for something new
          </button>
        </div>
      ) : (
        <div className="dash-empty">
          <FolderKanban size={22} strokeWidth={1.5} />
          <p>No {filter.toLowerCase()} projects right now.</p>
          <button type="button" className="dash-quick is-primary" onClick={() => actions.openEditor({ kind: "projects" })}>
            <Plus size={15} /> Start a project
          </button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* today's priority tasks                                              */
/* ------------------------------------------------------------------ */

function TodayPanel({ actions, tasks, doneToday }: { actions: WorkspaceActions; tasks: Task[]; doneToday: number }) {
  const today = dateKey();
  const total = tasks.length + doneToday;
  const percent = total ? Math.round((doneToday / total) * 100) : 0;

  return (
    <section className="dash-panel dash-rise" style={{ animationDelay: "200ms" }}>
      <header className="dash-panel-head">
        <div>
          <h2>Today&rsquo;s priorities</h2>
          <p>
            {doneToday} of {total || 0} done · {percent}% through the day&rsquo;s list
          </p>
        </div>
        <button type="button" className="dash-link" onClick={() => actions.navigate("tasks")}>
          All tasks <ArrowRight size={14} />
        </button>
      </header>

      <span className="dash-track dash-track-wide" aria-hidden="true">
        <i className="fill-green" style={{ width: `${percent}%` }} />
      </span>

      {tasks.length ? (
        <ul className="dash-task-list">
          {tasks.map((task) => {
            // A task's project may have been deleted (projectId becomes null),
            // so never assume the relationship resolves.
            const project = task.projectId ? actions.data.projects.find((entry) => entry.id === task.projectId) : undefined;
            const late = !!task.dueDate && task.dueDate < today;
            return (
              <li key={task.id} className={`dash-task ${actions.pending.has(task.id) ? "is-pending" : ""}`}>
                <button
                  type="button"
                  className="dash-check"
                  role="checkbox"
                  aria-checked={false}
                  aria-label={`Complete ${task.title}`}
                  disabled={actions.pending.has(task.id)}
                  onClick={() => {
                    void actions
                      .mutate("tasks", "PATCH", completionPatch(true, task), task.id)
                      .catch(() => {});
                  }}
                >
                  <Check size={12} strokeWidth={3} />
                </button>
                <button type="button" className="dash-task-body" onClick={() => actions.openEditor({ kind: "tasks", item: task })}>
                  <strong>{task.title}</strong>
                  <span>
                    <i className={`dash-dot dot-${project?.color || "gray"}`} />
                    {project?.name || "Personal task"}
                    {late && <em className="dash-late">· {relativeDay(task.dueDate as string, today)}</em>}
                  </span>
                </button>
                {task.priority !== "None" && <span className={`dash-pill priority-${task.priority.toLowerCase()}`}>{task.priority}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="dash-empty compact">
          <CircleCheck size={22} strokeWidth={1.5} />
          <p>Today is clear. Pull something forward, or enjoy the quiet.</p>
          <button type="button" className="dash-quick" onClick={() => actions.openEditor({ kind: "tasks", defaults: { dueDate: today } })}>
            <Plus size={15} /> Add a task
          </button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* upcoming deadlines                                                  */
/* ------------------------------------------------------------------ */

interface Deadline {
  id: string;
  title: string;
  meta: string;
  due: string;
  kind: "project" | "task";
  color: string;
  icon: string;
  onOpen: () => void;
}

function DeadlinesPanel({ actions, deadlines }: { actions: WorkspaceActions; deadlines: Deadline[] }) {
  const today = dateKey();
  return (
    <section className="dash-panel dash-rise" style={{ animationDelay: "240ms" }}>
      <header className="dash-panel-head">
        <div>
          <h2>Upcoming deadlines</h2>
          <p>The next two weeks, at a glance.</p>
        </div>
        <button type="button" className="dash-link" onClick={() => actions.navigate("calendar")}>
          Calendar <ArrowRight size={14} />
        </button>
      </header>

      {deadlines.length ? (
        <ul className="dash-deadlines">
          {deadlines.map((entry) => {
            const diff = daysBetween(today, entry.due);
            return (
              <li key={`${entry.kind}-${entry.id}`}>
                <button type="button" onClick={entry.onOpen}>
                  <span className={`dash-date-chip ${diff <= 1 ? "is-soon" : ""}`}>
                    <strong>{new Date(`${entry.due}T12:00:00`).toLocaleDateString("en-US", { day: "numeric" })}</strong>
                    <small>{new Date(`${entry.due}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</small>
                  </span>
                  <span className="dash-deadline-body">
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.kind === "project" ? <FolderKanban size={11} /> : <ListTodo size={11} />}
                      {entry.meta}
                    </small>
                  </span>
                  <span className={`dash-deadline-when ${diff <= 1 ? "is-soon" : ""}`}>
                    <Clock3 size={11} />
                    {relativeDay(entry.due, today)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="dash-empty compact">
          <CalendarDays size={22} strokeWidth={1.5} />
          <p>No deadlines in the next two weeks.</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* activity feed                                                       */
/* ------------------------------------------------------------------ */

function ActivityPanel({ actions }: { actions: WorkspaceActions }) {
  const items = actions.data.activities.slice(0, 6);
  return (
    <section className="dash-panel dash-activity dash-rise" style={{ animationDelay: "280ms" }}>
      <header className="dash-panel-head">
        <div>
          <h2>Recent activity</h2>
          <p>Every small win, logged.</p>
        </div>
        <span className="dash-live">
          <i />
          Live
        </span>
      </header>

      {items.length ? (
        <ul className="dash-feed">
          {items.map((activity) => {
            const isDone = activity.type === "complete" || activity.type === "task";
            const Icon = isDone ? CheckCheck : activity.type === "idea" ? Lightbulb : activity.type === "milestone" ? Flag : FolderKanban;
            const tone = isDone ? "green" : activity.type === "idea" ? "amber" : "violet";
            return (
              <li key={activity.id}>
                <span className={`dash-feed-icon tone-${tone}`}>
                  <Icon size={13} strokeWidth={1.9} />
                </span>
                <span>
                  <p>{activity.text}</p>
                  <small>{timeAgo(activity.createdAt)}</small>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="dash-empty compact">
          <Sparkles size={22} strokeWidth={1.5} />
          <p>Your story starts here. Create something and we&rsquo;ll keep track.</p>
        </div>
      )}

      <footer className="dash-feed-footer">
        <Sparkles size={14} />
        Good things are taking shape.
      </footer>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* the dashboard                                                       */
/* ------------------------------------------------------------------ */

export function OverviewPanel({ actions, onReload }: { actions: WorkspaceActions; onReload?: () => void }) {
  const { data } = actions;
  const today = dateKey();
  const horizon = shiftKey(14);

  const metrics = useMemo(() => {
    const weekStart = weekStartKey(today);

    const openTasks = data.tasks.filter((task) => !task.completed);
    const completedTasks = data.tasks.filter((task) => task.completed);
    const overdueTasks = openTasks.filter((task) => !!task.dueDate && task.dueDate < today);
    const dueTodayTasks = openTasks.filter((task) => task.dueDate === today);
    const doneToday = completedTasks.filter((task) => task.completedAt && dateKey(new Date(task.completedAt)) === today).length;

    const weekDone = completedTasks.filter((task) => task.completedAt && dateKey(new Date(task.completedAt)) >= weekStart).length;
    const last7 = completedTasks.filter((task) => task.completedAt && msSince(task.completedAt) <= 7 * 86_400_000).length;
    const prev7 = completedTasks.filter((task) => {
      if (!task.completedAt) return false;
      const age = msSince(task.completedAt);
      return age > 7 * 86_400_000 && age <= 14 * 86_400_000;
    }).length;

    const liveProjects = data.projects.filter((project) => !project.archived);
    const activeProjects = liveProjects.filter((project) => project.status === "In progress");
    // Analytics stay meaningful with no tasks at all.
    const completionRate = data.tasks.length ? Math.round((completedTasks.length / data.tasks.length) * 100) : 0;

    const priorityTasks = [...openTasks]
      .filter((task) => !task.dueDate || task.dueDate <= today)
      .sort((a, b) => {
        const byPriority = (PRIORITY_WEIGHT[a.priority] ?? 1) - (PRIORITY_WEIGHT[b.priority] ?? 1);
        if (byPriority) return byPriority;
        return (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31");
      })
      .slice(0, 5);

    const taskDeadlines: Deadline[] = openTasks
      .filter((task) => !!task.dueDate && task.dueDate >= today && task.dueDate <= horizon)
      .map((task) => ({
        id: task.id,
        title: task.title,
        // Fall back gracefully when the task's project was deleted.
        meta: (task.projectId ? data.projects.find((project) => project.id === task.projectId)?.name : undefined) || "Personal task",
        due: task.dueDate as string,
        kind: "task" as const,
        color: (task.projectId ? data.projects.find((project) => project.id === task.projectId)?.color : undefined) || "violet",
        icon: "layout",
        onOpen: () => actions.openEditor({ kind: "tasks", item: task }),
      }));

    const projectDeadlines: Deadline[] = data.projects
      .filter((project) => !project.archived && !!project.dueDate && project.dueDate >= today && project.dueDate <= horizon && project.status !== "Completed")
      .map((project) => ({
        id: project.id,
        title: project.name,
        meta: `Project · ${project.category}`,
        due: project.dueDate as string,
        kind: "project" as const,
        color: project.color,
        icon: project.icon,
        onOpen: () => actions.openProject(project.id),
      }));

    const deadlines = [...projectDeadlines, ...taskDeadlines].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6);

    const weeklyPercent = Math.min(100, Math.round((weekDone / Math.max(1, data.user.weeklyGoal)) * 100));

    return {
      openTasks,
      completedTasks,
      overdueTasks,
      dueTodayTasks,
      doneToday,
      weekDone,
      weeklyPercent,
      last7,
      prev7,
      activeProjects,
      liveProjects,
      completionRate,
      priorityTasks,
      deadlines,
    };
  }, [data, today, horizon, actions]);

  const trendDelta = metrics.prev7 ? Math.round(((metrics.last7 - metrics.prev7) / metrics.prev7) * 100) : metrics.last7 ? 100 : 0;

  const stats: StatCard[] = [
    {
      label: "Active projects",
      value: metrics.activeProjects.length,
      note: `${metrics.liveProjects.length} total · ${metrics.liveProjects.filter((project) => project.status === "Planning").length} planned`,
      icon: CircleDashed,
      tone: "violet",
      percent: metrics.liveProjects.length ? (metrics.activeProjects.length / metrics.liveProjects.length) * 100 : 0,
      view: "projects",
    },
    {
      label: "Pending tasks",
      value: metrics.openTasks.length,
      note: metrics.dueTodayTasks.length ? `${metrics.dueTodayTasks.length} due today` : "Nothing due today",
      icon: ListTodo,
      tone: "blue",
      percent: data.tasks.length ? (metrics.openTasks.length / data.tasks.length) * 100 : 0,
      view: "tasks",
    },
    {
      label: "Completed tasks",
      value: metrics.completedTasks.length,
      note: `${metrics.weekDone} finished this week · ${metrics.completionRate}% of all work`,
      icon: CircleCheck,
      tone: "green",
      percent: metrics.completionRate,
      trend: {
        direction: trendDelta >= 0 ? "up" : "down",
        label: `${trendDelta >= 0 ? "+" : ""}${trendDelta}%`,
      },
      view: "tasks",
    },
    {
      label: "Overdue tasks",
      value: metrics.overdueTasks.length,
      note: metrics.overdueTasks.length ? "Worth a few minutes today" : "All clear — nothing is late",
      icon: CircleAlert,
      tone: "amber",
      percent: metrics.openTasks.length ? (metrics.overdueTasks.length / metrics.openTasks.length) * 100 : 0,
      view: "tasks",
    },
  ];

  return (
    <div className="dash">
      <WelcomeHeader
        actions={actions}
        dueToday={metrics.dueTodayTasks.length}
        overdue={metrics.overdueTasks.length}
        weekDone={metrics.weekDone}
        weeklyPercent={metrics.weeklyPercent}
      />

      <WorkspaceConcierge actions={actions} onReload={onReload} />

      <StatGrid stats={stats} actions={actions} />

      <div className="dash-grid">
        <div className="dash-column">
          <ProjectSection actions={actions} />
          <TodayPanel actions={actions} tasks={metrics.priorityTasks} doneToday={metrics.doneToday} />
        </div>
        <aside className="dash-column">
          <DeadlinesPanel actions={actions} deadlines={metrics.deadlines} />
          <ActivityPanel actions={actions} />
        </aside>
      </div>
    </div>
  );
}

export default OverviewPanel;
