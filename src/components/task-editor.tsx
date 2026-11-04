"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronDown, CircleAlert, CircleCheck, Plus, X } from "lucide-react";
import { dateKey, TASK_PRIORITIES, TASK_STATUSES, type Task, type TaskPriority, type TaskStatus, type WorkspaceData } from "@/lib/types";
import { addDays, ESTIMATE_PRESETS, formatEstimate, priorityLabel, statusLabel } from "@/lib/tasks";
import { usePersistentState } from "@/lib/use-persistent-state";
import { Modal, Spinner } from "@/components/ui";
import type { EditorState } from "@/components/editors";
import { allLabels, LabelInput, PriorityIcon, TaskStatusIcon, TASK_STATUS_TONE } from "@/components/task-parts";
import { TaskEditorReminderField } from "@/components/task-reminder-control";
import type { TaskReminderDraft } from "@/lib/notifications";
import type { NotificationsController } from "@/lib/use-notifications";

interface TaskEditorProps {
  editor: EditorState;
  data: WorkspaceData;
  onClose: () => void;
  onCreate: (values: Record<string, unknown>) => Promise<void>;
  notifications?: NotificationsController;
}

type Defaults = Partial<Pick<Task, "title" | "description" | "status" | "priority" | "dueDate" | "startDate" | "projectId" | "milestoneId" | "labels" | "estimateMinutes">>;

export function TaskEditor({ editor, data, onClose, onCreate, notifications }: TaskEditorProps) {
  const defaults = (editor.defaults ?? {}) as Defaults;
  const id = useId();
  const today = dateKey();
  const prefTiming = notifications?.preferences.defaultReminderTiming ?? "1h_before";
  const prefDueTime = notifications?.preferences.defaultDueTime ?? "09:00";
  const prefTimezone = notifications?.preferences.timezone ?? "UTC";
  const [title, setTitle] = useState(defaults.title ?? "");
  const [description, setDescription] = useState(defaults.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(defaults.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(defaults.priority ?? "Medium");
  const [dueDate, setDueDate] = useState(defaults.dueDate ?? "");
  const [reminderTouched, setReminderTouched] = useState(false);
  const [reminder, setReminder] = useState<TaskReminderDraft>({
    enabled: Boolean(defaults.dueDate && prefTiming !== "none"),
    timing: prefTiming !== "none" ? prefTiming : "1h_before",
    dueTime: prefDueTime,
    customLocal: null,
  });

  function updateDueDate(nextDue: string) {
    setDueDate(nextDue);
    if (!reminderTouched) {
      if (nextDue && prefTiming !== "none") {
        setReminder((prev) => ({
          ...prev,
          enabled: true,
          timing: prefTiming,
          dueTime: prefDueTime,
        }));
      } else if (!nextDue && reminder.timing !== "custom") {
        setReminder((prev) => ({ ...prev, enabled: false }));
      }
    }
  }
  const [startDate, setStartDate] = useState(defaults.startDate ?? "");
  const [projectId, setProjectId] = useState(defaults.projectId ?? "");
  const [milestoneId, setMilestoneId] = useState(defaults.milestoneId ?? "");
  const [labels, setLabels] = useState<string[]>(defaults.labels ?? []);
  const [estimate, setEstimate] = useState<number | null>(defaults.estimateMinutes ?? null);
  const [notes, setNotes] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [stepDraft, setStepDraft] = useState("");
  const [more, setMore] = useState(Boolean(defaults.startDate || defaults.estimateMinutes));
  const [createMore, setCreateMore] = usePersistentState<"on" | "off">("folio.tasks.createMore", "off", "local", ["on", "off"]);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [createdCount, setCreatedCount] = useState(0);
  const submitting = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const stepRef = useRef<HTMLInputElement>(null);

  const projects = useMemo(() => data.projects.filter((project) => !project.archived || project.id === projectId), [data.projects, projectId]);
  const milestones = data.milestones.filter((milestone) => milestone.projectId === projectId && (!milestone.completed || milestone.id === milestoneId));
  const suggestions = useMemo(() => allLabels(data.tasks), [data.tasks]);
  const errors = {
    title: !title.trim() ? "Give the task a short title." : title.trim().length > 200 ? "Keep the title under 200 characters." : "",
    dates: startDate && dueDate && startDate > dueDate ? "The start date can’t be after the due date." : "",
  };
  const busy = phase !== "idle";
  const quickDates = [{ label: "Today", value: today }, { label: "Tomorrow", value: addDays(today, 1) }, { label: "Next week", value: addDays(today, 7) }];

  function addStep() {
    const value = stepDraft.trim();
    if (!value || steps.length >= 50) return;
    setSteps([...steps, value.slice(0, 200)]);
    setStepDraft("");
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setSubmitted(true);
    if (errors.title) { titleRef.current?.focus(); return; }
    if (errors.dates || submitting.current) return;
    submitting.current = true; // blocks double submits before React re-renders
    setPhase("saving");
    setError("");
    const allSteps = stepDraft.trim() ? [...steps, stepDraft.trim().slice(0, 200)] : steps;
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        status,
        priority,
        dueDate: dueDate || null,
        startDate: startDate || null,
        projectId: projectId || null,
        milestoneId: milestoneId && milestones.some((milestone) => milestone.id === milestoneId) ? milestoneId : null,
        labels,
        estimateMinutes: estimate,
        notes: notes.trim(),
        reminder,
        ...(allSteps.length ? { subtasks: allSteps } : {}),
      });
      if (createMore === "on") {
        // Keep the context (project, status, priority, dates, labels) for the next one.
        setTitle(""); setDescription(""); setSteps([]); setStepDraft(""); setNotes("");
        setSubmitted(false); setPhase("idle"); setCreatedCount((count) => count + 1);
        submitting.current = false;
        requestAnimationFrame(() => titleRef.current?.focus());
      } else {
        setPhase("saved");
        window.setTimeout(onClose, 380);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPhase("idle");
      submitting.current = false;
    }
  }

  return (
    <Modal title="New task" subtitle="Capture it now. Refine it whenever you like." onClose={() => { if (phase !== "saving") onClose(); }} className="editor-modal pe-modal tk-editor">
      <form className="editor-form tk-form" onSubmit={submit} noValidate onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submit(); } }}>
        <fieldset className="pe-fields" disabled={busy}>
          <div className="pe-field">
            <label htmlFor={`${id}-title`}>Title <b aria-hidden="true">*</b></label>
            <input id={`${id}-title`} ref={titleRef} autoFocus className="tk-title-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="What needs to get done?" aria-required="true" aria-invalid={submitted && Boolean(errors.title)} aria-describedby={submitted && errors.title ? `${id}-title-error` : undefined} />
            <div className="pe-field-foot">
              {submitted && errors.title ? <span id={`${id}-title-error`} className="pe-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{errors.title}</span> : createdCount > 0 ? <span className="tk-created-note" role="status"><CircleCheck size={13} aria-hidden="true" />{createdCount} created — keep going</span> : <span />}
              <span className="pe-counter">{title.trim().length}/200</span>
            </div>
          </div>

          <div className="pe-field">
            <label htmlFor={`${id}-description`}>Description <em>Optional</em></label>
            <textarea id={`${id}-description`} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} placeholder="Add context, links or acceptance criteria." />
          </div>

          <div className="pe-field">
            <span className="pe-label" id={`${id}-status`}>Status</span>
            <div className="tk-seg" role="radiogroup" aria-labelledby={`${id}-status`}>
              {TASK_STATUSES.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={status === value} className={`tone-${TASK_STATUS_TONE[value]} ${status === value ? "is-selected" : ""}`} onClick={() => setStatus(value)}>
                  <TaskStatusIcon status={value} size={14} />{statusLabel(value)}
                </button>
              ))}
            </div>
          </div>

          <div className="pe-field">
            <span className="pe-label" id={`${id}-priority`}>Priority</span>
            <div className="tk-seg is-priority" role="radiogroup" aria-labelledby={`${id}-priority`}>
              {TASK_PRIORITIES.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={priority === value} className={priority === value ? "is-selected" : ""} onClick={() => setPriority(value)}>
                  <PriorityIcon priority={value} size={14} />{value === "None" ? "None" : priorityLabel(value)}
                </button>
              ))}
            </div>
          </div>

          <div className="pe-row is-3 tk-form-row">
            <div className="pe-field">
              <label htmlFor={`${id}-due`}>Due date</label>
              <input id={`${id}-due`} type="date" value={dueDate} min={startDate || undefined} onChange={(event) => updateDueDate(event.target.value)} aria-invalid={submitted && Boolean(errors.dates)} />
              <div className="tk-quick-dates">
                {quickDates.map((option) => <button key={option.label} type="button" className={dueDate === option.value ? "is-on" : ""} aria-pressed={dueDate === option.value} onClick={() => updateDueDate(option.value)}>{option.label}</button>)}
                {dueDate && <button type="button" onClick={() => updateDueDate("")} aria-label="Clear due date"><X size={11} aria-hidden="true" /></button>}
              </div>
            </div>
            <div className="pe-field">
              <label htmlFor={`${id}-project`}>Project</label>
              <select id={`${id}-project`} className="tk-select-input" value={projectId} onChange={(event) => { setProjectId(event.target.value); setMilestoneId(""); }}>
                <option value="">No project</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
            <div className="pe-field">
              <label htmlFor={`${id}-milestone`}>Milestone</label>
              <select id={`${id}-milestone`} className="tk-select-input" value={milestoneId} disabled={!milestones.length} onChange={(event) => setMilestoneId(event.target.value)}>
                <option value="">{!projectId ? "Pick a project first" : milestones.length ? "No milestone" : "No open milestones"}</option>
                {milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
              </select>
            </div>
          </div>

          <TaskEditorReminderField
            value={reminder}
            onChange={(next) => {
              setReminderTouched(true);
              setReminder(next);
            }}
            dueDate={dueDate}
            timezone={prefTimezone}
            disabled={busy}
          />

          <div className="pe-field">
            <label htmlFor={`${id}-labels`}>Labels <em>Optional</em></label>
            <LabelInput id={`${id}-labels`} value={labels} onChange={setLabels} suggestions={suggestions} />
          </div>

          <div className="pe-field">
            <label htmlFor={`${id}-step`}>Subtasks <em>{steps.length ? `${steps.length} added` : "Optional"}</em></label>
            {steps.length > 0 && (
              <ol className="tk-step-list">
                {steps.map((step, index) => (
                  <li key={`${index}-${step}`}>
                    <span className="tk-step-dot" aria-hidden="true" />
                    <span>{step}</span>
                    <button type="button" className="tk-icon-btn is-sm" aria-label={`Remove subtask ${step}`} onClick={() => setSteps(steps.filter((_, position) => position !== index))}><X size={13} aria-hidden="true" /></button>
                  </li>
                ))}
              </ol>
            )}
            <div className="tk-step-add">
              <Plus size={14} aria-hidden="true" />
              <input id={`${id}-step`} ref={stepRef} value={stepDraft} onChange={(event) => setStepDraft(event.target.value)} maxLength={200} placeholder="Add a step and press Enter" onKeyDown={(event) => { if (event.key === "Enter" && stepDraft.trim()) { event.preventDefault(); addStep(); } }} />
            </div>
          </div>

          <button type="button" className="tk-more-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
            <ChevronDown size={14} aria-hidden="true" />{more ? "Fewer options" : "More options"}<span>Start date · estimate · notes</span>
          </button>
          {more && (
            <div className="tk-more">
              <div className="pe-row is-3 tk-form-row">
                <div className="pe-field">
                  <label htmlFor={`${id}-start`}>Start date</label>
                  <input id={`${id}-start`} type="date" value={startDate} max={dueDate || undefined} onChange={(event) => setStartDate(event.target.value)} aria-invalid={submitted && Boolean(errors.dates)} />
                </div>
                <div className="pe-field tk-estimate-field">
                  <span className="pe-label" id={`${id}-estimate`}>Estimate</span>
                  <div className="tk-quick-dates" role="radiogroup" aria-labelledby={`${id}-estimate`}>
                    {ESTIMATE_PRESETS.map((minutes) => <button key={minutes} type="button" role="radio" aria-checked={estimate === minutes} className={estimate === minutes ? "is-on" : ""} onClick={() => setEstimate(estimate === minutes ? null : minutes)}>{formatEstimate(minutes)}</button>)}
                  </div>
                </div>
              </div>
              <div className="pe-field">
                <label htmlFor={`${id}-notes`}>Notes <em>Optional</em></label>
                <textarea id={`${id}-notes`} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={8000} placeholder="Private working notes, links, decisions…" />
              </div>
            </div>
          )}
          {submitted && errors.dates && <span className="pe-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{errors.dates}</span>}
        </fieldset>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="modal-footer pe-footer">
          <label className="tk-inline-toggle">
            <input type="checkbox" checked={createMore === "on"} onChange={(event) => setCreateMore(event.target.checked ? "on" : "off")} />
            <span className="pe-switch" aria-hidden="true" />Create another
          </label>
          <span className="pe-hint" aria-hidden="true"><kbd>Ctrl</kbd><kbd>Enter</kbd></span>
          <div className="footer-spacer" />
          <button type="button" className="pj-btn is-secondary" onClick={onClose} disabled={phase === "saving"}>Cancel</button>
          <button type="submit" className={`pj-btn is-primary pe-submit ${phase === "saved" ? "is-success" : ""}`} disabled={busy}>
            {phase === "saving" ? <><Spinner size={15} />Creating…</> : phase === "saved" ? <><CircleCheck size={15} aria-hidden="true" />Created</> : "Create task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
