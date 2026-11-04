"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, CalendarCheck2, Check, CheckCheck, Columns3, Download, Ellipsis, Grid2X2, Lightbulb, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { dateKey, IDEA_STATUSES, type Idea, type Item, type Resource, type View, type WorkspaceData } from "@/lib/types";
import { Avatar, EmptyState, Spinner } from "@/components/ui";
import type { EditorState } from "@/components/editors";
import type { BulkResult, MutateOptions } from "@/lib/use-workspace";
import { TaskCalendar, type CalendarFocusEvent } from "@/components/task-calendar";
import { GoogleCalendarCard, useGoogleIntegration } from "@/components/integrations/google";
import { ProfileSettings } from "@/components/profile-settings";
import { NotificationSettingsSection } from "@/components/notification-settings";
import type { NotificationsController } from "@/lib/use-notifications";
import { DangerZoneSection } from "@/components/danger-zone";

export interface WorkspaceActions {
  data: WorkspaceData;
  openEditor: (editor: EditorState) => void;
  openProject: (id: string) => void;
  mutate: (kind: Resource, method: "POST" | "PATCH" | "DELETE", values?: Record<string, unknown>, id?: string, options?: MutateOptions) => Promise<Item>;
  bulkTasks: (ids: string[], change: Record<string, unknown> | "delete") => Promise<BulkResult>;
  deleteItem: (kind: Resource, item: Item) => void;
  convertIdea: (idea: Idea) => void;
  navigate: (view: View) => void;
  pending: Set<string>;
}

// The dashboard now lives in src/components/dashboard.tsx (OverviewPanel).

export function IdeasPanel({ actions }: { actions: WorkspaceActions }) {
  const [filter, setFilter] = useState("All ideas");
  const [board, setBoard] = useState(false);
  const [query, setQuery] = useState("");
  const [dragOver, setDragOver] = useState("");
  const filtered = actions.data.ideas.filter(idea => (filter === "All ideas" || idea.status === filter) && `${idea.title} ${idea.description}`.toLowerCase().includes(query.toLowerCase()));
  const renderCard = (idea: Idea) => <article className={`idea-card idea-${idea.color}`} key={idea.id} draggable={board} onDragStart={event => event.dataTransfer.setData("text/plain", idea.id)}><div className="idea-card-top"><span className="idea-bulb"><Lightbulb size={19} strokeWidth={1.5}/></span><span className="idea-stage">{idea.status}</span><button className="icon-button" aria-label={`Edit ${idea.title}`} onClick={() => actions.openEditor({ kind: "ideas", item: idea })}><Ellipsis size={18}/></button></div><button className="idea-title" onClick={() => actions.openEditor({ kind: "ideas", item: idea })}>{idea.title}</button><p>{idea.description || "A little possibility, waiting to be explored. Add your thoughts and see where it takes you."}</p><div className="idea-card-meta"><span>{idea.category}</span><span>{new Date(idea.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div><div className="idea-card-bottom"><button onClick={() => actions.convertIdea(idea)} disabled={actions.pending.has(idea.id)}>Make it a project <ArrowUpRight size={14}/></button><button className="icon-button" aria-label={`Delete ${idea.title}`} onClick={() => actions.deleteItem("ideas", idea)}><Trash2 size={14}/></button></div></article>;
  return <section className="ideas-section"><div className="idea-intro"><span className="idea-intro-icon"><Sparkles size={21}/></span><p>A home for your <strong>someday</strong>, your <strong>what if</strong>, and your <strong>why not</strong>.<br/><span>Capture it now. Figure out the details later.</span></p><span className="handdrawn-star">✳</span></div><div className="section-toolbar"><div className="tabs">{["All ideas", ...IDEA_STATUSES].map(value => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}<span>{actions.data.ideas.filter(idea => value === "All ideas" || idea.status === value).length}</span></button>)}</div><div className="view-switch"><button className={!board ? "active" : ""} aria-label="Idea grid view" onClick={() => setBoard(false)}><Grid2X2 size={16}/></button><button className={board ? "active" : ""} aria-label="Idea board view" onClick={() => setBoard(true)}><Columns3 size={16}/></button></div></div><label className="input-with-icon idea-search"><Search size={16}/><input value={query} placeholder="Find a little inspiration…" aria-label="Search ideas" onChange={event => setQuery(event.target.value)}/></label>{board ? <><p className="board-hint">Drag an idea to move it forward—or edit its stage.</p><div className="idea-board">{IDEA_STATUSES.map(stage => <div className={`idea-column ${dragOver === stage ? "drag-over" : ""}`} key={stage} onDragOver={event => { event.preventDefault(); setDragOver(stage); }} onDragLeave={() => setDragOver("")} onDrop={event => { event.preventDefault(); setDragOver(""); const id = event.dataTransfer.getData("text/plain"); if (actions.data.ideas.some(idea => idea.id === id)) void actions.mutate("ideas", "PATCH", { status: stage }, id).catch(() => {}); }}><div className="idea-column-heading"><h3><span className={`stage-dot stage-${IDEA_STATUSES.indexOf(stage)}`}/>{stage}<span>{filtered.filter(idea => idea.status === stage).length}</span></h3><button className="icon-button" aria-label={`Add idea to ${stage}`} onClick={() => actions.openEditor({ kind: "ideas", defaults: { status: stage } })}><Plus size={16}/></button></div>{filtered.filter(idea => idea.status === stage).map(renderCard)}<button className="add-idea-column" onClick={() => actions.openEditor({ kind: "ideas", defaults: { status: stage } })}><Plus size={16}/>A new possibility</button></div>)}</div></> : filtered.length ? <div className="ideas-grid">{filtered.map(renderCard)}<button className="new-idea-card" onClick={() => actions.openEditor({ kind: "ideas" })}><span><Plus size={24}/></span><strong>There’s room for another idea.</strong><p>What’s on your mind?</p></button></div> : <div className="panel"><EmptyState icon="idea" title="Leave a little room for possibility" description="No ideas here yet. A rough thought is all it takes to get started." action="Capture an idea" onAction={() => actions.openEditor({ kind: "ideas" })}/></div>}</section>;
}

export function CalendarPanel({
  actions,
  focusEvent,
  onFocusHandled,
}: {
  actions: WorkspaceActions;
  focusEvent?: CalendarFocusEvent | null;
  onFocusHandled?: (found: boolean) => void;
}) {
  // One calendar engine for the whole app: the Tasks calendar view uses it too.
  // Google events, Folio tasks, project deadlines and milestones all share it.
  const google = useGoogleIntegration();
  return (
    <div className="cal-page">
      <GoogleCalendarCard integration={google} compact />
      <TaskCalendar
        actions={actions}
        tasks={actions.data.tasks}
        persistKey="calendar"
        showProjects
        completedToggle
        milestones={actions.data.milestones}
        showMilestones
        google={google}
        focusEvent={focusEvent}
        onFocusHandled={onFocusHandled}
      />
    </div>
  );
}

export function SettingsPanel({
  data,
  onSave,
  onSignOut,
  notifications,
  notify,
  focusSectionNonce,
}: {
  data: WorkspaceData;
  onSave: (values: { name: string; weeklyGoal: number }) => Promise<void>;
  onSignOut: () => void;
  notifications?: NotificationsController;
  notify?: (message: string, tone?: "success" | "error") => void;
  focusSectionNonce?: number;
}) {
  const [name, setName] = useState(data.user.name);
  const [goal, setGoal] = useState(data.user.weeklyGoal);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!focusSectionNonce) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("notifications-settings")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusSectionNonce]);

  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); setSaved(false); try { await onSave({ name, weeklyGoal: goal }); setSaved(true); } catch (err) { setError(err instanceof Error ? err.message : "Could not save your settings."); } finally { setBusy(false); } }
  function exportWorkspace() { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `folio-workspace-${dateKey()}.json`; link.click(); URL.revokeObjectURL(url); }
  const providerLabel = data.user.provider === "google" ? "Google" : data.user.provider === "github" ? "GitHub" : data.user.provider === "demo" ? "Demo workspace" : "Email & password";
  const signedInVia = data.user.provider === "google" ? "Google" : data.user.provider === "github" ? "GitHub" : data.user.provider === "demo" ? "a shared demo profile" : "email";
  const integrations = <IntegrationsSection />;
  return (
    <div className="settings-layout">
      <div className="nf-settings-main-col">
        <ProfileSettings/>
        <form onSubmit={save} className="settings-form">
          <section className="panel settings-card">
            <div className="settings-section-heading"><h2>A little about you</h2><p>Make your workspace feel like home.</p></div>
            <div className="profile-preview"><Avatar name={name}/><div><strong>{name || "Your name"}</strong><span>{data.user.email}</span></div><span className="account-badge">{providerLabel}</span></div>
            <label className="form-field"><span>Your name</span><input value={name} onChange={event => setName(event.target.value)} maxLength={80} required/></label>
            <label className="form-field"><span>Email address</span><input value={data.user.email} disabled/></label>
            <p className="field-hint">You’re using {signedInVia}. Your email is used only to keep your workspace private.</p>
          </section>
          <section className="panel settings-card">
            <div className="settings-section-heading"><h2>Your pace. Your progress.</h2><p>Pick a weekly task goal that feels good, not overwhelming.</p></div>
            <label className="form-field goal-field"><span>Tasks per week</span><input type="number" value={goal} onChange={event => setGoal(Number(event.target.value))} min={1} max={100} required/><span className="field-hint">Your weekly focus resets every {data.user.personal?.weekStart === 0 ? "Sunday" : "Monday"}.</span></label>
          </section>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="settings-actions"><button className="button primary settings-save" disabled={busy}>{busy ? <Spinner/> : <Check size={16}/>}Save changes</button>{saved && <span className="settings-saved"><Check size={13}/>Saved</span>}</div>
        </form>
        {notifications && (
          <NotificationSettingsSection
            controller={notifications}
            notify={notify ?? (() => {})}
          />
        )}
        <div className="settings-aside is-integrations">{integrations}</div>
        <DangerZoneSection user={data.user} notify={notify} />
      </div>
      <aside className="settings-aside">
        <section className="panel settings-card data-card"><span className="settings-data-icon"><Download size={23}/></span><h2>Your work belongs to you.</h2><p>Download your projects, tasks, ideas, and activity as a JSON file. Keep a little backup of everything you’re building.</p><button className="button secondary full-width" type="button" onClick={exportWorkspace}><Download size={15}/>Export workspace</button></section>
        <section className="panel settings-card account-card"><LockIllustration/><h2>All your ideas. Just for you.</h2><p>Your workspace is private and securely linked to your account. Only you can see your projects, tasks, and ideas—and every change saves automatically.</p><button className="button secondary full-width" type="button" onClick={onSignOut}>Sign out<ArrowRight size={15}/></button><button className="text-link danger-text" style={{ marginTop: 12, justifyContent: "center" }} type="button" onClick={() => document.getElementById("danger-zone")?.scrollIntoView({ behavior: "smooth" })}>Danger zone: delete account…</button></section>
      </aside>
    </div>
  );
}

function IntegrationsSection() {
  const google = useGoogleIntegration();
  return <section className="panel settings-card integrations-card"><span className="settings-data-icon"><CalendarCheck2 size={22} /></span><h2>Integrations</h2><p>Connect Folio to the tools you already use.</p><GoogleCalendarCard integration={google} /></section>;
}

function LockIllustration() { return <span className="settings-data-icon color-green"><CheckCheck size={24}/></span>; }
