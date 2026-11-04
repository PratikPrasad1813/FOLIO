"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, Columns3, Download, Ellipsis, Flag, FolderKanban, Grid2X2, LayoutList, Lightbulb, ListTodo, Pencil, Plus, Search, Settings2, Sparkles, Star, Target, Trash2, TrendingUp } from "lucide-react";
import { dateKey, formatDate, IDEA_STATUSES, projectProgress, type Idea, type Item, type Project, type Resource, type Task, type User, type View, type WorkspaceData } from "@/lib/types";
import { Avatar, EmptyState, MomentumArt, ProjectIcon, Spinner, Status } from "@/components/ui";
import type { EditorState } from "@/components/editors";
<<<<<<< Updated upstream
=======
import type { BulkResult, MutateOptions } from "@/lib/use-workspace";
import { TaskCalendar, type CalendarFocusEvent } from "@/components/task-calendar";
import { GoogleCalendarCard, useGoogleIntegration } from "@/components/integrations/google";
import { ProfileSettings } from "@/components/profile-settings";
import { NotificationSettingsSection } from "@/components/notification-settings";
import type { NotificationsController } from "@/lib/use-notifications";
import { DangerZoneSection } from "@/components/danger-zone";
>>>>>>> Stashed changes

export interface WorkspaceActions {
  data: WorkspaceData;
  openEditor: (editor: EditorState) => void;
  openProject: (id: string) => void;
  mutate: (kind: Resource, method: "POST" | "PATCH" | "DELETE", values?: Record<string, unknown>, id?: string) => Promise<Item>;
  deleteItem: (kind: Resource, item: Item) => void;
  convertIdea: (idea: Idea) => void;
  navigate: (view: View) => void;
  pending: Set<string>;
}

export function ProjectCard({ project, actions }: { project: Project; actions: WorkspaceActions }) {
  const [menu, setMenu] = useState(false);
  const progress = projectProgress(project.id, actions.data.tasks);
  return <article className="project-card">
    <div className="project-card-top"><button className="plain-button" aria-label={`Open ${project.name}`} onClick={() => actions.openProject(project.id)}><ProjectIcon icon={project.icon} color={project.color}/></button><div className="project-card-top-right">{project.favorite && <Star size={13} className="favorite-indicator" fill="currentColor"/>}<button className="icon-button" aria-label={`Options for ${project.name}`} aria-expanded={menu} onClick={() => setMenu(!menu)}><Ellipsis size={20}/></button>{menu && <><button className="menu-dismiss" aria-label="Close project options" onClick={() => setMenu(false)}/><div className="dropdown-menu card-dropdown"><button onClick={() => { setMenu(false); actions.openProject(project.id); }}><FolderKanban size={15}/>Open project</button><button onClick={() => { setMenu(false); actions.openEditor({ kind: "projects", item: project }); }}><Pencil size={15}/>Edit project</button><button onClick={() => { setMenu(false); void actions.mutate("projects", "PATCH", { favorite: !project.favorite }, project.id).catch(() => {}); }}><Star size={15}/>{project.favorite ? "Remove from favorites" : "Add to favorites"}</button><div className="menu-divider"/><button className="danger-text" onClick={() => { setMenu(false); actions.deleteItem("projects", project); }}><Trash2 size={15}/>Delete project</button></div></>}</div></div>
    <button className="project-title" onClick={() => actions.openProject(project.id)}>{project.name}</button>
    <p className="project-description">{project.description || "A fresh start. Add a description and make this project your own."}</p>
    <div className="project-tags"><Status status={project.status}/><span className="category-tag">{project.category}</span></div>
    <div className="project-progress"><div><span>Progress</span><strong>{progress.percent}<span>%</span></strong></div><div className="progress-track"><span className={`progress-fill fill-${project.color}`} style={{ width: `${progress.percent}%` }}/></div></div>
    <div className="project-card-footer"><span className="project-due"><CalendarDays size={13}/>{project.dueDate ? formatDate(project.dueDate) : "No deadline"}</span><span className="task-fraction" title={`${progress.done} of ${progress.total} tasks completed`}><ListTodo size={14}/>{progress.done}/{progress.total}</span><Avatar name={actions.data.user.name} small/></div>
  </article>;
}

export function ProjectsPanel({ actions, overview = false }: { actions: WorkspaceActions; overview?: boolean }) {
  const [filter, setFilter] = useState("All projects");
  const [layout, setLayout] = useState("grid");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("All priorities");
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState("created");
  let projects = actions.data.projects.filter(project => (filter === "All projects" || project.status === filter) && (priority === "All priorities" || project.priority === priority) && `${project.name} ${project.description} ${project.category}`.toLowerCase().includes(query.toLowerCase()));
  if (sort === "name") projects = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "due") projects = [...projects].sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  if (sort === "recent") projects = [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visible = overview ? projects.slice(0, 3) : projects;
  return <section className={`projects-section ${overview ? "" : "standalone-projects"}`}>
    {overview && <div className="section-heading"><h2>Your projects <span className="count-badge">{actions.data.projects.length}</span></h2><button className="text-link" onClick={() => actions.navigate("projects")}>View all projects <ArrowRight size={15}/></button></div>}
    <div className="section-toolbar"><div className="tabs">{["All projects", "In progress", "Completed"].map(label => <button className={filter === label ? "active" : ""} key={label} onClick={() => setFilter(label)}>{label}<span>{label === "All projects" ? actions.data.projects.length : actions.data.projects.filter(project => project.status === label).length}</span></button>)}</div><div className="toolbar-actions"><button className={`button filter-button ${showFilters ? "filter-active" : ""}`} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}><Settings2 size={14}/><span>Filter</span>{priority !== "All priorities" && <i/>}</button><div className="view-switch"><button className={layout === "grid" ? "active" : ""} onClick={() => setLayout("grid")} aria-label="Grid view" aria-pressed={layout === "grid"}><Grid2X2 size={15}/></button><button className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")} aria-label="List view" aria-pressed={layout === "list"}><LayoutList size={16}/></button></div></div></div>
    {showFilters && <div className="filter-bar"><label className="input-with-icon"><Search size={16}/><input placeholder="Find a project…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search projects"/></label><select value={priority} onChange={event => setPriority(event.target.value)} aria-label="Filter by priority">{["All priorities", "High", "Medium", "Low"].map(value => <option key={value}>{value}</option>)}</select><select value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort projects"><option value="created">Date created</option><option value="recent">Newest first</option><option value="name">Name A–Z</option><option value="due">Due date</option></select><button className="text-link" onClick={() => { setQuery(""); setPriority("All priorities"); setSort("created"); setFilter("All projects"); }}>Reset</button></div>}
    {visible.length ? <div className={`project-grid ${layout === "list" ? "project-list" : ""}`}>{visible.map(project => <ProjectCard key={project.id} project={project} actions={actions}/>)}</div> : <div className="panel"><EmptyState title={actions.data.projects.length ? "A little room for what’s next" : "Your next big thing starts here"} description={actions.data.projects.length ? "No projects match these filters. Try another view, or start something new." : "Create your first project and turn a big goal into small, doable steps."} action="Create a project" onAction={() => actions.openEditor({ kind: "projects" })}/></div>}
    {!overview && visible.length > 0 && <button className="add-project-card" onClick={() => actions.openEditor({ kind: "projects" })}><Plus size={18}/>Make room for something new</button>}
  </section>;
}

export function TaskRow({ task, actions, compact = false }: { task: Task; actions: WorkspaceActions; compact?: boolean }) {
  const project = actions.data.projects.find(project => project.id === task.projectId);
  const today = dateKey();
  return <div className={`task-row ${task.completed ? "task-complete" : ""} ${compact ? "compact-task" : ""}`}>
    <button className={`task-checkbox ${task.completed ? "checked" : ""}`} role="checkbox" aria-checked={task.completed} aria-label={`${task.completed ? "Mark incomplete" : "Complete"}: ${task.title}`} disabled={actions.pending.has(task.id)} onClick={() => { void actions.mutate("tasks", "PATCH", { completed: !task.completed, completedAt: !task.completed ? new Date().toISOString() : null }, task.id).catch(() => {}); }}>{task.completed && <Check size={13} strokeWidth={2.5}/>}</button>
    <div className="task-title-area"><button className="task-title" onClick={() => actions.openEditor({ kind: "tasks", item: task })}>{task.title}</button>{compact && <span className="task-project-label"><i className={`dot-${project?.color || "gray"}`}/>{project?.name || "Personal task"}</span>}</div>
    {!compact && <button className="task-project-tag" onClick={() => project ? actions.openProject(project.id) : actions.openEditor({ kind: "tasks", item: task })}><i className={`dot-${project?.color || "gray"}`}/>{project?.name || "Personal"}</button>}
    <span className={`priority priority-${task.priority.toLowerCase()}`}><Flag size={12}/>{task.priority}</span>
    <span className={`task-due ${task.dueDate === today ? "due-today" : task.dueDate && task.dueDate < today && !task.completed ? "overdue" : ""}`}>{task.dueDate === today ? "Today" : formatDate(task.dueDate)}</span>
    {!compact && <button className="icon-button task-edit" aria-label={`Edit ${task.title}`} onClick={() => actions.openEditor({ kind: "tasks", item: task })}><Ellipsis size={18}/></button>}
  </div>;
}

export function TasksPanel({ actions, overview = false, projectId }: { actions: WorkspaceActions; overview?: boolean; projectId?: string }) {
  const [filter, setFilter] = useState(overview ? "Today" : "To do");
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [priority, setPriority] = useState("");
  const today = dateKey();
  const base = actions.data.tasks.filter(task => !projectId || task.projectId === projectId);
  const matches = (task: Task, value: string) => value === "Completed" ? task.completed : value === "All tasks" ? true : value === "Today" ? !task.completed && !!task.dueDate && task.dueDate <= today : value === "Upcoming" ? !task.completed && !!task.dueDate && task.dueDate > today : !task.completed;
  const list = base.filter(task => matches(task, filter) && task.title.toLowerCase().includes(query.toLowerCase()) && (!projectFilter || task.projectId === projectFilter) && (!priority || task.priority === priority)).sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const visible = overview ? list.slice(0, 4) : list;
  const tabs = overview ? ["Today", "Upcoming"] : ["To do", "Today", "Completed", "All tasks"];
  return <section className={`panel tasks-panel ${overview ? "overview-tasks" : ""} ${projectId ? "project-tasks-panel" : ""}`}>
    {overview && <div className="panel-heading"><h2>On your list <span className="small-spark">✳</span></h2><button className="text-link" onClick={() => actions.navigate("tasks")}>View all tasks <ArrowRight size={14}/></button></div>}
    <div className="task-toolbar"><div className="tabs">{tabs.map(value => <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{value}<span>{base.filter(task => matches(task, value)).length}</span></button>)}</div>{!overview && <button className="icon-button" aria-label="Add a task" onClick={() => actions.openEditor({ kind: "tasks", defaults: { projectId } })}><Plus size={18}/></button>}</div>
    {!overview && !projectId && <div className="filter-bar task-filters"><label className="input-with-icon"><Search size={16}/><input placeholder="Find a task…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search tasks"/></label><select value={projectFilter} onChange={event => setProjectFilter(event.target.value)} aria-label="Filter tasks by project"><option value="">All projects</option>{actions.data.projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select><select value={priority} onChange={event => setPriority(event.target.value)} aria-label="Filter tasks by priority"><option value="">All priorities</option>{["High", "Medium", "Low"].map(value => <option key={value}>{value}</option>)}</select></div>}
    {!overview && !projectId && visible.length > 0 && <div className="task-table-heading"><span/><span>Task name</span><span>Project</span><span>Priority</span><span>Due date <ArrowDown size={11}/></span><span/></div>}
    <div className="task-list">{visible.length ? visible.map(task => <TaskRow key={task.id} task={task} actions={actions} compact={overview || !!projectId}/>) : <EmptyState icon="task" title={filter === "Today" ? "A little breathing room" : filter === "Completed" ? "Your progress will live here" : "A fresh start"} description={filter === "Today" ? "Nothing left on today’s list. Enjoy the space, or plan your next small step." : "No tasks here yet. Add something small and start making progress."}/>}</div>
    <button className="add-task-row" onClick={() => actions.openEditor({ kind: "tasks", defaults: { projectId, dueDate: filter === "Today" ? today : null } })}><Plus size={15}/>Add a task<span>One small step at a time</span></button>
  </section>;
}

function timeAgo(date: string) { const minutes = Math.floor((Date.now() - new Date(date).getTime()) / 60000); return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} hr ago` : `${Math.floor(minutes / 1440)}d ago`; }

export function OverviewPanel({ actions }: { actions: WorkspaceActions }) {
  const { data } = actions;
  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekDone = data.tasks.filter(task => task.completed && task.completedAt && new Date(task.completedAt) >= weekStart).length;
  const weeklyPercent = Math.min(100, Math.round(weekDone / data.user.weeklyGoal * 100));
  const stats = [
    { label: "Total projects", value: data.projects.length, icon: FolderKanban, color: "violet", note: "A little bit of everything", view: "projects" as View },
    { label: "In progress", value: data.projects.filter(project => project.status === "In progress").length, icon: CircleDashed, color: "peach", note: "Good things in the making", view: "projects" as View },
    { label: "Tasks completed", value: data.tasks.filter(task => task.completed).length, icon: CircleCheck, color: "green", note: `${weekDone} completed this week`, view: "tasks" as View },
    { label: "Ideas captured", value: data.ideas.length, icon: Lightbulb, color: "yellow", note: "Possibilities worth exploring", view: "ideas" as View },
  ];
  return <>
    <div className="welcome-grid"><section className="welcome-banner"><div className="welcome-copy"><span className="eyebrow">A LITTLE CLARITY. A LOT OF POSSIBILITY.</span><h2>Big ideas meet<br/>everyday progress.</h2><p>You’ve got the vision. Let’s make room for it.</p><button className="banner-link" onClick={() => actions.openEditor({ kind: "ideas" })}>Capture a new idea <ArrowUpRight size={16}/></button></div><MomentumArt/></section><section className="panel weekly-card"><div className="weekly-heading"><span><Target size={15}/>Weekly focus</span><button className="icon-button" aria-label="Adjust your weekly goal" onClick={() => actions.navigate("settings")}><ArrowUpRight size={16}/></button></div><div className="weekly-body"><div className="progress-ring"><svg width="79" height="79" viewBox="0 0 80 80"><circle cx="40" cy="40" r="33" fill="none" stroke="#EFEDF4" strokeWidth="6"/><circle cx="40" cy="40" r="33" fill="none" stroke="#A496D4" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${weeklyPercent * 2.073} 207.3`} transform="rotate(-90 40 40)"/></svg><strong>{weeklyPercent}<span>%</span></strong></div><div><strong>{weekDone}<span> / {data.user.weeklyGoal}</span></strong><p>tasks completed</p><span className="weekly-encouragement">{weeklyPercent >= 100 ? "You did it. Nice work!" : "One step closer ✨"}</span></div></div><div className="weekly-bottom"><span className="tiny-dot"/>A little progress, every day.</div></section></div>
    <div className="stats-grid">{stats.map(stat => <button className="stat-card" key={stat.label} onClick={() => actions.navigate(stat.view)}><div className="stat-top"><span>{stat.label}</span><span className={`stat-icon color-${stat.color}`}><stat.icon size={17} strokeWidth={1.7}/></span></div><div className="stat-bottom"><strong>{stat.value.toString().padStart(2, "0")}</strong><span className={stat.color === "green" ? "positive" : ""}>{stat.color === "green" && <TrendingUp size={12}/>} {stat.note}</span></div></button>)}</div>
    <ProjectsPanel actions={actions} overview/>
    <div className="overview-bottom-grid"><TasksPanel actions={actions} overview/><section className="panel activity-panel"><div className="panel-heading"><h2>Around your workspace</h2><span className="activity-live"><i/>Live</span></div><div className="activity-list">{data.activities.length ? data.activities.slice(0, 4).map(activity => { const Icon = activity.type === "task" || activity.type === "complete" ? CheckCheck : activity.type === "idea" ? Lightbulb : FolderKanban; return <div className="activity-item" key={activity.id}><div className={`activity-icon color-${activity.type === "idea" ? "yellow" : activity.type === "task" || activity.type === "complete" ? "green" : "violet"}`}><Icon size={14}/></div><div><p>{activity.text}</p><span>{timeAgo(activity.createdAt)}</span></div></div>; }) : <p className="quiet-text">Your story starts here. Create something, and we’ll keep track of the little wins.</p>}</div><div className="activity-footer"><Sparkles size={15}/><span>Good things are taking shape.</span></div></section></div>
  </>;
}

export function IdeasPanel({ actions }: { actions: WorkspaceActions }) {
  const [filter, setFilter] = useState("All ideas");
  const [board, setBoard] = useState(false);
  const [query, setQuery] = useState("");
  const [dragOver, setDragOver] = useState("");
  const filtered = actions.data.ideas.filter(idea => (filter === "All ideas" || idea.status === filter) && `${idea.title} ${idea.description}`.toLowerCase().includes(query.toLowerCase()));
  const renderCard = (idea: Idea) => <article className={`idea-card idea-${idea.color}`} key={idea.id} draggable={board} onDragStart={event => event.dataTransfer.setData("text/plain", idea.id)}><div className="idea-card-top"><span className="idea-bulb"><Lightbulb size={19} strokeWidth={1.5}/></span><span className="idea-stage">{idea.status}</span><button className="icon-button" aria-label={`Edit ${idea.title}`} onClick={() => actions.openEditor({ kind: "ideas", item: idea })}><Ellipsis size={18}/></button></div><button className="idea-title" onClick={() => actions.openEditor({ kind: "ideas", item: idea })}>{idea.title}</button><p>{idea.description || "A little possibility, waiting to be explored. Add your thoughts and see where it takes you."}</p><div className="idea-card-meta"><span>{idea.category}</span><span>{new Date(idea.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div><div className="idea-card-bottom"><button onClick={() => actions.convertIdea(idea)} disabled={actions.pending.has(idea.id)}>Make it a project <ArrowUpRight size={14}/></button><button className="icon-button" aria-label={`Delete ${idea.title}`} onClick={() => actions.deleteItem("ideas", idea)}><Trash2 size={14}/></button></div></article>;
  return <section className="ideas-section"><div className="idea-intro"><span className="idea-intro-icon"><Sparkles size={21}/></span><p>A home for your <strong>someday</strong>, your <strong>what if</strong>, and your <strong>why not</strong>.<br/><span>Capture it now. Figure out the details later.</span></p><span className="handdrawn-star">✳</span></div><div className="section-toolbar"><div className="tabs">{["All ideas", ...IDEA_STATUSES].map(value => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}<span>{actions.data.ideas.filter(idea => value === "All ideas" || idea.status === value).length}</span></button>)}</div><div className="view-switch"><button className={!board ? "active" : ""} aria-label="Idea grid view" onClick={() => setBoard(false)}><Grid2X2 size={16}/></button><button className={board ? "active" : ""} aria-label="Idea board view" onClick={() => setBoard(true)}><Columns3 size={16}/></button></div></div><label className="input-with-icon idea-search"><Search size={16}/><input value={query} placeholder="Find a little inspiration…" aria-label="Search ideas" onChange={event => setQuery(event.target.value)}/></label>{board ? <><p className="board-hint">Drag an idea to move it forward—or edit its stage.</p><div className="idea-board">{IDEA_STATUSES.map(stage => <div className={`idea-column ${dragOver === stage ? "drag-over" : ""}`} key={stage} onDragOver={event => { event.preventDefault(); setDragOver(stage); }} onDragLeave={() => setDragOver("")} onDrop={event => { event.preventDefault(); setDragOver(""); const id = event.dataTransfer.getData("text/plain"); if (actions.data.ideas.some(idea => idea.id === id)) void actions.mutate("ideas", "PATCH", { status: stage }, id).catch(() => {}); }}><div className="idea-column-heading"><h3><span className={`stage-dot stage-${IDEA_STATUSES.indexOf(stage)}`}/>{stage}<span>{filtered.filter(idea => idea.status === stage).length}</span></h3><button className="icon-button" aria-label={`Add idea to ${stage}`} onClick={() => actions.openEditor({ kind: "ideas", defaults: { status: stage } })}><Plus size={16}/></button></div>{filtered.filter(idea => idea.status === stage).map(renderCard)}<button className="add-idea-column" onClick={() => actions.openEditor({ kind: "ideas", defaults: { status: stage } })}><Plus size={16}/>A new possibility</button></div>)}</div></> : filtered.length ? <div className="ideas-grid">{filtered.map(renderCard)}<button className="new-idea-card" onClick={() => actions.openEditor({ kind: "ideas" })}><span><Plus size={24}/></span><strong>There’s room for another idea.</strong><p>What’s on your mind?</p></button></div> : <div className="panel"><EmptyState icon="idea" title="Leave a little room for possibility" description="No ideas here yet. A rough thought is all it takes to get started." action="Capture an idea" onAction={() => actions.openEditor({ kind: "ideas" })}/></div>}</section>;
}

export function CalendarPanel({ actions }: { actions: WorkspaceActions }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(dateKey());
  const [show, setShow] = useState("all");
  const cells = useMemo(() => { const first = new Date(month.getFullYear(), month.getMonth(), 1); const offset = (first.getDay() + 6) % 7; return Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - offset + i)); }, [month]);
  const dueProjects = actions.data.projects.filter(project => project.dueDate === selected && show !== "tasks");
  const dueTasks = actions.data.tasks.filter(task => task.dueDate === selected && !task.completed && show !== "projects");
  return <div className="calendar-layout"><section className="panel calendar-panel"><div className="calendar-toolbar"><h2>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2><div className="calendar-controls"><select aria-label="Calendar events" value={show} onChange={event => setShow(event.target.value)}><option value="all">All events</option><option value="projects">Project deadlines</option><option value="tasks">Tasks</option></select><button className="button secondary small-button" onClick={() => { setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); setSelected(dateKey()); }}>Today</button><button className="icon-button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17}/></button><button className="icon-button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17}/></button></div></div><div className="calendar-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map(day => { const key = dateKey(day); const projects = actions.data.projects.filter(project => project.dueDate === key && show !== "tasks"); const tasks = actions.data.tasks.filter(task => task.dueDate === key && !task.completed && show !== "projects"); const events = [...projects.map(project => ({ id: project.id, title: project.name, color: project.color, kind: "project" })), ...tasks.map(task => ({ id: task.id, title: task.title, color: actions.data.projects.find(project => project.id === task.projectId)?.color || "violet", kind: "task" }))]; return <div key={key} className={`calendar-day ${day.getMonth() !== month.getMonth() ? "other-month" : ""} ${key === selected ? "selected-day" : ""}`} role="button" tabIndex={0} aria-label={`${formatDate(key, { weekday: "long", month: "long", day: "numeric" })}, ${events.length} events`} onClick={() => setSelected(key)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(key); } }}><span className={`day-number ${key === dateKey() ? "is-today" : ""}`}>{day.getDate()}</span>{events.slice(0, 2).map(item => <button key={item.id} className={`calendar-event color-${item.color}`} onClick={event => { event.stopPropagation(); setSelected(key); if (item.kind === "project") actions.openProject(item.id); else { const task = actions.data.tasks.find(task => task.id === item.id); if (task) actions.openEditor({ kind: "tasks", item: task }); } }}><span/>{item.title}</button>)}{events.length > 2 && <span className="calendar-more">+{events.length - 2} more</span>}</div>; })}</div><div className="calendar-legend"><span><i className="dot-violet"/>Project deadlines & tasks</span><span>Click a day to see what’s ahead</span></div></section><aside className="panel schedule-panel"><span className="eyebrow">A LITTLE LOOK AHEAD</span><h2>{formatDate(selected, { weekday: "long" })}</h2><p className="schedule-date">{formatDate(selected, { month: "long", day: "numeric", year: "numeric" })}</p>{!dueProjects.length && !dueTasks.length ? <EmptyState icon="task" title="Room to breathe" description="Nothing scheduled for this day. Keep it open, or plan a small step."/> : <div className="schedule-items">{dueProjects.map(project => <button className="schedule-project" key={project.id} onClick={() => actions.openProject(project.id)}><ProjectIcon color={project.color} icon={project.icon} small/><span><strong>{project.name}</strong><small>Project deadline</small></span><ArrowUpRight size={15}/></button>)}{dueTasks.map(task => <div className="schedule-task" key={task.id}><button className={`task-checkbox ${task.completed ? "checked" : ""}`} aria-label={`Complete ${task.title}`} disabled={actions.pending.has(task.id)} onClick={() => { void actions.mutate("tasks", "PATCH", { completed: true }, task.id).catch(() => {}); }}>{task.completed && <Check size={12}/>}</button><button onClick={() => actions.openEditor({ kind: "tasks", item: task })}><strong>{task.title}</strong><small>{actions.data.projects.find(project => project.id === task.projectId)?.name || "Personal"}</small></button></div>)}</div>}<button className="button secondary full-width" onClick={() => actions.openEditor({ kind: "tasks", defaults: { dueDate: selected } })}><Plus size={16}/>Plan a task</button></aside></div>;
}

export function SettingsPanel({ data, onSave, onSignOut }: { data: WorkspaceData; onSave: (values: { name: string; weeklyGoal: number }) => Promise<void>; onSignOut: () => void }) {
  const [name, setName] = useState(data.user.name);
  const [goal, setGoal] = useState(data.user.weeklyGoal);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); setSaved(false); try { await onSave({ name, weeklyGoal: goal }); setSaved(true); } catch (err) { setError(err instanceof Error ? err.message : "Could not save your settings."); } finally { setBusy(false); } }
  function exportWorkspace() { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `folio-workspace-${dateKey()}.json`; link.click(); URL.revokeObjectURL(url); }
<<<<<<< Updated upstream
  const providerLabel = data.user.provider === "google" ? "Google" : data.user.provider === "github" ? "GitHub" : "Email & password";
  const signedInVia = data.user.provider === "google" ? "Google" : data.user.provider === "github" ? "GitHub" : "email";
  return <div className="settings-layout"><form onSubmit={save} className="settings-form"><section className="panel settings-card"><div className="settings-section-heading"><h2>A little about you</h2><p>Make your workspace feel like home.</p></div><div className="profile-preview"><Avatar name={name}/><div><strong>{name || "Your name"}</strong><span>{data.user.email}</span></div><span className="account-badge">{providerLabel}</span></div><label className="form-field"><span>Your name</span><input value={name} onChange={event => setName(event.target.value)} maxLength={80} required/></label><label className="form-field"><span>Email address</span><input value={data.user.email} disabled/></label><p className="field-hint">You signed in with {signedInVia}. Your email is used only to keep your workspace private.</p></section><section className="panel settings-card"><div className="settings-section-heading"><h2>Your pace. Your progress.</h2><p>Pick a weekly task goal that feels good, not overwhelming.</p></div><label className="form-field goal-field"><span>Tasks per week</span><input type="number" value={goal} onChange={event => setGoal(Number(event.target.value))} min={1} max={100} required/><span className="field-hint">Your weekly focus resets every Monday.</span></label></section>{error && <div className="form-error" role="alert">{error}</div>}<div className="settings-actions"><button className="button primary settings-save" disabled={busy}>{busy ? <Spinner/> : <Check size={16}/>}Save changes</button>{saved && <span className="settings-saved"><Check size={13}/>Saved</span>}</div></form><aside className="settings-aside"><section className="panel settings-card data-card"><span className="settings-data-icon"><Download size={23}/></span><h2>Your work belongs to you.</h2><p>Download your projects, tasks, ideas, and activity as a JSON file. Keep a little backup of everything you’re building.</p><button className="button secondary full-width" type="button" onClick={exportWorkspace}><Download size={15}/>Export workspace</button></section><section className="panel settings-card account-card"><LockIllustration/><h2>All your ideas. Just for you.</h2><p>Your workspace is private and securely linked to your account. Only you can see your projects, tasks, and ideas—and every change saves automatically.</p><button className="button secondary full-width" type="button" onClick={onSignOut}>Sign out<ArrowRight size={15}/></button></section></aside></div>;
=======
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
>>>>>>> Stashed changes
}
function LockIllustration() { return <span className="settings-data-icon color-green"><CheckCheck size={24}/></span>; }

export function ProjectDetails({ project, actions }: { project: Project; actions: WorkspaceActions }) {
  const progress = projectProgress(project.id, actions.data.tasks);
  return <div className="project-details"><div className="project-detail-top"><ProjectIcon icon={project.icon} color={project.color}/><div className="detail-actions"><button className={`icon-button ${project.favorite ? "starred" : ""}`} aria-label={project.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => { void actions.mutate("projects", "PATCH", { favorite: !project.favorite }, project.id).catch(() => {}); }}><Star size={18} fill={project.favorite ? "currentColor" : "none"}/></button><button className="button secondary small-button" onClick={() => actions.openEditor({ kind: "projects", item: project })}><Pencil size={14}/>Edit project</button><button className="icon-button danger-text" aria-label="Delete project" onClick={() => actions.deleteItem("projects", project)}><Trash2 size={17}/></button></div></div><p className="detail-description">{project.description || "Give this project a little context. What do you want to make happen?"}</p><div className="detail-properties"><div><span>Status</span><Status status={project.status}/></div><div><span>Priority</span><strong className={`priority priority-${project.priority.toLowerCase()}`}><Flag size={13}/>{project.priority}</strong></div><div><span>Due date</span><strong><CalendarDays size={14}/>{formatDate(project.dueDate)}</strong></div><div><span>Category</span><strong>{project.category}</strong></div></div><div className="detail-progress"><div><h3>Little steps, real progress</h3><span>{progress.done} of {progress.total} tasks complete <strong>{progress.percent}%</strong></span></div><div className="progress-track"><span className={`progress-fill fill-${project.color}`} style={{ width: `${progress.percent}%` }}/></div></div><div className="detail-task-heading"><h3>Project tasks</h3><button className="button secondary small-button" onClick={() => actions.openEditor({ kind: "tasks", defaults: { projectId: project.id } })}><Plus size={15}/>Add task</button></div><TasksPanel key={project.id} actions={actions} projectId={project.id}/></div>;
}
