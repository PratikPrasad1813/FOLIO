"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, BrainCircuit, CalendarDays, Check, ChevronRight, ChevronsUpDown, CircleCheck, CircleHelp, FolderKanban, LayoutDashboard, Lightbulb, LogOut, Menu, PanelLeft, Plus, Search, Settings, Sparkles, SquareCheckBig, UserRound, X } from "lucide-react";
import { useWorkspace } from "@/lib/use-workspace";
import { useNotifications } from "@/lib/use-notifications";
import type { NotificationItem } from "@/lib/notifications";
import { dateKey, type Idea, type Item, type Resource, type View } from "@/lib/types";
import { MilestoneEditor, ResourceEditor, type EditorState } from "@/components/editors";
import { Avatar, EmptyState, Logo, Modal, Spinner } from "@/components/ui";
import { CalendarPanel, IdeasPanel, SettingsPanel, type WorkspaceActions } from "@/components/workspace-views";
import type { CalendarFocusEvent } from "@/components/task-calendar";
import { TasksError, TasksPanel, TasksSkeleton } from "@/components/tasks-view";
import { TaskEditor } from "@/components/task-editor";
import { TaskDetails } from "@/components/task-details";
import { ProjectsError, ProjectsPanel, ProjectsSkeleton } from "@/components/projects-view";
import { ProjectNotFound, ProjectWorkspace } from "@/components/project-workspace";
import { ProjectEditor } from "@/components/project-editor";
import { ThemeToggle } from "@/components/theme-toggle";
import { OverviewPanel } from "@/components/dashboard";
import { GlobalSearch } from "@/components/global-search";
import { FolioAIPanel } from "@/components/folio-ai-panel";
import { NotificationCenter } from "@/components/notification-center";
import { SyncIndicator } from "@/components/desktop/sync-indicator";
import { disposeSyncEngine } from "@/lib/desktop/sync-engine";
import { isDesktopRuntime } from "@/lib/desktop/runtime";
import { desktopSignOut } from "@/lib/desktop/auth-store";

const NAV_ITEMS = [
  { view: "overview" as View, label: "Overview", icon: LayoutDashboard },
  { view: "projects" as View, label: "Projects", icon: FolderKanban },
  { view: "tasks" as View, label: "My tasks", icon: SquareCheckBig },
  { view: "ideas" as View, label: "Idea board", icon: Lightbulb },
  { view: "calendar" as View, label: "Calendar", icon: CalendarDays },
  { view: "ai" as View, label: "Folio AI", icon: BrainCircuit },
];
const VIEW_NAMES: Record<View, string> = { overview: "Overview", projects: "Projects", tasks: "My tasks", ideas: "Idea board", calendar: "Calendar", ai: "Folio AI", settings: "Settings" };
const VIEW_SUBTITLES: Record<View, string> = { overview: "Let’s make a little progress on what matters.", projects: "A place for everything you’re working toward.", tasks: "Small steps. Meaningful progress. You’ve got this.", ideas: "Good things start with a little spark.", calendar: "A clearer picture of what’s coming your way.", ai: "A thoughtful assistant, powered by your own AI key.", settings: "Your space, your pace. Make it feel like you." };
const PROVIDER_LABELS: Record<string, string> = { email: "Email account", google: "Google account", github: "GitHub account", demo: "Demo workspace", neon: "Folio account" };
interface Confirmation { kind: Resource; item: Item; action: "delete" | "convert" }

export default function Workspace({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const segments = pathname.split("/").filter(Boolean);
  const route = segments[0] || "overview";
  const view: View = route in VIEW_NAMES ? route as View : "overview";
  const urlProjectId = view === "projects" && segments[1] ? decodeURIComponent(segments[1]) : null;
  // Desktop static shell: /projects/<id> URLs cannot exist in a static
  // export (dynamic ids are not prerenderable), so the open project is
  // client state there. The web keeps the real, shareable URL. Both values
  // are null on the projects list itself, so the prerendered HTML and the
  // hydration render stay identical — no mismatch.
  const [desktopProjectId, setDesktopProjectId] = useState<string | null>(null);
  const routeProjectId = isDesktopRuntime() ? desktopProjectId : urlProjectId;
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error"; key: number } | null>(null);
  const notify = useCallback((message: string, tone: "success" | "error" = "success") => setToast({ message, tone, key: Date.now() }), []);
  const { data, error, pending, reload, mutate, bulkTasks, convert, saveSettings, loadSearchItem } = useWorkspace(notify);
  const notifications = useNotifications(notify);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [popover, setPopover] = useState<"notifications" | "profile" | "workspace" | null>(null);
  const [calendarFocus, setCalendarFocus] = useState<CalendarFocusEvent | null>(null);
  const [settingsFocusNonce, setSettingsFocusNonce] = useState(0);
  const navigate = useCallback((next: View) => { setMobileOpen(false); setPopover(null); if (isDesktopRuntime()) setDesktopProjectId(null); router.push(`/${next}`); }, [router]);
  const openProject = useCallback((id: string) => { setMobileOpen(false); setPopover(null); if (isDesktopRuntime()) { setDesktopProjectId(id); return; } router.push(`/projects/${id}`); }, [router]);
  const openEditor = (next: EditorState) => { setEditor(next); setPopover(null); };
  const deleteItem = (kind: Resource, item: Item) => { setEditor(null); setConfirmError(""); setConfirmation({ kind, item, action: "delete" }); };

  const openNotificationPreferences = useCallback(() => {
    setMobileOpen(false);
    setPopover(null);
    setSettingsFocusNonce(Date.now());
    router.push("/settings");
  }, [router]);

  const handleNotificationNavigate = useCallback(
    (item: NotificationItem) => {
      if (item.entityType === "task" && item.entityId) {
        const task = data?.tasks.find((t) => t.id === item.entityId);
        if (task) {
          setEditor({ kind: "tasks", item: task });
          return;
        }
        navigate("tasks");
        notify("That task was removed from your workspace.", "error");
        return;
      }

      if (item.entityType === "project" || item.entityType === "milestone") {
        const projectId = item.metadata?.projectId || item.entityId;
        if (projectId && data?.projects.some((p) => p.id === projectId)) {
          openProject(projectId);
          return;
        }
        navigate("projects");
        notify("That project is no longer in your workspace.", "error");
        return;
      }

      if (item.entityType === "calendar_event" && item.entityId) {
        setCalendarFocus({
          eventId: item.entityId,
          date: item.metadata?.eventDate ?? null,
          nonce: Date.now(),
        });
        navigate("calendar");
        return;
      }

      if (item.metadata?.systemKind === "integration") {
        navigate("calendar");
        return;
      }

      if (item.entityType === "settings") {
        openNotificationPreferences();
      }
    },
    [data, navigate, notify, openNotificationPreferences, openProject],
  );

  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 4200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    return window.folioWindowsAPI?.onQuickAddTriggered(() => {
      setPopover(null);
      setSearchOpen(false);
      setHelpOpen(false);
      setEditor({ kind: "tasks" });
    });
  }, []);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPopover(null); setHelpOpen(false); setSearchOpen(value => !value); setEditor(null); setConfirmation(null); return; }
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || event.metaKey || event.ctrlKey || event.altKey || editor || searchOpen || confirmation || helpOpen || document.querySelector(".modal-backdrop, .sf-popover")) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); setEditor({ kind: "projects" }); }
      if (event.key.toLowerCase() === "t") { event.preventDefault(); setEditor({ kind: "tasks", defaults: routeProjectId ? { projectId: routeProjectId } : undefined }); }
      if (event.key.toLowerCase() === "m" && routeProjectId) { event.preventDefault(); setEditor({ kind: "milestones", defaults: { projectId: routeProjectId } }); }
      if (event.key.toLowerCase() === "i") { event.preventDefault(); setEditor({ kind: "ideas" }); }
      if (event.key === "?") setHelpOpen(true);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editor, searchOpen, confirmation, helpOpen, routeProjectId]);

  async function signOut() {
    setPopover(null);
    try {
      if (isDesktopRuntime()) {
        // Desktop: the ONLY path that clears the offline session. Revokes
        // the token (best-effort), clears local_auth, wipes the mirror and
        // stops the engine. The session gate then shows the sign-in screen —
        // never a navigation to /login (that page is web-only).
        await desktopSignOut();
        disposeSyncEngine();
        delete document.documentElement.dataset.folioAccount;
        return;
      }
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (!response.ok) throw new Error("Couldn’t sign out. Please try again.");
      delete document.documentElement.dataset.folioAccount;
      window.location.assign("/login");
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t sign out.", "error"); }
  }
  async function confirmAction() {
    if (!confirmation) return;
    setConfirmBusy(true); setConfirmError("");
    try {
      if (confirmation.action === "convert") { const project = await convert(confirmation.item as Idea); openProject(project.id); }
      else { if (confirmation.kind === "projects" && routeProjectId === confirmation.item.id) navigate("projects"); await mutate(confirmation.kind, "DELETE", {}, confirmation.item.id); }
      setConfirmation(null);
    } catch (err) { setConfirmError(err instanceof Error ? err.message : "Could not complete that action."); } finally { setConfirmBusy(false); }
  }

  const actions: WorkspaceActions | null = data ? { data, openEditor, openProject, mutate, deleteItem, convertIdea: idea => { setConfirmError(""); setConfirmation({ kind: "ideas", item: idea, action: "convert" }); }, navigate, pending, bulkTasks } : null;
  const routeProject = routeProjectId ? data?.projects.find(project => project.id === routeProjectId) : undefined;
  const saveFromEditor = async (kind: Resource, values: Record<string, unknown>, id?: string) => { await mutate(kind, id ? "PATCH" : "POST", values, id); };
  const taskCount = data?.tasks.filter(task => !task.completed).length || 0;
  const firstName = data?.user.greetingName || data?.user.name.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const pageTitle = view === "overview" ? `${greeting}, ${firstName}` : VIEW_NAMES[view];

  if (view === "ai") {
    return (
      <div className="folio-ai-fullscreen">
        <FolioAIPanel
          userName={data?.user.name ?? ""}
          key={data?.user.id ?? "guest"}
          isFullscreen
          onBackToFolio={() => navigate("overview")}
        />
      </div>
    );
  }

  return <div className="app-shell">
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sidebar-brand"><Link href="/overview" aria-label="Folio overview" onClick={() => setMobileOpen(false)}><Logo/></Link><span className="personal-label">PERSONAL</span><button className="icon-button sidebar-mobile-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={20}/></button></div>
      <div className="workspace-switcher-wrap"><button className="workspace-switcher" onClick={() => setPopover(popover === "workspace" ? null : "workspace")} aria-expanded={popover === "workspace"}><span className="workspace-letter">{(firstName[0] || "F").toUpperCase()}</span><span>My workspace<small>A space to make things happen</small></span><ChevronsUpDown size={14}/></button>{popover === "workspace" && <><button className="menu-dismiss" aria-label="Close workspace menu" onClick={() => setPopover(null)}/><div className="dropdown-menu workspace-dropdown"><div className="menu-caption">YOUR WORKSPACE</div><button onClick={() => navigate("overview")}><LayoutDashboard size={15}/>Personal workspace<Check size={14} className="menu-check"/></button><button onClick={() => navigate("settings")}><Settings size={15}/>Workspace settings</button></div></>}</div>
      <div className="nav-group-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">{NAV_ITEMS.map(item => <Link href={`/${item.view}`} key={item.view} className={`nav-item ${view === item.view ? "active" : ""}`} aria-current={view === item.view ? "page" : undefined} onClick={() => { setMobileOpen(false); setPopover(null); }}><item.icon size={18} strokeWidth={1.65}/><span>{item.label}</span>{item.view === "projects" && !!data?.projects.length && <span className="nav-count">{data.projects.length}</span>}{item.view === "tasks" && taskCount > 0 && <span className="nav-count">{taskCount}</span>}{item.view === "ideas" && !!data?.ideas.length && <span className="nav-new-dot"/>}</Link>)}</nav>
      <div className="sidebar-divider"/>
      <div className="nav-group-label favorites-label">FAVORITES<button className="icon-button" aria-label="Create a favorite project" onClick={() => openEditor({ kind: "projects", defaults: { favorite: true } })}><Plus size={15}/></button></div><div className="favorites-list">{data?.projects.filter(project => project.favorite && !project.archived).slice(0, 6).map(project => <button key={project.id} className={routeProjectId === project.id ? "active" : ""} aria-current={routeProjectId === project.id ? "page" : undefined} onClick={() => openProject(project.id)}><span className={`favorite-dot dot-${project.color}`}/><span>{project.name}</span></button>)}{data && !data.projects.some(project => project.favorite && !project.archived) && <p className="favorites-empty">Star a project to keep it close.</p>}{!data && <><div className="skeleton favorite-skeleton"/><div className="skeleton favorite-skeleton"/></>}</div>
      <div className="sidebar-bottom"><Link href="/settings" className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setMobileOpen(false)}><Settings size={18} strokeWidth={1.6}/><span>Settings</span></Link><button className="nav-item help-nav" onClick={() => { setHelpOpen(true); setMobileOpen(false); }}><CircleHelp size={18} strokeWidth={1.6}/><span>Help & shortcuts</span><ArrowUpRight size={14}/></button><div className="sidebar-note"><span className="note-sparkle">✳</span><strong>A little space. Big possibilities.</strong><p>Capture an idea while it’s fresh. Give it a home, then give it a plan.</p><button onClick={() => openEditor({ kind: "ideas" })}>Capture an idea<ArrowUpRight size={15}/></button></div><div className="sidebar-profile-wrap"><button className="sidebar-profile" onClick={() => setPopover(popover === "profile" ? null : "profile")} aria-expanded={popover === "profile"}><Avatar name={data?.user.name || "You"}/><span><strong>{data?.user.name || "Your workspace"}</strong><small>{PROVIDER_LABELS[data?.user.provider || "email"] || "Personal account"}</small></span><ChevronsUpDown size={14}/></button>{popover === "profile" && <><button className="menu-dismiss" aria-label="Close account menu" onClick={() => setPopover(null)}/><div className="dropdown-menu profile-dropdown"><div className="menu-caption">{data?.user.email || "DEMO MODE"}</div><button onClick={() => navigate("settings")}><UserRound size={15}/>Account settings</button><button onClick={() => signOut()}><LogOut size={15}/>Sign out</button></div></>}</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21}/></button><PanelLeft size={17} className="breadcrumb-icon"/><div className="breadcrumbs"><button onClick={() => navigate("overview")}>My workspace</button><ChevronRight size={13}/>{routeProjectId ? <><button onClick={() => navigate("projects")}>Projects</button><ChevronRight size={13}/><span>{routeProject?.name ?? "Project"}</span></> : <span>{VIEW_NAMES[view]}</span>}</div></div><div className="topbar-right"><button className="global-search" aria-label="Search workspace" aria-keyshortcuts="Control+k Meta+k" onClick={() => { setPopover(null); setSearchOpen(true); }}><Search size={16}/><span>Search anything…</span><kbd>⌘ K</kbd></button><button className="icon-button top-help" aria-label="Help and keyboard shortcuts" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/></button><ThemeToggle/><SyncIndicator/><NotificationCenter controller={notifications} isOpen={popover === "notifications"} onToggle={() => setPopover(popover === "notifications" ? null : "notifications")} onClose={() => setPopover(null)} onNavigateEntity={handleNotificationNavigate} onOpenPreferences={openNotificationPreferences}/><span className="topbar-divider"/><button className="top-avatar plain-button" aria-label="Open account settings" onClick={() => navigate("settings")}><Avatar name={data?.user.name || "You"}/></button></div></header>
      <main className={`main-content view-${view}`}>
        {view !== "overview" && view !== "projects" && view !== "tasks" && <div className="page-heading"><div><h1>{pageTitle}</h1><p>{VIEW_SUBTITLES[view]}</p></div><div className="page-heading-actions">{view !== "settings" && <button className="button primary new-resource-button" disabled={!data} onClick={() => openEditor({ kind: view === "ideas" ? "ideas" : view === "calendar" ? "tasks" : "projects", defaults: view === "calendar" ? { dueDate: dateKey() } : undefined })}><Plus size={16}/>{view === "ideas" ? "Capture an idea" : view === "calendar" ? "New task" : "New project"}</button>}</div></div>}
        {!data ? error ? view === "projects" ? <ProjectsError message={error} onRetry={() => { void reload().catch(() => {}); }}/> : view === "tasks" ? <TasksError message={error} onRetry={() => { void reload().catch(() => {}); }}/> : <div className="panel error-panel"><EmptyState title="Let’s try that again" description={error} action="Reload workspace" onAction={() => { void reload().catch(() => {}); }}/></div> : view === "projects" ? <ProjectsSkeleton/> : view === "tasks" ? <TasksSkeleton/> : <DashboardSkeleton/> : actions && <>{view === "overview" && <OverviewPanel actions={actions} onReload={() => { void reload().catch(() => {}); }}/ >} {view === "projects" && (routeProjectId ? (routeProject ? <ProjectWorkspace key={routeProject.id} project={routeProject} actions={actions} onBack={() => navigate("projects")}/> : <ProjectNotFound onBack={() => navigate("projects")}/>) : <ProjectsPanel actions={actions}/>)} {view === "tasks" && <TasksPanel actions={actions}/>} {view === "ideas" && <IdeasPanel actions={actions}/>} {view === "calendar" && <CalendarPanel actions={actions} focusEvent={calendarFocus} onFocusHandled={(found) => { setCalendarFocus(null); if (!found) notify("That calendar event is no longer available.", "error"); }}/>} {view === "settings" && <SettingsPanel key={data.user.id} data={data} onSave={saveSettings} onSignOut={() => { void signOut(); }} notifications={notifications} notify={notify} focusSectionNonce={settingsFocusNonce}/>}</>}
        {children}
        <footer className="workspace-footer"><span><span className="footer-spark">✳</span>A little more organized. A little more you.</span><span className="save-status">{pending.size > 0 ? <><Spinner size={12}/>Saving your progress…</> : data ? <><span className="tiny-dot"/>All changes saved</> : <><Spinner size={12}/>Getting things ready…</>}</span></footer>
      </main>
    </div>
    {editor && data && (editor.kind === "projects" ? <ProjectEditor key={`projects-${editor.item?.id || "new"}`} editor={editor} projects={data.projects} onClose={() => setEditor(null)} onSave={saveFromEditor} onDelete={deleteItem}/> : editor.kind === "tasks" ? (editor.item ? (data.tasks.some(task => task.id === editor.item?.id) ? <TaskDetails key={`task-${editor.item.id}`} task={data.tasks.find(task => task.id === editor.item?.id)!} actions={actions!} notifications={notifications} notify={notify} onClose={() => setEditor(null)}/> : null) : <TaskEditor key={`task-new-${JSON.stringify(editor.defaults ?? {})}`} editor={editor} data={data} notifications={notifications} onClose={() => setEditor(null)} onCreate={async values => { await mutate("tasks", "POST", values); }}/>) : editor.kind === "milestones" ? <MilestoneEditor key={`milestones-${editor.item?.id || "new"}`} editor={editor} projects={data.projects} onClose={() => setEditor(null)} onSave={saveFromEditor} onDelete={deleteItem}/> : <ResourceEditor key={`${editor.kind}-${editor.item?.id || "new"}`} editor={editor} projects={data.projects} milestones={data.milestones} onClose={() => setEditor(null)} onSave={saveFromEditor} onDelete={deleteItem}/>)}
    {confirmation && <Modal title={confirmation.action === "convert" ? "Give that idea a little momentum." : `Delete this ${confirmation.kind.slice(0, -1)}?`} onClose={() => { if (!confirmBusy) setConfirmation(null); }} className="confirm-modal"><div className={`confirm-icon ${confirmation.action === "convert" ? "color-violet" : ""}`}>{confirmation.action === "convert" ? <Sparkles size={25}/> : <Trash2Icon/>}</div><h3>{"name" in confirmation.item ? confirmation.item.name : confirmation.item.title}</h3><p>{confirmation.action === "convert" ? "We’ll turn this idea into a new project, keeping its name, notes, and color. It will move from your idea board to Projects, ready for its first task." : confirmation.kind === "projects" ? "This project and its milestones will be permanently deleted. Its tasks stay safe in My tasks as personal tasks. Prefer to keep its history? Archive it instead." : confirmation.kind === "milestones" ? "This milestone will be permanently deleted. Tasks linked to it stay in the project — they just won’t belong to a milestone anymore." : "This will be permanently removed from your workspace. This can’t be undone."}</p>{confirmError && <div className="form-error" role="alert">{confirmError}</div>}<div className="modal-footer"><button className="button secondary" disabled={confirmBusy} onClick={() => setConfirmation(null)}>Keep it for now</button><button className={`button ${confirmation.action === "convert" ? "primary" : "danger"}`} disabled={confirmBusy} onClick={() => { void confirmAction(); }}>{confirmBusy ? <Spinner/> : confirmation.action === "convert" ? <ArrowUpRight size={16}/> : <Trash2Icon/>} {confirmation.action === "convert" ? "Make it a project" : "Yes, delete it"}</button></div></Modal>}
    {searchOpen && <GlobalSearch localData={data} onClose={() => setSearchOpen(false)} onSelect={async result => {
      const item = await loadSearchItem(result.kind, result.id);
      if (result.kind === "projects") openProject(item.id);
      else {
        navigate(result.kind === "tasks" ? "tasks" : "ideas");
        openEditor({ kind: result.kind, item });
      }
    }}/>}
    {helpOpen && <Modal title="A little help, when you need it." subtitle="Less clicking. More making things happen." onClose={() => setHelpOpen(false)} className="help-modal"><div className="help-tip"><Sparkles size={21}/><p>Start with a project, break it into small tasks, and capture the ideas that come along. There’s no perfect way to get organized—just your way.</p></div><h3>Little shortcuts</h3><div className="shortcut-list">{[["Search your whole workspace", "⌘ / Ctrl", "K"], ["Start a new project", "N"], ["Add a task", "T"], ["Capture an idea", "I"], ["Add a milestone (inside a project)", "M"], ["Search projects or tasks", "/"], ["Quick add a task (Tasks page)", "Q"], ["Open this little guide", "?"], ["Close a dialog", "Esc"]].map(([label, ...keys]) => <div key={label}><span>{label}</span><span>{keys.map(key => <kbd key={key}>{key}</kbd>)}</span></div>)}</div><div className="help-note"><CircleCheck size={18}/><p><strong>One less thing to think about.</strong> Your changes save automatically. Star projects to keep them close, and turn ideas into projects whenever you’re ready.</p></div><button className="button primary full-width" onClick={() => setHelpOpen(false)}>Got it. Let’s make things happen <ArrowRight size={16}/></button></Modal>}
    {toast && <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.tone === "success" ? <CircleCheck size={18}/> : <CircleHelp size={18}/>}<span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16}/></button></div>}
  </div>;
}

function Trash2Icon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>; }

function DashboardSkeleton() { return <div className="dashboard-skeleton" aria-label="Loading your workspace" role="status"><div className="skeleton skeleton-banner"/><div className="skeleton-stat-grid">{Array.from({ length: 4 }).map((_, index) => <div className="skeleton skeleton-stat" key={index}/>)}</div><div className="skeleton skeleton-section-heading"/><div className="skeleton-project-grid">{Array.from({ length: 3 }).map((_, index) => <div className="skeleton skeleton-project" key={index}/>)}</div><span className="sr-only">Getting your projects and possibilities ready…</span></div>; }
