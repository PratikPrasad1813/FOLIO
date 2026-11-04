"use client";

import type { CSSProperties } from "react";
import { Archive, ArchiveRestore, CalendarClock, CalendarDays, CircleCheck, CircleDashed, CirclePause, CirclePlay, Ellipsis, Flag, FolderOpen, Pencil, Star, Trash2 } from "lucide-react";
import { daysBetween, formatDate, PROJECT_STATUSES, relativeDay, statusLabel, type Milestone, type Project, type TaskPriority, type ProjectStatus, type WorkspaceData } from "@/lib/types";
import type { WorkspaceActions } from "@/components/workspace-views";
import { MenuButton, MenuItem, MenuLabel, MenuSeparator } from "@/components/menu";

export interface ProjectStats {
  total: number;
  done: number;
  open: number;
  percent: number;
  overdue: number;
  milestones: number;
  milestonesDone: number;
  nextMilestone: Milestone | null;
  /** Share of the start → due window already elapsed (0–100), when both dates exist. */
  elapsed: number | null;
}

export function computeStats(project: Project, data: WorkspaceData, today: string): ProjectStats {
  const tasks = data.tasks.filter((task) => task.projectId === project.id);
  const done = tasks.filter((task) => task.completed).length;
  const overdue = tasks.filter((task) => !task.completed && !!task.dueDate && task.dueDate < today).length;
  const milestones = data.milestones.filter((milestone) => milestone.projectId === project.id);
  const nextMilestone = milestones.filter((milestone) => !milestone.completed).sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"))[0] ?? null;
  let elapsed: number | null = null;
  if (project.startDate && project.dueDate) {
    const span = daysBetween(project.startDate, project.dueDate);
    elapsed = span <= 0 ? (today >= project.dueDate ? 100 : 0) : Math.min(100, Math.max(0, Math.round((daysBetween(project.startDate, today) / span) * 100)));
  }
  return {
    total: tasks.length,
    done,
    open: tasks.length - done,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    overdue,
    milestones: milestones.length,
    milestonesDone: milestones.filter((milestone) => milestone.completed).length,
    nextMilestone,
    elapsed,
  };
}

export type HealthKey = "done" | "paused" | "archived" | "overdue" | "risk" | "track" | "idle";

/** A single, honest signal about how a project is doing, derived from real data. */
export function projectHealth(project: Project, stats: ProjectStats, today: string): { key: HealthKey; label: string; hint: string } {
  if (project.archived) return { key: "archived", label: "Archived", hint: "Hidden from active projects" };
  if (project.status === "Completed") return { key: "done", label: "Completed", hint: "Wrapped up — nice work" };
  if (project.status === "On hold") return { key: "paused", label: "Paused", hint: "On hold for now" };
  if (project.dueDate && project.dueDate < today) return { key: "overdue", label: "Overdue", hint: `Deadline was ${formatDate(project.dueDate)}` };
  if (stats.overdue > 0) return { key: "risk", label: "At risk", hint: `${stats.overdue} overdue task${stats.overdue === 1 ? "" : "s"}` };
  if (stats.elapsed !== null && stats.total > 0 && stats.percent + 20 < stats.elapsed) return { key: "risk", label: "Behind", hint: `${stats.elapsed}% of the time used, ${stats.percent}% done` };
  if (project.dueDate && daysBetween(today, project.dueDate) <= 3 && stats.percent < 70) return { key: "risk", label: "Due soon", hint: `Due ${relativeDay(project.dueDate, today).toLowerCase()}` };
  if (project.status === "Planning" && stats.done === 0) return { key: "idle", label: "Not started", hint: "Planned — ready when you are" };
  return { key: "track", label: "On track", hint: stats.total ? `${stats.open} task${stats.open === 1 ? "" : "s"} to go` : "Moving along" };
}

export const STATUS_TONE: Record<ProjectStatus, "violet" | "blue" | "amber" | "green"> = { Planning: "violet", "In progress": "blue", "On hold": "amber", Completed: "green" };
export const STATUS_ICON: Record<ProjectStatus, typeof CircleDashed> = { Planning: CircleDashed, "In progress": CirclePlay, "On hold": CirclePause, Completed: CircleCheck };

export function HealthBadge({ health }: { health: { key: HealthKey; label: string; hint: string } }) {
  return (
    <span className={`pj-health is-${health.key}`} title={health.hint}>
      <i aria-hidden="true" />
      {health.label}
    </span>
  );
}

export function PriorityBadge({ priority, compact = false }: { priority: TaskPriority; compact?: boolean }) {
  return (
    <span className={`pj-priority is-${priority.toLowerCase()}`} title={`${priority} priority`}>
      <Flag size={11} strokeWidth={2.2} aria-hidden="true" />
      {priority === "None" ? (compact ? "None" : "No priority") : priority}
    </span>
  );
}

export function DueBadge({ due, today, completed = false, prefix }: { due: string | null; today: string; completed?: boolean; prefix?: string }) {
  if (!due) return <span className="pj-due is-none"><CalendarDays size={12} aria-hidden="true" />{prefix ? `${prefix} not set` : "No deadline"}</span>;
  const diff = daysBetween(today, due);
  const tone = completed ? "is-done" : diff < 0 ? "is-late" : diff <= 3 ? "is-soon" : "";
  return (
    <span className={`pj-due ${tone}`} title={formatDate(due, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>
      {diff < 0 && !completed ? <CalendarClock size={12} aria-hidden="true" /> : <CalendarDays size={12} aria-hidden="true" />}
      {prefix && <span className="pj-due-prefix">{prefix}</span>}
      {formatDate(due)}
      {!completed && <em>· {relativeDay(due, today)}</em>}
    </span>
  );
}

export function ProgressBar({ percent, color, label, size = "md" }: { percent: number; color: string; label: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`pj-bar is-${size}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <i className={`c-${color}`} style={{ "--pj-progress": `${percent}%` } as CSSProperties} />
    </span>
  );
}

export function ProjectActionsMenu({ project, actions, showOpen = true, triggerClassName = "pj-icon-btn" }: { project: Project; actions: WorkspaceActions; showOpen?: boolean; triggerClassName?: string }) {
  const patch = (values: Record<string, unknown>) => { void actions.mutate("projects", "PATCH", values, project.id).catch(() => {}); };
  return (
    <MenuButton label={`Actions for ${project.name}`} trigger={<Ellipsis size={17} aria-hidden="true" />} triggerClassName={triggerClassName}>
      {(close) => (
        <>
          {showOpen && <MenuItem icon={<FolderOpen size={15} />} onSelect={() => { close(); actions.openProject(project.id); }}>Open project</MenuItem>}
          <MenuItem icon={<Pencil size={15} />} onSelect={() => { close(); actions.openEditor({ kind: "projects", item: project }); }}>Edit details</MenuItem>
          <MenuItem icon={<Star size={15} />} onSelect={() => { close(); patch({ favorite: !project.favorite }); }}>{project.favorite ? "Remove from favorites" : "Add to favorites"}</MenuItem>
          <MenuSeparator />
          <MenuLabel>Set status</MenuLabel>
          {PROJECT_STATUSES.map((status) => {
            const Icon = STATUS_ICON[status];
            return (
              <MenuItem key={status} checked={project.status === status} icon={<Icon size={15} className={`tone-text-${STATUS_TONE[status]}`} />} onSelect={() => { close(); if (status !== project.status) patch({ status }); }}>
                {statusLabel(status)}
              </MenuItem>
            );
          })}
          <MenuSeparator />
          <MenuItem icon={project.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />} onSelect={() => { close(); patch({ archived: !project.archived }); }}>
            {project.archived ? "Restore from archive" : "Archive project"}
          </MenuItem>
          <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => { close(); actions.deleteItem("projects", project); }}>Delete project…</MenuItem>
        </>
      )}
    </MenuButton>
  );
}
