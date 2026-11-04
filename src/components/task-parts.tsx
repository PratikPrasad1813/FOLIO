"use client";

import { useId, useState, type CSSProperties } from "react";
import { CalendarClock, CalendarDays, Check, ChevronDown, Clock3, Ellipsis, FolderOpen, ListChecks, PanelRightOpen, Trash2, X } from "lucide-react";
import { formatDate, relativeDay, TASK_PRIORITIES, TASK_STATUSES, type Project, type Task, type TaskPriority, type TaskStatus } from "@/lib/types";
import { addDays, completionPatch, formatEstimate, isOverdue, labelTone, normaliseLabel, priorityLabel, statusLabel, statusPatch } from "@/lib/tasks";
import { MenuButton, MenuItem, MenuLabel, MenuSeparator } from "@/components/menu";
import type { WorkspaceActions } from "@/components/workspace-views";

export const TASK_STATUS_TONE: Record<TaskStatus, string> = { todo: "neutral", in_progress: "blue", in_review: "amber", done: "green" };

/** Linear-style workflow glyphs: dashed → half → three-quarters → check. */
export function TaskStatusIcon({ status, size = 15 }: { status: TaskStatus; size?: number }) {
  return (
    <svg className={`tk-status-icon is-${status}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {status === "done" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5 8.3l2 2 4-4.3" fill="none" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={status === "todo" ? "2.5 2.2" : undefined} />
          {status === "in_progress" && <path d="M8 4v8a4 4 0 0 0 0-8z" fill="currentColor" />}
          {status === "in_review" && <path d="M8 4a4 4 0 1 1-4 4h4z" fill="currentColor" />}
        </>
      )}
    </svg>
  );
}

/** Signal bars for priority; urgent gets a filled alert square. */
export function PriorityIcon({ priority, size = 15 }: { priority: TaskPriority; size?: number }) {
  const common = { className: `tk-pri-icon is-${priority.toLowerCase()}`, width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true as const };
  if (priority === "Urgent") return <svg {...common}><rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="currentColor" /><path d="M8 4.6v4.3" stroke="var(--surface)" strokeWidth="1.9" strokeLinecap="round" /><circle cx="8" cy="11.4" r="1.05" fill="var(--surface)" /></svg>;
  if (priority === "None") return <svg {...common}><path d="M2.8 8h1.8M7.1 8h1.8M11.4 8h1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  const filled = priority === "High" ? 3 : priority === "Medium" ? 2 : 1;
  return <svg {...common}>{[0, 1, 2].map((i) => <rect key={i} x={2.4 + i * 4} y={10 - i * 3.2} width="2.6" height={4 + i * 3.2} rx="1" fill="currentColor" opacity={i < filled ? 1 : 0.25} />)}</svg>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`tk-status tone-${TASK_STATUS_TONE[status]}`}><TaskStatusIcon status={status} size={13} />{statusLabel(status)}</span>;
}

export function PriorityPill({ priority, iconOnly = false }: { priority: TaskPriority; iconOnly?: boolean }) {
  return <span className={`tk-pri is-${priority.toLowerCase()} ${iconOnly ? "is-icon" : ""}`} title={priorityLabel(priority)}><PriorityIcon priority={priority} size={13} />{!iconOnly && <span>{priorityLabel(priority)}</span>}</span>;
}

export function LabelChips({ labels, max = 3 }: { labels: string[]; max?: number }) {
  if (!labels.length) return null;
  const rest = labels.length - max;
  return (
    <span className="tk-labels">
      {labels.slice(0, max).map((label) => <span key={label} className={`tk-label lt-${labelTone(label)}`}>{label}</span>)}
      {rest > 0 && <span className="tk-label is-more" title={labels.slice(max).join(", ")}>+{rest}</span>}
    </span>
  );
}

export function DueChip({ task, today, empty = false }: { task: Pick<Task, "dueDate" | "completed">; today: string; empty?: boolean }) {
  if (!task.dueDate) return empty ? <span className="tk-due is-none"><CalendarDays size={12} aria-hidden="true" />No date</span> : null;
  const overdue = isOverdue(task, today);
  const label = task.dueDate === today ? "Today" : task.dueDate === addDays(today, 1) ? "Tomorrow" : overdue ? relativeDay(task.dueDate, today) : formatDate(task.dueDate);
  const soon = !task.completed && !overdue && task.dueDate <= addDays(today, 1);
  return (
    <span className={`tk-due ${task.completed ? "is-done" : overdue ? "is-late" : soon ? "is-soon" : ""}`} title={formatDate(task.dueDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>
      {overdue ? <CalendarClock size={12} aria-hidden="true" /> : <CalendarDays size={12} aria-hidden="true" />}{label}
    </span>
  );
}

export function ProjectChip({ project }: { project?: Project }) {
  return <span className={`tk-project ${project ? "" : "is-none"}`} title={project ? project.name : "Not in a project"}><i className={project ? `c-${project.color}` : ""} aria-hidden="true" /><span>{project ? project.name : "No project"}</span></span>;
}

export function SubtaskMeter({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  return (
    <span className={`tk-sub-meter ${done === total ? "is-complete" : ""}`} title={`${done} of ${total} subtasks done`}>
      <ListChecks size={12} aria-hidden="true" />{done}/{total}
      <i style={{ "--tk-p": `${Math.round((done / total) * 100)}%` } as CSSProperties} aria-hidden="true" />
    </span>
  );
}

export function EstimateChip({ minutes }: { minutes: number | null }) {
  if (!minutes) return null;
  return <span className="tk-estimate" title="Estimated duration"><Clock3 size={12} aria-hidden="true" />{formatEstimate(minutes)}</span>;
}

export function CompleteCheck({ task, actions, size = "md" }: { task: Task; actions: WorkspaceActions; size?: "sm" | "md" }) {
  const pending = actions.pending.has(task.id);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={task.completed}
      aria-label={`${task.completed ? "Reopen" : "Complete"}: ${task.title}`}
      className={`tk-check is-${size} ${task.completed ? "is-checked" : ""}`}
      disabled={pending}
      onClick={(event) => { event.stopPropagation(); void actions.mutate("tasks", "PATCH", completionPatch(!task.completed, task), task.id).catch(() => {}); }}
    >
      <Check size={size === "sm" ? 10 : 12} strokeWidth={3.2} aria-hidden="true" />
    </button>
  );
}

export function StatusMenu({ task, actions, compact = false }: { task: Task; actions: WorkspaceActions; compact?: boolean }) {
  return (
    <MenuButton label={`Status: ${statusLabel(task.status)}. Change status of ${task.title}`} width={210} triggerClassName={`tk-menu-trigger ${compact ? "is-compact" : ""}`} trigger={compact ? <TaskStatusIcon status={task.status} /> : <><TaskStatusBadge status={task.status} /><ChevronDown size={12} aria-hidden="true" className="tk-caret" /></>}>
      {(close) => TASK_STATUSES.map((status) => (
        <MenuItem key={status} checked={task.status === status} icon={<TaskStatusIcon status={status} />} onSelect={() => { close(); if (status !== task.status) void actions.mutate("tasks", "PATCH", statusPatch(status, task), task.id).catch(() => {}); }}>
          {statusLabel(status)}
        </MenuItem>
      ))}
    </MenuButton>
  );
}

export function PriorityMenu({ task, actions, iconOnly = false }: { task: Task; actions: WorkspaceActions; iconOnly?: boolean }) {
  return (
    <MenuButton label={`Priority: ${priorityLabel(task.priority)}. Change priority of ${task.title}`} width={200} triggerClassName={`tk-menu-trigger ${iconOnly ? "is-compact" : ""}`} trigger={<><PriorityPill priority={task.priority} iconOnly={iconOnly} />{!iconOnly && <ChevronDown size={12} aria-hidden="true" className="tk-caret" />}</>}>
      {(close) => TASK_PRIORITIES.map((priority) => (
        <MenuItem key={priority} checked={task.priority === priority} icon={<PriorityIcon priority={priority} />} onSelect={() => { close(); if (priority !== task.priority) void actions.mutate("tasks", "PATCH", { priority }, task.id, { quiet: true }).catch(() => {}); }}>
          {priorityLabel(priority)}
        </MenuItem>
      ))}
    </MenuButton>
  );
}

export function TaskActionsMenu({ task, actions }: { task: Task; actions: WorkspaceActions }) {
  const project = actions.data.projects.find((entry) => entry.id === task.projectId);
  return (
    <MenuButton label={`Actions for ${task.title}`} width={232} triggerClassName="tk-icon-btn" trigger={<Ellipsis size={16} aria-hidden="true" />}>
      {(close) => (
        <>
          <MenuItem icon={<PanelRightOpen size={15} />} onSelect={() => { close(); actions.openEditor({ kind: "tasks", item: task }); }}>Open details</MenuItem>
          {project && <MenuItem icon={<FolderOpen size={15} />} onSelect={() => { close(); actions.openProject(project.id); }}>Go to {project.name}</MenuItem>}
          <MenuSeparator />
          <MenuLabel>Move to</MenuLabel>
          {TASK_STATUSES.map((status) => (
            <MenuItem key={status} checked={task.status === status} icon={<TaskStatusIcon status={status} />} onSelect={() => { close(); if (status !== task.status) void actions.mutate("tasks", "PATCH", statusPatch(status, task), task.id).catch(() => {}); }}>{statusLabel(status)}</MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Priority</MenuLabel>
          {TASK_PRIORITIES.map((priority) => (
            <MenuItem key={priority} checked={task.priority === priority} icon={<PriorityIcon priority={priority} />} onSelect={() => { close(); if (priority !== task.priority) void actions.mutate("tasks", "PATCH", { priority }, task.id, { quiet: true }).catch(() => {}); }}>{priorityLabel(priority)}</MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => { close(); actions.deleteItem("tasks", task); }}>Delete task…</MenuItem>
        </>
      )}
    </MenuButton>
  );
}

/** Chip-style label editor: Enter or comma adds, Backspace removes the last one. */
export function LabelInput({ value, onChange, suggestions, id, disabled }: { value: string[]; onChange: (labels: string[]) => void; suggestions: string[]; id?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const has = (label: string) => value.some((entry) => entry.toLowerCase() === label.toLowerCase());
  const add = (raw: string) => {
    const label = normaliseLabel(raw);
    setDraft("");
    if (!label || has(label) || value.length >= 8) return;
    onChange([...value, label]);
  };
  return (
    <div className={`tk-label-input ${disabled ? "is-disabled" : ""}`}>
      {value.map((label) => (
        <span key={label} className={`tk-label lt-${labelTone(label)}`}>
          {label}
          <button type="button" aria-label={`Remove label ${label}`} disabled={disabled} onClick={() => onChange(value.filter((entry) => entry !== label))}><X size={11} aria-hidden="true" /></button>
        </span>
      ))}
      {value.length < 8 && (
        <input
          id={id}
          value={draft}
          disabled={disabled}
          list={listId}
          maxLength={25}
          placeholder={value.length ? "Add label…" : "Add labels — press Enter"}
          aria-label="Add a label"
          onChange={(event) => { const next = event.target.value; if (next.endsWith(",")) add(next.slice(0, -1)); else setDraft(next); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) { event.preventDefault(); add(draft); }
            else if (event.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => { if (draft.trim()) add(draft); }}
        />
      )}
      <datalist id={listId}>{suggestions.filter((label) => !has(label)).slice(0, 30).map((label) => <option key={label} value={label} />)}</datalist>
    </div>
  );
}

export function allLabels(tasks: Task[]) {
  const seen = new Map<string, string>();
  for (const task of tasks) for (const label of task.labels) if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
