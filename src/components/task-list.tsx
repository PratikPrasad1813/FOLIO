"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpDown, ArrowUpNarrowWide, CheckCheck, ChevronDown, FolderKanban, Layers, SignalHigh, Trash2, X } from "lucide-react";
import { TASK_PRIORITIES, TASK_STATUSES, timeAgo, type Task } from "@/lib/types";
import { priorityLabel, statusLabel, subtaskStats, type TaskSortKey } from "@/lib/tasks";
import { Modal, ProjectIcon, Spinner } from "@/components/ui";
import type { WorkspaceActions } from "@/components/workspace-views";
import { MenuButton, MenuItem, MenuSeparator } from "@/components/menu";
import { CompleteCheck, DueChip, EstimateChip, LabelChips, PriorityIcon, PriorityMenu, ProjectChip, StatusMenu, SubtaskMeter, TaskActionsMenu, TaskStatusIcon } from "@/components/task-parts";

interface TaskListProps {
  tasks: Task[];
  actions: WorkspaceActions;
  today: string;
  sort: TaskSortKey;
  dir: "asc" | "desc";
  onSort: (key: TaskSortKey) => void;
  density: "comfortable" | "compact";
}

export function TaskList({ tasks, actions, today, sort, dir, onSort, density }: TaskListProps) {
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = useMemo(() => tasks.map((task) => task.id), [tasks]);
  // Only visible tasks can be acted on — filters never hide a selected task from you.
  const selected = useMemo(() => ids.filter((id) => selection.has(id)), [ids, selection]);
  const allSelected = selected.length > 0 && selected.length === ids.length;
  const projects = useMemo(() => new Map(actions.data.projects.map((project) => [project.id, project])), [actions.data.projects]);
  const liveProjects = actions.data.projects.filter((project) => !project.archived);

  useEffect(() => {
    if (!selected.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(".modal-backdrop, .fm-menu")) return;
      setSelection(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.length]);

  function toggle(id: string, shift: boolean) {
    setSelection((current) => {
      const next = new Set(current);
      const from = anchor ? ids.indexOf(anchor) : -1;
      const to = ids.indexOf(id);
      if (shift && from >= 0 && to >= 0) {
        const value = !current.has(id);
        for (const key of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) { if (value) next.add(key); else next.delete(key); }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(id);
  }

  async function bulk(change: Record<string, unknown> | "delete") {
    if (busy || !selected.length) return;
    setBusy(true);
    try {
      await actions.bulkTasks(selected, change);
      setSelection(new Set());
      setConfirmDelete(false);
    } catch { /* reported by a toast; selection is kept so you can retry */ } finally {
      setBusy(false);
    }
  }

  const head = (key: TaskSortKey, label: string, className = "") => (
    <span role="columnheader" className={className} aria-sort={sort === key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`pj-th-btn ${sort === key ? "is-sorted" : ""}`} onClick={() => onSort(key)}>
        {label}
        {sort === key ? (dir === "asc" ? <ArrowUpNarrowWide size={12} aria-hidden="true" /> : <ArrowDownWideNarrow size={12} aria-hidden="true" />) : <ArrowUpDown size={11} className="pj-th-idle" aria-hidden="true" />}
      </button>
    </span>
  );

  return (
    <>
      <div className={`tk-list is-${density}`} role="table" aria-label="Tasks" aria-rowcount={tasks.length + 1}>
        <div className="tk-row tk-row-head" role="row">
          <span role="columnheader" className="tk-cell-select">
            <input type="checkbox" className="tk-select" aria-label={allSelected ? "Deselect all tasks" : "Select all visible tasks"} checked={allSelected} ref={(element) => { if (element) element.indeterminate = selected.length > 0 && !allSelected; }} onChange={() => setSelection(allSelected ? new Set() : new Set(ids))} />
          </span>
          {head("title", "Task", "tk-cell-task")}
          {head("status", "Status", "tk-cell-status")}
          {head("priority", "Priority", "tk-cell-priority")}
          {head("project", "Project", "tk-cell-project")}
          {head("due", "Due", "tk-cell-due")}
          <span role="columnheader" className="tk-cell-labels">Labels</span>
          {head("updated", "Updated", "tk-cell-updated")}
          <span role="columnheader" className="tk-cell-actions"><span className="sr-only">Actions</span></span>
        </div>
        {tasks.map((task, index) => {
          const isSelected = selection.has(task.id);
          const steps = subtaskStats(task.id, actions.data.subtasks);
          return (
            <div key={task.id} role="row" aria-selected={isSelected} className={`tk-row ${task.completed ? "is-done" : ""} ${isSelected ? "is-selected" : ""} ${actions.pending.has(task.id) ? "is-pending" : ""}`} style={{ animationDelay: `${Math.min(index, 14) * 14}ms` }} onClick={() => actions.openEditor({ kind: "tasks", item: task })}>
              <div role="cell" className="tk-cell-select" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" className="tk-select" aria-label={`Select ${task.title}`} checked={isSelected} onChange={() => undefined} onClick={(event) => toggle(task.id, event.shiftKey)} />
              </div>
              <div role="cell" className="tk-cell-task">
                <CompleteCheck task={task} actions={actions} size="sm" />
                <div className="tk-task-text">
                  <button type="button" className="tk-row-title" onClick={(event) => { event.stopPropagation(); actions.openEditor({ kind: "tasks", item: task }); }}>{task.title}</button>
                  {density === "comfortable" && (steps.total > 0 || task.estimateMinutes || task.description) && (
                    <span className="tk-row-sub">
                      <SubtaskMeter done={steps.done} total={steps.total} />
                      <EstimateChip minutes={task.estimateMinutes} />
                      {task.description && <span className="tk-row-desc">{task.description}</span>}
                    </span>
                  )}
                </div>
              </div>
              <div role="cell" className="tk-cell-status" onClick={(event) => event.stopPropagation()}><StatusMenu task={task} actions={actions} /></div>
              <div role="cell" className="tk-cell-priority" onClick={(event) => event.stopPropagation()}><PriorityMenu task={task} actions={actions} /></div>
              <div role="cell" className="tk-cell-project">{task.projectId ? <ProjectChip project={projects.get(task.projectId)} /> : <span className="tk-muted">—</span>}</div>
              <div role="cell" className="tk-cell-due">{task.dueDate ? <DueChip task={task} today={today} /> : <span className="tk-muted">—</span>}</div>
              <div role="cell" className="tk-cell-labels"><LabelChips labels={task.labels} max={2} /></div>
              <div role="cell" className="tk-cell-updated"><span className="tk-muted" title={`Created ${new Date(task.createdAt).toLocaleString()} · Updated ${new Date(task.updatedAt || task.createdAt).toLocaleString()}`}>{timeAgo(task.updatedAt || task.createdAt)}</span></div>
              <div role="cell" className="tk-cell-actions" onClick={(event) => event.stopPropagation()}><TaskActionsMenu task={task} actions={actions} /></div>
            </div>
          );
        })}
      </div>

      {selected.length > 0 && <div className="tk-bulk-spacer" aria-hidden="true" />}
      {selected.length > 0 && (
        <div className="tk-bulk" role="toolbar" aria-label={`Bulk actions for ${selected.length} selected tasks`}>
          <span className="tk-bulk-count"><strong>{selected.length}</strong> selected</span>
          <span className="tk-bulk-sep" aria-hidden="true" />
          <button type="button" className="tk-bulk-btn" disabled={busy} onClick={() => { void bulk({ status: "done" }); }}><CheckCheck size={15} aria-hidden="true" />Complete</button>
          <MenuButton label="Change status of selected tasks" width={210} disabled={busy} triggerClassName="tk-bulk-btn" trigger={<><Layers size={15} aria-hidden="true" />Status<ChevronDown size={12} aria-hidden="true" /></>}>
            {(close) => TASK_STATUSES.map((status) => <MenuItem key={status} icon={<TaskStatusIcon status={status} />} onSelect={() => { close(); void bulk({ status }); }}>{statusLabel(status)}</MenuItem>)}
          </MenuButton>
          <MenuButton label="Change priority of selected tasks" width={200} disabled={busy} triggerClassName="tk-bulk-btn" trigger={<><SignalHigh size={15} aria-hidden="true" />Priority<ChevronDown size={12} aria-hidden="true" /></>}>
            {(close) => TASK_PRIORITIES.map((priority) => <MenuItem key={priority} icon={<PriorityIcon priority={priority} />} onSelect={() => { close(); void bulk({ priority }); }}>{priorityLabel(priority)}</MenuItem>)}
          </MenuButton>
          <MenuButton label="Move selected tasks to a project" width={250} disabled={busy} triggerClassName="tk-bulk-btn" trigger={<><FolderKanban size={15} aria-hidden="true" />Project<ChevronDown size={12} aria-hidden="true" /></>}>
            {(close) => (
              <>
                {liveProjects.map((project) => <MenuItem key={project.id} icon={<ProjectIcon icon={project.icon} color={project.color} small />} onSelect={() => { close(); void bulk({ projectId: project.id }); }}>{project.name}</MenuItem>)}
                {liveProjects.length > 0 && <MenuSeparator />}
                <MenuItem icon={<X size={15} />} onSelect={() => { close(); void bulk({ projectId: null }); }}>Remove from project</MenuItem>
              </>
            )}
          </MenuButton>
          <button type="button" className="tk-bulk-btn is-danger" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} aria-hidden="true" />Delete</button>
          <span className="tk-bulk-sep" aria-hidden="true" />
          {busy ? <Spinner size={16} /> : <button type="button" className="tk-icon-btn" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => setSelection(new Set())}><X size={15} aria-hidden="true" /></button>}
        </div>
      )}

      {confirmDelete && (
        <Modal title={`Delete ${selected.length} task${selected.length === 1 ? "" : "s"}?`} onClose={() => { if (!busy) setConfirmDelete(false); }} className="confirm-modal">
          <div className="confirm-icon"><Trash2 size={24} /></div>
          <h3>{selected.length === 1 ? tasks.find((task) => task.id === selected[0])?.title : `${selected.length} selected tasks`}</h3>
          <p>These tasks and their subtasks will be permanently deleted in one go. If anything fails, nothing is deleted. This can’t be undone.</p>
          <div className="modal-footer">
            <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep them</button>
            <button type="button" className="button danger" disabled={busy} onClick={() => { void bulk("delete"); }}>{busy ? <Spinner /> : <Trash2 size={16} />} Delete {selected.length} task{selected.length === 1 ? "" : "s"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
