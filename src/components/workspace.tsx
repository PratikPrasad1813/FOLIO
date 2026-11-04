"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, ChevronRight, ChevronsUpDown, CircleCheck, CircleHelp, Command, FolderKanban, LayoutDashboard, Lightbulb, LogOut, Menu, PanelLeft, Plus, Search, Settings, Sparkles, SquareCheckBig, Sun, UserRound, X } from "lucide-react";
import { useWorkspace } from "@/lib/use-workspace";
import { dateKey, type Idea, type Item, type Resource, type View } from "@/lib/types";
<<<<<<< Updated upstream
import { ResourceEditor, type EditorState } from "@/components/editors";
import { Avatar, EmptyState, Logo, Modal, ProjectIcon, Spinner } from "@/components/ui";
import { CalendarPanel, IdeasPanel, OverviewPanel, ProjectDetails, ProjectsPanel, SettingsPanel, TasksPanel, type WorkspaceActions } from "@/components/workspace-views";
=======
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
>>>>>>> Stashed changes

const NAV_ITEMS = [
  { view: "overview" as View, label: "Overview", icon: LayoutDashboard },
  { view: "projects" as View, label: "Projects", icon: FolderKanban },
  { view: "tasks" as View, label: "My tasks", icon: SquareCheckBig },
  { view: "ideas" as View, label: "Idea board", icon: Lightbulb },
  { view: "calendar" as View, label: "Calendar", icon: CalendarDays },
];
const VIEW_NAMES: Record<View, string> = { overview: "Overview", projects: "Projects", tasks: "My tasks", ideas: "Idea board", calendar: "Calendar", settings: "Settings" };
const VIEW_SUBTITLES: Record<View, string> = { overview: "Let’s make a little progress on what matters.", projects: "A place for everything you’re working toward.", tasks: "Small steps. Meaningful progress. You’ve got this.", ideas: "Good things start with a little spark.", calendar: "A clearer picture of what’s coming your way.", settings: "Your space, your pace. Make it feel like you." };
const PROVIDER_LABELS: Record<string, string> = { email: "Email account", google: "Google account", github: "GitHub account" };
interface Confirmation { kind: Resource; item: Item; action: "delete" | "convert" }

export default function Workspace() {
  const pathname = usePathname();
  const router = useRouter();
  const route = pathname.split("/")[1] || "overview";
  const view: View = route in VIEW_NAMES ? route as View : "overview";
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error"; key: number } | null>(null);
  const notify = useCallback((message: string, tone: "success" | "error" = "success") => setToast({ message, tone, key: Date.now() }), []);
  const { data, error, pending, reload, mutate, convert, saveSettings } = useWorkspace(notify);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [popover, setPopover] = useState<"notifications" | "profile" | "workspace" | null>(null);
  const [notificationsSeen, setNotificationsSeen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useCallback((next: View) => { setMobileOpen(false); setPopover(null); router.push(`/${next}`); }, [router]);
  const openEditor = (next: EditorState) => { setEditor(next); setPopover(null); };
  const deleteItem = (kind: Resource, item: Item) => { setEditor(null); setConfirmError(""); setConfirmation({ kind, item, action: "delete" }); };

<<<<<<< Updated upstream
=======
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

>>>>>>> Stashed changes
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 4200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearch(""); setSearchOpen(value => !value); setEditor(null); setSelectedProject(null); setConfirmation(null); return; }
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || event.metaKey || event.ctrlKey || event.altKey || editor || searchOpen || confirmation || selectedProject || helpOpen) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); setEditor({ kind: "projects" }); }
      if (event.key.toLowerCase() === "t") { event.preventDefault(); setEditor({ kind: "tasks" }); }
      if (event.key.toLowerCase() === "i") { event.preventDefault(); setEditor({ kind: "ideas" }); }
      if (event.key === "?") setHelpOpen(true);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editor, searchOpen, confirmation, selectedProject, helpOpen]);

  async function signOut() {
    setPopover(null); setSigningOut(true);
    try {
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (!response.ok) throw new Error("Couldn’t sign out. Please try again.");
<<<<<<< Updated upstream
      window.location.href = "/";
    } catch (err) { setSigningOut(false); notify(err instanceof Error ? err.message : "Could not sign out.", "error"); }
=======
      delete document.documentElement.dataset.folioAccount;
      window.location.assign("/login");
    } catch (error) { notify(error instanceof Error ? error.message : "Couldn’t sign out.", "error"); }
>>>>>>> Stashed changes
  }
  async function confirmAction() {
    if (!confirmation) return;
    setConfirmBusy(true); setConfirmError("");
    try {
      if (confirmation.action === "convert") { const project = await convert(confirmation.item as Idea); setSelectedProject(project.id); }
      else { await mutate(confirmation.kind, "DELETE", {}, confirmation.item.id); if (selectedProject === confirmation.item.id) setSelectedProject(null); }
      setConfirmation(null);
    } catch (err) { setConfirmError(err instanceof Error ? err.message : "Could not complete that action."); } finally { setConfirmBusy(false); }
  }

  const actions: WorkspaceActions | null = data ? { data, openEditor, openProject: setSelectedProject, mutate, deleteItem, convertIdea: idea => { setConfirmError(""); setConfirmation({ kind: "ideas", item: idea, action: "convert" }); }, navigate, pending } : null;
  const currentProject = data?.projects.find(project => project.id === selectedProject);
  const taskCount = data?.tasks.filter(task => !task.completed).length || 0;
  const firstName = data?.user.name.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const pageTitle = view === "overview" ? `${greeting}, ${firstName}` : VIEW_NAMES[view];
  const query = search.trim().toLowerCase();
  const searchProjects = data?.projects.filter(project => `${project.name} ${project.description}`.toLowerCase().includes(query)).slice(0, 5) || [];
  const searchTasks = data?.tasks.filter(task => task.title.toLowerCase().includes(query)).slice(0, 5) || [];
  const searchIdeas = data?.ideas.filter(idea => `${idea.title} ${idea.description}`.toLowerCase().includes(query)).slice(0, 4) || [];
  const isNewWorkspace = Boolean(data && data.projects.length === 0 && data.tasks.length === 0 && data.ideas.length === 0);

  return <div className="app-shell">
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sidebar-brand"><Link href="/overview" aria-label="Folio overview" onClick={() => setMobileOpen(false)}><Logo/></Link><button className="icon-button sidebar-mobile-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={20}/></button><span className="personal-label">PERSONAL</span></div>
      <div className="workspace-switcher-wrap"><button className="workspace-switcher" onClick={() => setPopover(popover === "workspace" ? null : "workspace")} aria-expanded={popover === "workspace"}><span className="workspace-letter">{(firstName[0] || "F").toUpperCase()}</span><span>My workspace<small>A space to make things happen</small></span><ChevronsUpDown size={14}/></button>{popover === "workspace" && <><button className="menu-dismiss" aria-label="Close workspace menu" onClick={() => setPopover(null)}/><div className="dropdown-menu workspace-dropdown"><div className="menu-caption">YOUR WORKSPACE</div><button onClick={() => navigate("overview")}><LayoutDashboard size={15}/>Personal workspace<Check size={14} className="menu-check"/></button><button onClick={() => navigate("settings")}><Settings size={15}/>Workspace settings</button></div></>}</div>
      <div className="nav-group-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">{NAV_ITEMS.map(item => <Link href={`/${item.view}`} key={item.view} className={`nav-item ${view === item.view ? "active" : ""}`} aria-current={view === item.view ? "page" : undefined} onClick={() => { setMobileOpen(false); setPopover(null); }}><item.icon size={18} strokeWidth={1.65}/><span>{item.label}</span>{item.view === "projects" && !!data?.projects.length && <span className="nav-count">{data.projects.length}</span>}{item.view === "tasks" && taskCount > 0 && <span className="nav-count">{taskCount}</span>}{item.view === "ideas" && !!data?.ideas.length && <span className="nav-new-dot"/>}</Link>)}</nav>
      <div className="sidebar-divider"/>
      <div className="nav-group-label favorites-label">FAVORITES<button className="icon-button" aria-label="Create a favorite project" onClick={() => openEditor({ kind: "projects", defaults: { favorite: true } })}><Plus size={15}/></button></div><div className="favorites-list">{data?.projects.filter(project => project.favorite).slice(0, 6).map(project => <button key={project.id} onClick={() => { setSelectedProject(project.id); setMobileOpen(false); }}><span className={`favorite-dot dot-${project.color}`}/><span>{project.name}</span></button>)}{data && !data.projects.some(project => project.favorite) && <p className="favorites-empty">Star a project to keep it close.</p>}{!data && <><div className="skeleton favorite-skeleton"/><div className="skeleton favorite-skeleton"/></>}</div>
      <div className="sidebar-bottom"><Link href="/settings" className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setMobileOpen(false)}><Settings size={18} strokeWidth={1.6}/><span>Settings</span></Link><button className="nav-item help-nav" onClick={() => { setHelpOpen(true); setMobileOpen(false); }}><CircleHelp size={18} strokeWidth={1.6}/><span>Help & shortcuts</span><ArrowUpRight size={14}/></button><div className="sidebar-note"><span className="note-sparkle">✳</span><strong>A little space. Big possibilities.</strong><p>Capture an idea while it’s fresh. Give it a home, then give it a plan.</p><button onClick={() => openEditor({ kind: "ideas" })}>Capture an idea<ArrowUpRight size={15}/></button></div><div className="sidebar-profile-wrap"><button className="sidebar-profile" onClick={() => setPopover(popover === "profile" ? null : "profile")} aria-expanded={popover === "profile"}><Avatar name={data?.user.name || "You"}/><span><strong>{data?.user.name || "Your workspace"}</strong><small>{PROVIDER_LABELS[data?.user.provider || "email"] || "Personal account"}</small></span><ChevronsUpDown size={14}/></button>{popover === "profile" && <><button className="menu-dismiss" aria-label="Close account menu" onClick={() => setPopover(null)}/><div className="dropdown-menu profile-dropdown"><div className="menu-caption">{data?.user.email || "SIGNED IN"}</div><button onClick={() => navigate("settings")}><UserRound size={15}/>Account settings</button><button onClick={() => { void signOut(); }} disabled={signingOut}><LogOut size={15}/>{signingOut ? "Signing out…" : "Sign out"}</button></div></>}</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21}/></button><PanelLeft size={17} className="breadcrumb-icon"/><div className="breadcrumbs"><button onClick={() => navigate("overview")}>My workspace</button><ChevronRight size={13}/><span>{VIEW_NAMES[view]}</span></div></div><div className="topbar-right"><button className="global-search" onClick={() => { setSearch(""); setSearchOpen(true); }}><Search size={16}/><span>Search anything…</span><kbd>⌘ K</kbd></button><button className="icon-button top-help" aria-label="Help and keyboard shortcuts" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/></button><div className="notifications-wrap"><button className={`icon-button notification-button ${popover === "notifications" ? "is-open" : ""}`} aria-label="Notifications" aria-expanded={popover === "notifications"} onClick={() => { setPopover(popover === "notifications" ? null : "notifications"); setNotificationsSeen(true); }}><Bell size={18}/>{!notificationsSeen && !isNewWorkspace && <i/>}</button>{popover === "notifications" && <><button className="menu-dismiss" aria-label="Close notifications" onClick={() => setPopover(null)}/><div className="notification-popover"><div className="notification-title"><h3>The little things, lately</h3><button className="icon-button" aria-label="Close notifications" onClick={() => setPopover(null)}><X size={16}/></button></div><p className="notification-subtitle">A little update from your workspace.</p>{data?.activities.length ? data.activities.slice(0, 4).map(activity => <div className="notification-item" key={activity.id}><span className={`activity-icon color-${activity.type === "idea" ? "yellow" : "violet"}`}>{activity.type === "idea" ? <Lightbulb size={15}/> : <CircleCheck size={15}/>}</span><span>{activity.text}<small>{new Date(activity.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></span></div>) : <div className="notification-empty"><Sparkles size={20}/><p>Nothing has happened yet—and that’s a lovely place to start. Create a project or capture an idea.</p></div>}<button className="notification-footer" onClick={() => navigate("ideas")}>Capture something new <ArrowRight size={14}/></button></div></>}</div><span className="topbar-divider"/><button className="top-avatar plain-button" aria-label="Open account settings" onClick={() => navigate("settings")}><Avatar name={data?.user.name || "You"}/></button></div></header>
      <main className={`main-content view-${view}`}>
<<<<<<< Updated upstream
        <div className="page-heading"><div><h1>{pageTitle}{view === "overview" && <Sun className="greeting-sun" size={27} strokeWidth={1.6}/>}</h1><p>{VIEW_SUBTITLES[view]}</p></div><div className="page-heading-actions">{view === "overview" && <span className="today-date"><CalendarDays size={14}/>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" })}</span>}{view !== "settings" && <button className="button primary new-resource-button" disabled={!data} onClick={() => openEditor({ kind: view === "ideas" ? "ideas" : view === "tasks" || view === "calendar" ? "tasks" : "projects", defaults: view === "calendar" ? { dueDate: dateKey() } : undefined })}><Plus size={16}/>{view === "ideas" ? "Capture an idea" : view === "tasks" || view === "calendar" ? "New task" : "New project"}</button>}</div></div>
        {!data ? error ? <div className="panel error-panel"><EmptyState title="Let’s try that again" description={error} action="Reload workspace" onAction={() => { void reload().catch(() => {}); }}/></div> : <DashboardSkeleton/> : actions && <>{view === "overview" && (isNewWorkspace ? <WelcomeStart actions={actions} onSignOut={() => { void signOut(); }}/> : <OverviewPanel actions={actions}/>)} {view === "projects" && <ProjectsPanel actions={actions}/>} {view === "tasks" && <TasksPanel actions={actions}/>} {view === "ideas" && <IdeasPanel actions={actions}/>} {view === "calendar" && <CalendarPanel actions={actions}/>} {view === "settings" && <SettingsPanel key={data.user.id} data={data} onSave={saveSettings} onSignOut={() => { void signOut(); }}/>}</>}
=======
        {view !== "overview" && view !== "projects" && view !== "tasks" && view !== "ai" && <div className="page-heading"><div><h1>{pageTitle}</h1><p>{VIEW_SUBTITLES[view]}</p></div><div className="page-heading-actions">{view !== "settings" && <button className="button primary new-resource-button" disabled={!data} onClick={() => openEditor({ kind: view === "ideas" ? "ideas" : view === "calendar" ? "tasks" : "projects", defaults: view === "calendar" ? { dueDate: dateKey() } : undefined })}><Plus size={16}/>{view === "ideas" ? "Capture an idea" : view === "calendar" ? "New task" : "New project"}</button>}</div></div>}
        {!data ? error ? view === "projects" ? <ProjectsError message={error} onRetry={() => { void reload().catch(() => {}); }}/> : view === "tasks" ? <TasksError message={error} onRetry={() => { void reload().catch(() => {}); }}/> : <div className="panel error-panel"><EmptyState title="Let’s try that again" description={error} action="Reload workspace" onAction={() => { void reload().catch(() => {}); }}/></div> : view === "projects" ? <ProjectsSkeleton/> : view === "tasks" ? <TasksSkeleton/> : <DashboardSkeleton/> : actions && <>{view === "overview" && (isNewWorkspace ? <WelcomeStart actions={actions} onSignOut={() => { void signOut(); }}/> : <OverviewPanel actions={actions} onReload={() => { void reload().catch(() => {}); }}/>)} {view === "projects" && (routeProjectId ? (routeProject ? <ProjectWorkspace key={routeProject.id} project={routeProject} actions={actions} onBack={() => navigate("projects")}/> : <ProjectNotFound onBack={() => navigate("projects")}/>) : <ProjectsPanel actions={actions}/>)} {view === "tasks" && <TasksPanel actions={actions}/>} {view === "ideas" && <IdeasPanel actions={actions}/>} {view === "calendar" && <CalendarPanel actions={actions} focusEvent={calendarFocus} onFocusHandled={(found) => { setCalendarFocus(null); if (!found) notify("That calendar event is no longer available.", "error"); }}/>} {view === "ai" && <FolioAIPanel key={data.user.id}/>} {view === "settings" && <SettingsPanel key={data.user.id} data={data} onSave={saveSettings} onSignOut={() => { void signOut(); }} notifications={notifications} notify={notify} focusSectionNonce={settingsFocusNonce}/>}</>}
        {children}
>>>>>>> Stashed changes
        <footer className="workspace-footer"><span><span className="footer-spark">✳</span>A little more organized. A little more you.</span><span className="save-status">{pending.size > 0 ? <><Spinner size={12}/>Saving your progress…</> : data ? <><span className="tiny-dot"/>All changes saved</> : <><Spinner size={12}/>Getting things ready…</>}</span></footer>
      </main>
    </div>
    {currentProject && actions && !editor && !confirmation && !searchOpen && !helpOpen && <Modal title={currentProject.name} subtitle="YOUR PROJECT, ONE SMALL STEP AT A TIME" onClose={() => setSelectedProject(null)} className="project-drawer"><ProjectDetails project={currentProject} actions={actions}/></Modal>}
    {editor && data && <ResourceEditor key={`${editor.kind}-${editor.item?.id || "new"}`} editor={editor} projects={data.projects} onClose={() => setEditor(null)} onSave={async (kind, values, id) => { await mutate(kind, id ? "PATCH" : "POST", values, id); }} onDelete={deleteItem}/>}
    {confirmation && <Modal title={confirmation.action === "convert" ? "Give that idea a little momentum." : `Delete this ${confirmation.kind.slice(0, -1)}?`} onClose={() => { if (!confirmBusy) setConfirmation(null); }} className="confirm-modal"><div className={`confirm-icon ${confirmation.action === "convert" ? "color-violet" : ""}`}>{confirmation.action === "convert" ? <Sparkles size={25}/> : <Trash2Icon/>}</div><h3>{"name" in confirmation.item ? confirmation.item.name : confirmation.item.title}</h3><p>{confirmation.action === "convert" ? "We’ll turn this idea into a new project, keeping its name, notes, and color. It will move from your idea board to Projects, ready for its first task." : confirmation.kind === "projects" ? "This project will be permanently deleted. Its tasks will stay safe in My tasks as personal tasks. This can’t be undone." : "This will be permanently removed from your workspace. This can’t be undone."}</p>{confirmError && <div className="form-error" role="alert">{confirmError}</div>}<div className="modal-footer"><button className="button secondary" disabled={confirmBusy} onClick={() => setConfirmation(null)}>Keep it for now</button><button className={`button ${confirmation.action === "convert" ? "primary" : "danger"}`} disabled={confirmBusy} onClick={() => { void confirmAction(); }}>{confirmBusy ? <Spinner/> : confirmation.action === "convert" ? <ArrowUpRight size={16}/> : <Trash2Icon/>} {confirmation.action === "convert" ? "Make it a project" : "Yes, delete it"}</button></div></Modal>}
    {searchOpen && <Modal title="Find your next step" onClose={() => setSearchOpen(false)} className="search-modal"><div className="command-input"><Search size={21}/><input autoFocus placeholder="Search projects, tasks, and ideas…" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search entire workspace"/><kbd>esc</kbd></div><div className="search-results">{searchProjects.length > 0 && <div className="search-group"><h3>Projects <span>{searchProjects.length}</span></h3>{searchProjects.map(project => <button key={project.id} onClick={() => { setSearchOpen(false); setSelectedProject(project.id); }}><ProjectIcon color={project.color} icon={project.icon} small/><span>{project.name}<small>{project.status}</small></span><ArrowUpRight size={15}/></button>)}</div>}{searchTasks.length > 0 && <div className="search-group"><h3>Tasks <span>{searchTasks.length}</span></h3>{searchTasks.map(task => <button key={task.id} onClick={() => { setSearchOpen(false); openEditor({ kind: "tasks", item: task }); }}><span className="search-result-icon"><SquareCheckBig size={17}/></span><span>{task.title}<small>{task.completed ? "Completed" : "To do"}</small></span><ArrowUpRight size={15}/></button>)}</div>}{searchIdeas.length > 0 && <div className="search-group"><h3>Ideas <span>{searchIdeas.length}</span></h3>{searchIdeas.map(idea => <button key={idea.id} onClick={() => { setSearchOpen(false); openEditor({ kind: "ideas", item: idea }); }}><span className={`search-result-icon color-${idea.color}`}><Lightbulb size={17}/></span><span>{idea.title}<small>{idea.category}</small></span><ArrowUpRight size={15}/></button>)}</div>}{!searchProjects.length && !searchTasks.length && !searchIdeas.length && <EmptyState title={isNewWorkspace ? "Nothing here just yet" : "Not quite here yet"} description={isNewWorkspace ? "Your workspace starts empty, on purpose. Create your first project or capture an idea, then search will have something lovely to find." : "Try a different word, or turn that thought into something new."}/>}</div><div className="search-footer"><span><Command size={13}/> Your whole workspace, a little closer.</span><span><kbd>esc</kbd> to close</span></div></Modal>}
    {helpOpen && <Modal title="A little help, when you need it." subtitle="Less clicking. More making things happen." onClose={() => setHelpOpen(false)} className="help-modal"><div className="help-tip"><Sparkles size={21}/><p>Start with a project, break it into small tasks, and capture the ideas that come along. There’s no perfect way to get organized—just your way.</p></div><h3>Little shortcuts</h3><div className="shortcut-list">{[["Search your whole workspace", "⌘ / Ctrl", "K"], ["Start a new project", "N"], ["Add a task", "T"], ["Capture an idea", "I"], ["Open this little guide", "?"], ["Close a dialog", "Esc"]].map(([label, ...keys]) => <div key={label}><span>{label}</span><span>{keys.map(key => <kbd key={key}>{key}</kbd>)}</span></div>)}</div><div className="help-note"><CircleCheck size={18}/><p><strong>One less thing to think about.</strong> Your changes save automatically. Star projects to keep them close, and turn ideas into projects whenever you’re ready.</p></div><button className="button primary full-width" onClick={() => setHelpOpen(false)}>Got it. Let’s make things happen <ArrowRight size={16}/></button></Modal>}
    {toast && <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.tone === "success" ? <CircleCheck size={18}/> : <CircleHelp size={18}/>}<span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16}/></button></div>}
  </div>;
}

function Trash2Icon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>; }

function WelcomeStart({ actions, onSignOut }: { actions: WorkspaceActions; onSignOut: () => void }) {
  const firstName = actions.data.user.name.split(" ")[0] || "there";
  const steps = [
    { done: actions.data.projects.length > 0, label: "Create your first project", detail: "Give the big thing a name and a little context.", action: () => actions.openEditor({ kind: "projects" }), button: "New project" },
    { done: actions.data.tasks.length > 0, label: "Add one small next step", detail: "A task you could finish today beats a perfect plan.", action: () => actions.openEditor({ kind: "tasks" }), button: "Add a task" },
    { done: actions.data.ideas.length > 0, label: "Capture something for later", detail: "Park the “what ifs” on your idea board, guilt-free.", action: () => actions.openEditor({ kind: "ideas" }), button: "Capture an idea" },
  ];
  return <div className="welcome-start">
    <section className="welcome-start-hero">
      <div className="welcome-start-copy">
        <span className="eyebrow">YOUR WORKSPACE IS READY</span>
        <h2>Hello, {firstName}.<br/>Let’s make something <em>yours</em>.</h2>
        <p>This space starts completely empty, just as it should be. No starter projects, no clutter—only what you decide belongs here.</p>
        <div className="welcome-start-actions">
          <button className="button primary" onClick={() => actions.openEditor({ kind: "projects" })}><Plus size={16}/>Create your first project</button>
          <button className="button secondary" onClick={() => actions.openEditor({ kind: "ideas" })}><Lightbulb size={16}/>Capture an idea</button>
        </div>
        <p className="welcome-start-note">Everything you create is private, saved automatically, and available whenever you sign back in.</p>
      </div>
      <div className="welcome-start-art" aria-hidden="true">
        <div className="start-art-card art-back"><span className="start-art-icon"><Lightbulb size={17}/></span><strong>A someday idea</strong><p>Saved for the right moment.</p></div>
        <div className="start-art-card art-front"><span className="start-art-icon violet"><FolderKanban size={17}/></span><strong>Your first project</strong><p>Progress starts with one task.</p><div className="start-art-progress"><span/></div></div>
        <span className="start-art-star">✳</span>
      </div>
    </section>
    <section className="panel welcome-steps">
      <div className="welcome-steps-heading"><h2>Three gentle ways to begin</h2><span>Nothing here is permanent. Rename, reshape, or remove anything later.</span></div>
      <ol>{steps.map((step, index) => <li key={step.label} className={step.done ? "step-done" : ""}><span className="step-number">{step.done ? <Check size={14}/> : index + 1}</span><div><strong>{step.label}</strong><p>{step.detail}</p></div><button className="button secondary small-button" onClick={step.action}>{step.button}<ArrowRight size={13}/></button></li>)}</ol>
    </section>
    <div className="welcome-start-grid">
      <section className="panel welcome-tip"><span className="welcome-tip-icon color-green"><SquareCheckBig size={18}/></span><div><h3>Keep the list honest</h3><p>Three real priorities are worth more than fifteen maybes. Your weekly focus is set to {actions.data.user.weeklyGoal} tasks—adjust it any time in Settings.</p><button className="text-link" onClick={() => actions.navigate("settings")}>Tune your weekly goal <ArrowUpRight size={13}/></button></div></section>
      <section className="panel welcome-tip"><span className="welcome-tip-icon color-yellow"><Sparkles size={18}/></span><div><h3>Ideas don’t need a plan yet</h3><p>Jot the thought down before it disappears. When it feels ready, one click turns an idea into a project with a home of its own.</p><button className="text-link" onClick={() => actions.openEditor({ kind: "ideas" })}>Capture a thought <ArrowUpRight size={13}/></button></div></section>
      <section className="panel welcome-tip"><span className="welcome-tip-icon color-blue"><UserRound size={18}/></span><div><h3>Your account, your work</h3><p>You’re signed in as {actions.data.user.name}. Export everything from Settings, or sign out safely at any time.</p><button className="text-link" onClick={onSignOut}>Sign out of folio <ArrowUpRight size={13}/></button></div></section>
    </div>
  </div>;
}

function DashboardSkeleton() { return <div className="dashboard-skeleton" aria-label="Loading your workspace" role="status"><div className="skeleton skeleton-banner"/><div className="skeleton-stat-grid">{Array.from({ length: 4 }).map((_, index) => <div className="skeleton skeleton-stat" key={index}/>)}</div><div className="skeleton skeleton-section-heading"/><div className="skeleton-project-grid">{Array.from({ length: 3 }).map((_, index) => <div className="skeleton skeleton-project" key={index}/>)}</div><span className="sr-only">Getting your projects and possibilities ready…</span></div>; }
