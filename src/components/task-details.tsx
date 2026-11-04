"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, CalendarDays, CalendarRange, Check, CheckCheck, CircleAlert, Clock3, FolderKanban, History, Layers, ListChecks, Milestone as MilestoneIcon, Plus, RefreshCw, RotateCcw, SignalHigh, Tag, Trash2, X } from "lucide-react";
import { dateKey, formatDate, timeAgo, type Activity, type Task } from "@/lib/types";
import { completionPatch, formatEstimate, subtaskStats } from "@/lib/tasks";
import { Modal, Spinner } from "@/components/ui";
import type { WorkspaceActions } from "@/components/workspace-views";
import { allLabels, DueChip, LabelInput, PriorityMenu, StatusMenu } from "@/components/task-parts";
import { GoogleEventDialog, TaskToCalendarButton, useGoogleIntegration } from "@/components/integrations/google";
import { TaskDetailsReminderSection } from "@/components/task-reminder-control";
import type { NotificationsController } from "@/lib/use-notifications";

const ESTIMATE_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 960];
const plausible = (value: string) => !value || /^(19[7-9]\d|2[01]\d\d)-\d{2}-\d{2}$/.test(value);

function autosize(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export function TaskDetails({
  task,
  actions,
  onClose,
  notifications,
  notify,
}: {
  task: Task;
  actions: WorkspaceActions;
  onClose: () => void;
  notifications?: NotificationsController;
  notify?: (message: string, tone?: "success" | "error") => void;
}) {
  const google = useGoogleIntegration();
  const today = dateKey();
  const { data } = actions;
  const project = data.projects.find((entry) => entry.id === task.projectId);
  const projects = data.projects.filter((entry) => !entry.archived || entry.id === task.projectId);
  const milestones = data.milestones.filter((milestone) => milestone.projectId === task.projectId);
  const steps = useMemo(() => data.subtasks.filter((step) => step.taskId === task.id).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)), [data.subtasks, task.id]);
  const stats = subtaskStats(task.id, data.subtasks);
  const progress = task.completed ? 100 : stats.percent;
  const suggestions = useMemo(() => allLabels(data.tasks), [data.tasks]);
  const saving = actions.pending.has(task.id) || steps.some((step) => actions.pending.has(step.id));
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState("");
  const [stepDraft, setStepDraft] = useState("");
  const [eventDialog, setEventDialog] = useState<Parameters<typeof GoogleEventDialog>[0]["state"] | null>(null);
  const [editingStep, setEditingStep] = useState<{ id: string; title: string } | null>(null);
  const skipCommit = useRef(false);

  const save = (values: Record<string, unknown>) => {
    setFieldError("");
    void actions.mutate("tasks", "PATCH", values, task.id, { quiet: true }).catch(() => {});
  };

  function cancelOnEscape(event: KeyboardEvent<HTMLElement>, reset: () => void) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation(); // revert the edit instead of closing the panel
    skipCommit.current = true;
    reset();
    event.currentTarget.blur();
  }

  function commitTitle() {
    if (skipCommit.current) { skipCommit.current = false; setTitleDraft(null); return; }
    if (titleDraft === null) return;
    const value = titleDraft.trim();
    setTitleDraft(null);
    if (!value) { setFieldError("A task needs a title — we kept the previous one."); return; }
    if (value !== task.title) save({ title: value.slice(0, 200) });
  }

  function commitText(field: "description" | "notes", draft: string | null, reset: () => void) {
    if (skipCommit.current) { skipCommit.current = false; reset(); return; }
    if (draft === null) return;
    reset();
    if (draft.trim() !== task[field]) save({ [field]: draft.trim() });
  }

  function setDate(field: "dueDate" | "startDate", value: string) {
    if (!plausible(value)) return; // ignore half-typed years like 0202
    const start = field === "startDate" ? value : task.startDate;
    const due = field === "dueDate" ? value : task.dueDate;
    if (start && due && start > due) { setFieldError("The start date needs to be on or before the due date."); return; }
    if ((value || null) !== task[field]) save({ [field]: value || null });
  }

  async function addStep() {
    const title = stepDraft.trim().slice(0, 200);
    if (!title) return;
    setStepDraft("");
    await actions.mutate("subtasks", "POST", { taskId: task.id, title }, undefined, { quiet: true }).catch(() => setStepDraft(title));
  }

  function commitStep() {
    if (skipCommit.current) { skipCommit.current = false; setEditingStep(null); return; }
    if (!editingStep) return;
    const current = steps.find((step) => step.id === editingStep.id);
    const title = editingStep.title.trim().slice(0, 200);
    setEditingStep(null);
    if (current && title && title !== current.title) void actions.mutate("subtasks", "PATCH", { title }, current.id, { quiet: true }).catch(() => {});
  }

  // Task history: persisted events from the API, merged with this session's.
  const [history, setHistory] = useState<{ status: "loading" | "ready" | "error"; items: Activity[] }>({ status: "loading", items: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workspace?taskActivity=${encodeURIComponent(task.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load activity.");
        return result.activities as Activity[];
      })
      .then((items) => { if (!cancelled) setHistory({ status: "ready", items }); })
      .catch(() => { if (!cancelled) setHistory((current) => ({ status: "error", items: current.items })); });
    return () => { cancelled = true; };
  }, [task.id, attempt]);
  const feed = useMemo(() => {
    const merged = new Map<string, Activity>();
    for (const entry of [...data.activities.filter((activity) => activity.taskId === task.id), ...history.items]) merged.set(entry.id, entry);
    return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25);
  }, [data.activities, history.items, task.id]);

  const estimateOptions = task.estimateMinutes && !ESTIMATE_OPTIONS.includes(task.estimateMinutes) ? [...ESTIMATE_OPTIONS, task.estimateMinutes].sort((a, b) => a - b) : ESTIMATE_OPTIONS;

  return (
    <Modal title="Task details" subtitle={project ? project.name : "Personal task"} onClose={onClose} className="task-drawer" initialFocus="panel">
      <div className="tk-drawer">
        <div className="tk-drawer-bar">
          <button type="button" className={`tk-complete-btn ${task.completed ? "is-done" : ""}`} disabled={actions.pending.has(task.id)} onClick={() => { void actions.mutate("tasks", "PATCH", completionPatch(!task.completed, task), task.id).catch(() => {}); }}>
            {task.completed ? <><RotateCcw size={14} aria-hidden="true" />Reopen</> : <><Check size={14} strokeWidth={2.6} aria-hidden="true" />Mark complete</>}
          </button>
          <span className={`tk-save ${saving ? "is-saving" : ""}`} role="status" aria-live="polite">{saving ? <><Spinner size={12} />Saving…</> : <><CheckCheck size={13} aria-hidden="true" />Saved</>}</span>
          <span className="tk-spacer" />
          {project && <button type="button" className="pj-btn is-ghost is-sm" onClick={() => { onClose(); actions.openProject(project.id); }}><ArrowUpRight size={14} aria-hidden="true" />Open project</button>}
          {google.status.connected && <TaskToCalendarButton task={task} integration={google} className="pj-btn is-ghost is-sm" />}
          <button type="button" className="pj-btn is-danger-ghost is-sm" onClick={() => actions.deleteItem("tasks", task)}><Trash2 size={14} aria-hidden="true" />Delete</button>
        </div>

        <textarea
          className={`tk-drawer-title ${task.completed ? "is-done" : ""}`}
          aria-label="Task title"
          rows={1}
          maxLength={200}
          ref={autosize}
          value={titleDraft ?? task.title}
          onFocus={() => setTitleDraft(task.title)}
          onChange={(event) => { setTitleDraft(event.target.value); autosize(event.target); }}
          onBlur={commitTitle}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else cancelOnEscape(event, () => setTitleDraft(null)); }}
        />
        {fieldError && <p className="tk-field-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{fieldError}</p>}

        <dl className="tk-props">
          <div><dt><Layers size={14} aria-hidden="true" />Status</dt><dd><StatusMenu task={task} actions={actions} /></dd></div>
          <div><dt><SignalHigh size={14} aria-hidden="true" />Priority</dt><dd><PriorityMenu task={task} actions={actions} /></dd></div>
          <div>
            <dt><CalendarDays size={14} aria-hidden="true" />Due date</dt>
            <dd className="tk-date-cell">
              <input type="date" className="tk-prop-input" aria-label="Due date" value={task.dueDate ?? ""} min={task.startDate ?? undefined} onChange={(event) => setDate("dueDate", event.target.value)} />
              {task.dueDate && <DueChip task={task} today={today} />}
            </dd>
          </div>
          <div><dt><CalendarRange size={14} aria-hidden="true" />Start date</dt><dd><input type="date" className="tk-prop-input" aria-label="Start date" value={task.startDate ?? ""} max={task.dueDate ?? undefined} onChange={(event) => setDate("startDate", event.target.value)} /></dd></div>
          <div>
            <dt><FolderKanban size={14} aria-hidden="true" />Project</dt>
            <dd>
              <select className="tk-prop-input" aria-label="Project" value={task.projectId ?? ""} onChange={(event) => save({ projectId: event.target.value || null, milestoneId: null })}>
                <option value="">No project</option>
                {projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.archived ? " (archived)" : ""}</option>)}
              </select>
            </dd>
          </div>
          {milestones.length > 0 && (
            <div>
              <dt><MilestoneIcon size={14} aria-hidden="true" />Milestone</dt>
              <dd>
                <select className="tk-prop-input" aria-label="Milestone" value={task.milestoneId ?? ""} onChange={(event) => save({ milestoneId: event.target.value || null })}>
                  <option value="">No milestone</option>
                  {milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}{milestone.completed ? " ✓" : ""}</option>)}
                </select>
              </dd>
            </div>
          )}
          <div>
            <dt><Clock3 size={14} aria-hidden="true" />Estimate</dt>
            <dd>
              <select className="tk-prop-input" aria-label="Estimated duration" value={task.estimateMinutes ?? ""} onChange={(event) => save({ estimateMinutes: event.target.value ? Number(event.target.value) : null })}>
                <option value="">No estimate</option>
                {estimateOptions.map((minutes) => <option key={minutes} value={minutes}>{formatEstimate(minutes)}</option>)}
              </select>
            </dd>
          </div>
          <div className="is-wide"><dt><Tag size={14} aria-hidden="true" />Labels</dt><dd><LabelInput value={task.labels} onChange={(labels) => save({ labels })} suggestions={suggestions} /></dd></div>
        </dl>

        {notifications && (
          <TaskDetailsReminderSection
            task={task}
            controller={notifications}
            notify={notify ?? (() => {})}
          />
        )}

        <section className="tk-section">
          <h3>Description</h3>
          <textarea
            className="tk-prose"
            aria-label="Description"
            rows={3}
            maxLength={4000}
            ref={autosize}
            placeholder="Add more detail, links or acceptance criteria…"
            value={descDraft ?? task.description}
            onFocus={() => setDescDraft(task.description)}
            onChange={(event) => { setDescDraft(event.target.value); autosize(event.target); }}
            onBlur={() => commitText("description", descDraft, () => setDescDraft(null))}
            onKeyDown={(event) => cancelOnEscape(event, () => setDescDraft(null))}
          />
        </section>

        <section className="tk-section">
          <header className="tk-section-head">
            <h3><ListChecks size={15} aria-hidden="true" />Subtasks</h3>
            <span className="tk-section-meta">{stats.total ? `${stats.done} of ${stats.total} done` : "Break it into smaller steps"}</span>
          </header>
          <div className="tk-progress" role="progressbar" aria-label="Task progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <i style={{ width: `${progress}%` }} />
          </div>
          <span className="tk-progress-label">{task.completed ? "Task complete" : stats.total ? `${progress}% of subtasks complete` : "Progress follows your subtasks"}</span>
          {steps.length > 0 && (
            <ul className="tk-sub-list">
              {steps.map((step) => (
                <li key={step.id} className={`${step.completed ? "is-done" : ""} ${actions.pending.has(step.id) ? "is-pending" : ""}`}>
                  <button type="button" role="checkbox" aria-checked={step.completed} aria-label={`${step.completed ? "Uncheck" : "Check off"}: ${step.title}`} className={`tk-check is-sm ${step.completed ? "is-checked" : ""}`} onClick={() => { void actions.mutate("subtasks", "PATCH", { completed: !step.completed, completedAt: !step.completed ? new Date().toISOString() : null }, step.id, { quiet: true }).catch(() => {}); }}>
                    <Check size={10} strokeWidth={3.2} aria-hidden="true" />
                  </button>
                  {editingStep?.id === step.id ? (
                    <input className="tk-sub-edit" autoFocus aria-label="Edit subtask" maxLength={200} value={editingStep.title} onChange={(event) => setEditingStep({ id: step.id, title: event.target.value })} onBlur={commitStep} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else cancelOnEscape(event, () => setEditingStep(null)); }} />
                  ) : (
                    <button type="button" className="tk-sub-title" title="Click to rename" onClick={() => setEditingStep({ id: step.id, title: step.title })}>{step.title}</button>
                  )}
                  <button type="button" className="tk-icon-btn is-sm tk-sub-delete" aria-label={`Delete subtask ${step.title}`} onClick={() => { void actions.mutate("subtasks", "DELETE", {}, step.id, { quiet: true }).catch(() => {}); }}><X size={13} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          )}
          <form className="tk-sub-add" onSubmit={(event) => { event.preventDefault(); void addStep(); }}>
            <Plus size={14} aria-hidden="true" />
            <input value={stepDraft} onChange={(event) => setStepDraft(event.target.value)} maxLength={200} placeholder="Add a subtask and press Enter" aria-label="New subtask" />
          </form>
        </section>

        <section className="tk-section">
          <h3>Notes</h3>
          <textarea
            className="tk-prose is-notes"
            aria-label="Notes"
            rows={2}
            maxLength={8000}
            ref={autosize}
            placeholder="Private working notes, decisions, links…"
            value={notesDraft ?? task.notes}
            onFocus={() => setNotesDraft(task.notes)}
            onChange={(event) => { setNotesDraft(event.target.value); autosize(event.target); }}
            onBlur={() => commitText("notes", notesDraft, () => setNotesDraft(null))}
            onKeyDown={(event) => cancelOnEscape(event, () => setNotesDraft(null))}
          />
        </section>

        <section className="tk-section">
          <header className="tk-section-head"><h3><History size={15} aria-hidden="true" />Activity</h3></header>
          {history.status === "loading" && !feed.length ? (
            <div className="tk-feed-loading" role="status" aria-label="Loading activity">{[0, 1].map((index) => <span key={index} className="pj-sk" />)}</div>
          ) : history.status === "error" && !feed.length ? (
            <p className="tk-feed-empty">Couldn’t load the history. <button type="button" className="pj-link" onClick={() => { setHistory({ status: "loading", items: [] }); setAttempt((value) => value + 1); }}><RefreshCw size={13} aria-hidden="true" />Try again</button></p>
          ) : feed.length ? (
            <ol className="tk-feed">
              {feed.map((entry) => (
                <li key={entry.id} className={`is-${entry.type}`}>
                  <i aria-hidden="true" />
                  <p>{entry.text}</p>
                  <time dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>{timeAgo(entry.createdAt)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="tk-feed-empty">No activity yet. Changes you make will show up here.</p>
          )}
        </section>

        <footer className="tk-drawer-meta">
          <span>Created {formatDate(task.createdAt.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })}</span>
          <span>Updated {timeAgo(task.updatedAt || task.createdAt)}</span>
          {task.completed && task.completedAt && <span>Completed {timeAgo(task.completedAt)}</span>}
        </footer>
        {eventDialog && <GoogleEventDialog state={eventDialog} integration={google} onClose={() => { setEventDialog(null); void google.loadEvents(new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10), new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10)); }} />}
      </div>
    </Modal>
  );
}
