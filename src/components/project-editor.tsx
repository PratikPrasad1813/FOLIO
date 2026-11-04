"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, CircleAlert, CircleCheck, Star, Trash2 } from "lucide-react";
import { COLORS, dateKey, formatDate, PROJECT_STATUSES, statusLabel, type Item, type Priority, type Project, type ProjectStatus, type Resource } from "@/lib/types";
import { Modal, PROJECT_ICONS, ProjectIcon, Spinner } from "@/components/ui";
import type { EditorState } from "@/components/editors";
import { STATUS_ICON, STATUS_TONE } from "@/components/project-parts";

interface ProjectEditorProps {
  editor: EditorState;
  projects: Project[];
  onClose: () => void;
  onSave: (kind: Resource, data: Record<string, unknown>, id?: string) => Promise<void>;
  onDelete: (kind: Resource, item: Item) => void;
}

const PRIORITY_ORDER: Priority[] = ["Low", "Medium", "High"];

export function ProjectEditor({ editor, projects, onClose, onSave, onDelete }: ProjectEditorProps) {
  const item = editor.kind === "projects" ? (editor.item as Project | undefined) : undefined;
  const source: Partial<Project> = item ?? ((editor.defaults ?? {}) as Partial<Project>);
  const id = useId();
  const [name, setName] = useState(source.name ?? "");
  const [description, setDescription] = useState(source.description ?? "");
  const [icon, setIcon] = useState(source.icon ?? "layout");
  const [color, setColor] = useState<string>(source.color ?? "violet");
  const [status, setStatus] = useState<ProjectStatus>(source.status ?? "Planning");
  const [priority, setPriority] = useState<Priority>(source.priority ?? "Medium");
  const [category, setCategory] = useState(source.category ?? "Personal");
  const [startDate, setStartDate] = useState(source.startDate ?? (item ? "" : dateKey()));
  const [dueDate, setDueDate] = useState(source.dueDate ?? "");
  const [favorite, setFavorite] = useState(Boolean(source.favorite));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => [...new Set(projects.map((project) => project.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [projects]);
  const errors = {
    name: !name.trim() ? "Give your project a name." : name.trim().length > 100 ? "Keep the name under 100 characters." : "",
    description: description.length > 4000 ? "Keep the description under 4,000 characters." : "",
    category: category.trim().length > 50 ? "Keep the category under 50 characters." : "",
    dueDate: startDate && dueDate && dueDate < startDate ? "The due date can’t be before the start date." : "",
  };
  const visibleError = (field: keyof typeof errors) => ((submitted || touched[field]) && errors[field]) || "";
  const touch = (field: string) => setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  const busy = phase !== "idle";

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setSubmitted(true);
    if (errors.name) { nameRef.current?.focus(); return; }
    if (errors.dueDate) { dueRef.current?.focus(); return; }
    if (errors.description || errors.category || submitting.current) return;
    submitting.current = true; // blocks double-clicks before React re-renders
    setPhase("saving");
    setError("");
    try {
      await onSave("projects", { name: name.trim(), description: description.trim(), icon, color, status, priority, category: category.trim() || "Personal", startDate: startDate || null, dueDate: dueDate || null, favorite }, item?.id);
      setPhase("saved");
      window.setTimeout(onClose, 450);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPhase("idle");
      submitting.current = false;
    }
  }

  const fieldError = (field: keyof typeof errors) => {
    const message = visibleError(field);
    return message ? <span id={`${id}-${field}-error`} className="pe-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{message}</span> : null;
  };

  return (
    <Modal title={item ? "Edit project" : "New project"} subtitle={item ? "Refine the details — everything saves to your workspace." : "Give your next big thing a place to grow."} onClose={() => { if (!busy) onClose(); }} className="editor-modal pe-modal">
      <form className="editor-form pe-form" onSubmit={submit} noValidate onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submit(); } }}>
        <div className={`pe-preview c-${color}`} aria-hidden="true">
          <ProjectIcon icon={icon} color={color} />
          <div>
            <strong>{name.trim() || "Untitled project"}</strong>
            <span>{category.trim() || "Personal"} · {statusLabel(status)} · {priority} priority{dueDate ? ` · due ${formatDate(dueDate)}` : ""}</span>
          </div>
        </div>

        <fieldset className="pe-fields" disabled={busy}>
          <div className="pe-field">
            <label htmlFor={`${id}-name`}>Project name <b aria-hidden="true">*</b></label>
            <input id={`${id}-name`} ref={nameRef} autoFocus value={name} onChange={(event) => setName(event.target.value)} onBlur={() => touch("name")} maxLength={100} placeholder="e.g. Launch the new website" aria-required="true" aria-invalid={Boolean(visibleError("name"))} aria-describedby={visibleError("name") ? `${id}-name-error` : undefined} />
            <div className="pe-field-foot">{fieldError("name") ?? <span />}<span className="pe-counter">{name.trim().length}/100</span></div>
          </div>

          <div className="pe-field">
            <label htmlFor={`${id}-description`}>Description <em>Optional</em></label>
            <textarea id={`${id}-description`} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => touch("description")} maxLength={4000} placeholder="What does done look like? Add the goal, the why, or useful context." aria-invalid={Boolean(visibleError("description"))} aria-describedby={visibleError("description") ? `${id}-description-error` : undefined} />
            <div className="pe-field-foot">{fieldError("description") ?? <span />}<span className="pe-counter">{description.length}/4000</span></div>
          </div>

          <div className="pe-row">
            <div className="pe-field">
              <span className="pe-label" id={`${id}-icon`}>Icon</span>
              <div className="pe-icons" role="radiogroup" aria-labelledby={`${id}-icon`}>
                {Object.entries(PROJECT_ICONS).map(([key, Icon]) => (
                  <button key={key} type="button" role="radio" aria-checked={icon === key} aria-label={`${key} icon`} className={icon === key ? "is-selected" : ""} onClick={() => setIcon(key)}><Icon size={16} aria-hidden="true" /></button>
                ))}
              </div>
            </div>
            <div className="pe-field">
              <span className="pe-label" id={`${id}-color`}>Colour</span>
              <div className="pe-colors" role="radiogroup" aria-labelledby={`${id}-color`}>
                {COLORS.map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={color === value} aria-label={`${value} colour`} className={`c-${value} ${color === value ? "is-selected" : ""}`} onClick={() => setColor(value)}>{color === value && <Check size={13} strokeWidth={3} aria-hidden="true" />}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="pe-field">
            <span className="pe-label" id={`${id}-status`}>Status</span>
            <div className="pe-segmented" role="radiogroup" aria-labelledby={`${id}-status`}>
              {PROJECT_STATUSES.map((value) => {
                const Icon = STATUS_ICON[value];
                return <button key={value} type="button" role="radio" aria-checked={status === value} className={`tone-${STATUS_TONE[value]} ${status === value ? "is-selected" : ""}`} onClick={() => setStatus(value)}><Icon size={14} aria-hidden="true" />{statusLabel(value)}</button>;
              })}
            </div>
          </div>

          <div className="pe-field">
            <span className="pe-label" id={`${id}-priority`}>Priority</span>
            <div className="pe-segmented is-priority" role="radiogroup" aria-labelledby={`${id}-priority`}>
              {PRIORITY_ORDER.map((value) => <button key={value} type="button" role="radio" aria-checked={priority === value} className={`is-${value.toLowerCase()} ${priority === value ? "is-selected" : ""}`} onClick={() => setPriority(value)}><i aria-hidden="true" />{value}</button>)}
            </div>
          </div>

          <div className="pe-row is-3">
            <div className="pe-field">
              <label htmlFor={`${id}-start`}>Start date</label>
              <input id={`${id}-start`} type="date" value={startDate} max={dueDate || undefined} onChange={(event) => setStartDate(event.target.value)} onBlur={() => touch("dueDate")} />
            </div>
            <div className="pe-field">
              <label htmlFor={`${id}-due`}>Due date <em>Optional</em></label>
              <input id={`${id}-due`} ref={dueRef} type="date" value={dueDate} min={startDate || undefined} onChange={(event) => setDueDate(event.target.value)} onBlur={() => touch("dueDate")} aria-invalid={Boolean(visibleError("dueDate"))} aria-describedby={visibleError("dueDate") ? `${id}-dueDate-error` : undefined} />
            </div>
            <div className="pe-field">
              <label htmlFor={`${id}-category`}>Category</label>
              <input id={`${id}-category`} list={`${id}-categories`} value={category} onChange={(event) => setCategory(event.target.value)} onBlur={() => touch("category")} maxLength={50} placeholder="Personal, Design, Work…" aria-invalid={Boolean(visibleError("category"))} />
              <datalist id={`${id}-categories`}>{categories.map((value) => <option key={value} value={value} />)}</datalist>
            </div>
          </div>
          {(fieldError("dueDate") || fieldError("category")) && <div className="pe-field-foot is-row">{fieldError("dueDate")}{fieldError("category")}</div>}

          <label className="pe-toggle">
            <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} />
            <span className="pe-switch" aria-hidden="true" />
            <span className="pe-toggle-copy"><strong><Star size={13} aria-hidden="true" />Pin to favorites</strong><small>Keep it one click away in the sidebar.</small></span>
          </label>
        </fieldset>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="modal-footer pe-footer">
          {item && <button type="button" className="pj-btn is-danger-ghost" onClick={() => onDelete("projects", item)} disabled={busy}><Trash2 size={15} aria-hidden="true" />Delete</button>}
          <span className="pe-hint" aria-hidden="true"><kbd>Ctrl</kbd><kbd>Enter</kbd> to save</span>
          <div className="footer-spacer" />
          <button type="button" className="pj-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={`pj-btn is-primary pe-submit ${phase === "saved" ? "is-success" : ""}`} disabled={busy}>
            {phase === "saving" ? <><Spinner size={15} />{item ? "Saving…" : "Creating…"}</> : phase === "saved" ? <><CircleCheck size={15} aria-hidden="true" />{item ? "Saved" : "Created"}</> : item ? "Save changes" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
