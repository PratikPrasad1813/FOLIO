"use client";

import { useState, type FormEvent } from "react";
import { Check, Sparkles, Trash2 } from "lucide-react";
import { COLORS, IDEA_STATUSES, PROJECT_STATUSES, type Item, type Project, type Resource } from "@/lib/types";
import { Modal, PROJECT_ICONS, ProjectIcon, Spinner } from "@/components/ui";

export interface EditorState { kind: Resource; item?: Item; defaults?: Record<string, unknown> }
interface EditorProps { editor: EditorState; projects: Project[]; onClose: () => void; onSave: (kind: Resource, data: Record<string, unknown>, id?: string) => Promise<void>; onDelete: (kind: Resource, item: Item) => void }

export function ResourceEditor({ editor, projects, onClose, onSave, onDelete }: EditorProps) {
  const { kind, item, defaults = {} } = editor;
  const record = (item || defaults) as unknown as Record<string, unknown>;
  const [name, setName] = useState(String(record.name || record.title || ""));
  const [description, setDescription] = useState(String(record.description || ""));
  const [color, setColor] = useState(String(record.color || (kind === "ideas" ? "yellow" : "violet")));
  const [icon, setIcon] = useState(String(record.icon || "layout"));
  const [status, setStatus] = useState(String(record.status || (kind === "ideas" ? "Just an idea" : "Planning")));
  const [priority, setPriority] = useState(String(record.priority || "Medium"));
  const [category, setCategory] = useState(String(record.category || "Personal"));
  const [dueDate, setDueDate] = useState(String(record.dueDate || ""));
  const [projectId, setProjectId] = useState(String(record.projectId || ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const singular = kind === "ideas" ? "idea" : kind === "tasks" ? "task" : "project";
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    let values: Record<string, unknown>;
    if (kind === "projects") values = { name, description, color, icon, status, priority, category, dueDate: dueDate || null, ...(!item && defaults.favorite ? { favorite: true } : {}) };
    else if (kind === "tasks") values = { title: name, description, priority, dueDate: dueDate || null, projectId: projectId || null };
    else values = { title: name, description, color, status, category };
    try { await onSave(kind, values, item?.id); onClose(); } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong. Please try again."); } finally { setBusy(false); }
  }
  return <Modal title={item ? `Edit ${singular}` : kind === "ideas" ? "Catch a little inspiration" : `Create a new ${singular}`} subtitle={kind === "ideas" ? "It doesn’t have to be perfect. Just get it down." : kind === "tasks" ? "Every big thing starts with a small step." : "Give your next big thing a place to grow."} onClose={() => { if (!busy) onClose(); }} className="editor-modal">
    <form onSubmit={submit} className="editor-form">
      {kind === "projects" && <div className="project-appearance"><ProjectIcon icon={icon} color={color}/><div><span className="field-label">Make it recognizable</span><div className="icon-options">{Object.entries(PROJECT_ICONS).map(([key, Icon]) => <button key={key} type="button" className={`icon-option ${icon === key ? "selected" : ""}`} aria-label={`${key} project icon`} aria-pressed={icon === key} onClick={() => setIcon(key)}><Icon size={17}/></button>)}</div></div></div>}
      <label className="form-field"><span>{kind === "projects" ? "Project name" : kind === "tasks" ? "Task name" : "What’s the idea?"}<b>*</b></span><input autoFocus aria-label={kind === "projects" ? "Project name" : kind === "tasks" ? "Task name" : "What’s the idea?"} value={name} onChange={event => setName(event.target.value)} placeholder={kind === "projects" ? "Something worth working on…" : kind === "tasks" ? "What needs to get done?" : "What if…"} required maxLength={kind === "tasks" ? 200 : 100}/></label>
      <label className="form-field"><span>{kind === "ideas" ? "Let your thoughts wander" : "Description"}<em>Optional</em></span><textarea aria-label={kind === "ideas" ? "Let your thoughts wander" : "Description"} value={description} onChange={event => setDescription(event.target.value)} placeholder={kind === "ideas" ? "A rough thought, a little inspiration, a big possibility…" : "Add a little context, a goal, or the details that matter."} rows={4} maxLength={4000}/></label>
      <div className="form-grid">
        {kind !== "tasks" && <label className="form-field"><span>{kind === "ideas" ? "Stage" : "Status"}</span><select aria-label={kind === "ideas" ? "Stage" : "Status"} value={status} onChange={event => setStatus(event.target.value)}>{(kind === "ideas" ? IDEA_STATUSES : PROJECT_STATUSES).map(value => <option key={value}>{value}</option>)}</select></label>}
        {kind !== "ideas" && <label className="form-field"><span>Priority</span><select aria-label="Priority" value={priority} onChange={event => setPriority(event.target.value)}>{["Low", "Medium", "High"].map(value => <option key={value}>{value}</option>)}</select></label>}
        {kind === "tasks" && <label className="form-field"><span>Project</span><select aria-label="Project" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">No project · Personal task</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
        {kind !== "tasks" && <label className="form-field"><span>Category</span><input aria-label="Category" value={category} onChange={event => setCategory(event.target.value)} placeholder="Personal, Design, Work…" maxLength={50}/></label>}
        {kind !== "ideas" && <label className="form-field"><span>Due date<em>Optional</em></span><input aria-label="Due date" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)}/></label>}
      </div>
      {kind !== "tasks" && <div className="form-field"><span>Color</span><div className="color-options">{COLORS.map(value => <button key={value} type="button" className={`color-option swatch-${value} ${color === value ? "selected" : ""}`} aria-label={`${value} color`} aria-pressed={color === value} onClick={() => setColor(value)}>{color === value && <Check size={17}/>}</button>)}</div></div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-footer">{item && <button className="icon-button danger-text" type="button" aria-label={`Delete ${singular}`} onClick={() => onDelete(kind, item)} disabled={busy}><Trash2 size={18}/></button>}<div className="footer-spacer"/><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>{busy ? <Spinner/> : kind === "ideas" && !item ? <Sparkles size={16}/> : null}{busy ? "Saving…" : item ? "Save changes" : kind === "ideas" ? "Save idea" : `Create ${singular}`}</button></div>
    </form>
  </Modal>;
}
