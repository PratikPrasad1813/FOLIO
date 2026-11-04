"use client";

import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { CornerDownLeft, Plus, X } from "lucide-react";
import { TASK_STATUSES, type Task, type TaskStatus } from "@/lib/types";
import { compareTasks, isOverdue, isTaskDrag, PRIORITY_RANK, TASK_DRAG_TYPE, statusLabel, statusPatch, subtaskStats, type TaskSortKey } from "@/lib/tasks";
import type { WorkspaceActions } from "@/components/workspace-views";
import { DueChip, EstimateChip, LabelChips, PriorityPill, ProjectChip, SubtaskMeter, TaskActionsMenu, TaskStatusIcon, TASK_STATUS_TONE } from "@/components/task-parts";

const EMPTY_HINT: Record<TaskStatus, string> = { todo: "Nothing queued up", in_progress: "Nothing in motion", in_review: "Nothing waiting on review", done: "Finished work lands here" };
const DONE_LIMIT = 20;

interface TaskBoardProps {
  tasks: Task[];
  actions: WorkspaceActions;
  today: string;
  sort: TaskSortKey;
  dir: "asc" | "desc";
  createDefaults: Record<string, unknown>;
  serverOrdered?: boolean;
}

export function TaskBoard({ tasks, actions, today, sort, dir, createDefaults, serverOrdered = false }: TaskBoardProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [adding, setAdding] = useState<TaskStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const boardRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const projects = useMemo(() => new Map(actions.data.projects.map((project) => [project.id, project])), [actions.data.projects]);

  const columns = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], in_review: [], done: [] };
    for (const task of tasks) (groups[task.status] ?? groups.todo).push(task);
    if (serverOrdered) return groups;
    const factor = dir === "asc" ? 1 : -1;
    const projectName = (id: string | null) => (id && projects.get(id)?.name) || "";
    for (const status of TASK_STATUSES) {
      groups[status].sort((a, b) => {
        if (sort === "smart") {
          // Board default: finished work newest-first; otherwise most important, then soonest.
          if (status === "done") return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.createdAt.localeCompare(b.createdAt);
        }
        return compareTasks(a, b, sort, projectName) * factor || a.createdAt.localeCompare(b.createdAt);
      });
    }
    return groups;
  }, [tasks, sort, dir, projects, serverOrdered]);

  function move(task: Task, status: TaskStatus) {
    if (task.status === status) return;
    void actions.mutate("tasks", "PATCH", statusPatch(status, task), task.id).catch(() => {});
    setAnnouncement(`${task.title} moved to ${statusLabel(status)}.`);
  }

  function onCardKeyDown(event: KeyboardEvent<HTMLDivElement>, task: Task) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); actions.openEditor({ kind: "tasks", item: task }); return; }
    if (!event.shiftKey || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    const next = TASK_STATUSES[TASK_STATUSES.indexOf(task.status) + (event.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;
    move(task, next);
    requestAnimationFrame(() => boardRef.current?.querySelector<HTMLElement>(`[data-task-id="${task.id}"] .tk-card-link`)?.focus());
  }

  function onDrop(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault();
    const id = event.dataTransfer.getData(TASK_DRAG_TYPE) || dragId;
    const task = tasks.find((entry) => entry.id === id);
    setDragId(null);
    setOver(null);
    if (task) move(task, status);
  }

  async function create(status: TaskStatus) {
    const title = draft.trim();
    if (!title || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await actions.mutate("tasks", "POST", { ...createDefaults, title: title.slice(0, 200), status });
      setDraft(""); // stay open for rapid entry
    } catch { /* toast already shown; keep the draft */ } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="tk-board-wrap">
      <div className="tk-board" ref={boardRef}>
        {TASK_STATUSES.map((status) => {
          const all = columns[status];
          const cards = status === "done" && !showAllDone ? all.slice(0, DONE_LIMIT) : all;
          const hidden = all.length - cards.length;
          const headingId = `tk-col-${status}`;
          return (
            <section
              key={status}
              className={`tk-col tone-${TASK_STATUS_TONE[status]} ${over === status ? "is-over" : ""} ${dragId ? "is-dragging" : ""}`}
              aria-labelledby={headingId}
              onDragOver={(event) => { if (!isTaskDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (over !== status) setOver(status); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((current) => (current === status ? null : current)); }}
              onDrop={(event) => onDrop(event, status)}
            >
              <header className="tk-col-head">
                <TaskStatusIcon status={status} />
                <h3 id={headingId}>{statusLabel(status)}</h3>
                <span className="tk-col-count" aria-label={`${all.length} tasks`}>{all.length}</span>
                <button type="button" className="tk-icon-btn" aria-label={`New task in ${statusLabel(status)}`} title="New task with details" onClick={() => actions.openEditor({ kind: "tasks", defaults: { ...createDefaults, status } })}><Plus size={15} aria-hidden="true" /></button>
              </header>

              <div className="tk-col-body" role="list" aria-label={`${statusLabel(status)} tasks`}>
                {cards.map((task) => {
                  const project = task.projectId ? projects.get(task.projectId) : undefined;
                  const steps = subtaskStats(task.id, actions.data.subtasks);
                  return (
                    <article
                      key={task.id}
                      role="listitem"
                      data-task-id={task.id}
                      className={`tk-card ${task.completed ? "is-done" : ""} ${isOverdue(task, today) ? "is-overdue" : ""} ${dragId === task.id ? "is-dragging" : ""} ${actions.pending.has(task.id) ? "is-pending" : ""} pri-${task.priority.toLowerCase()}`}
                      draggable
                      onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(TASK_DRAG_TYPE, task.id); event.dataTransfer.setData("text/plain", task.title); requestAnimationFrame(() => setDragId(task.id)); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      onClick={() => actions.openEditor({ kind: "tasks", item: task })}
                    >
                      <div className="tk-card-top">
                        {project ? <ProjectChip project={project} /> : <span className="tk-card-personal">Personal</span>}
                        <TaskActionsMenu task={task} actions={actions} />
                      </div>
                      <h4>
                        {/* A focusable div rather than <button>: native buttons swallow the drag gesture. */}
                        <div role="button" tabIndex={0} className="tk-card-link" onClick={(event) => { event.stopPropagation(); actions.openEditor({ kind: "tasks", item: task }); }} onKeyDown={(event) => onCardKeyDown(event, task)} aria-describedby="tk-board-help">
                          {task.title}
                        </div>
                      </h4>
                      <LabelChips labels={task.labels} max={3} />
                      <div className="tk-card-meta">
                        {task.priority !== "None" && <PriorityPill priority={task.priority} />}
                        <DueChip task={task} today={today} />
                        <SubtaskMeter done={steps.done} total={steps.total} />
                        <EstimateChip minutes={task.estimateMinutes} />
                      </div>
                    </article>
                  );
                })}
                {!all.length && <div className="tk-col-empty">{dragId ? "Drop here" : EMPTY_HINT[status]}</div>}
                {hidden > 0 && <button type="button" className="tk-col-more" onClick={() => setShowAllDone(true)}>Show {hidden} more</button>}
              </div>

              {adding === status ? (
                <form className="tk-col-add" onSubmit={(event) => { event.preventDefault(); void create(status); }}>
                  <input autoFocus value={draft} maxLength={200} disabled={busy} placeholder="Task title…" aria-label={`New task title in ${statusLabel(status)}`} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setAdding(null); setDraft(""); } }} />
                  <div>
                    <button type="submit" className="pj-btn is-primary is-sm" disabled={busy || !draft.trim()}><CornerDownLeft size={13} aria-hidden="true" />Add</button>
                    <button type="button" className="tk-icon-btn" aria-label="Cancel" onClick={() => { setAdding(null); setDraft(""); }}><X size={14} aria-hidden="true" /></button>
                  </div>
                </form>
              ) : (
                <button type="button" className="tk-col-add-btn" onClick={() => { setAdding(status); setDraft(""); }}><Plus size={14} aria-hidden="true" />Add task</button>
              )}
            </section>
          );
        })}
      </div>
      <p id="tk-board-help" className="tk-board-help">Drag cards between columns · or focus a card and press <kbd>Shift</kbd> + <kbd>←</kbd>/<kbd>→</kbd></p>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </div>
  );
}
