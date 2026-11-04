"use client";

import { regionalPreferences } from "@/lib/personalization";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, CornerDownLeft, Flag, FolderKanban, Plus } from "lucide-react";
import { dateKey, formatDate, relativeDay, type Milestone, type Project, type Task } from "@/lib/types";
import { addDays, isOverdue, isTaskDrag, PRIORITY_RANK, TASK_DRAG_TYPE, weekStart } from "@/lib/tasks";
import { usePersistentState } from "@/lib/use-persistent-state";
import { ProjectIcon } from "@/components/ui";
import type { WorkspaceActions } from "@/components/workspace-views";
import { CompleteCheck, PriorityIcon, ProjectChip, TaskStatusIcon } from "@/components/task-parts";
import { GoogleEventDialog, formatEventRange, type EventDialogState, type GoogleEventInfo, type useGoogleIntegration } from "@/components/integrations/google";

type Mode = "month" | "week";
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LIMIT = 3;

function shiftMonth(key: string, delta: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0,10);
}

export interface CalendarFocusEvent {
  eventId: string;
  date: string | null;
  nonce: number;
}

interface TaskCalendarProps {
  actions: WorkspaceActions;
  tasks: Task[];
  /** Separates remembered preferences (Calendar tab vs. Tasks view). */
  persistKey: string;
  /** Also plot project deadlines (Calendar tab). */
  showProjects?: boolean;
  /** Offer a show/hide completed toggle (Calendar tab; the Tasks view uses its own filters). */
  completedToggle?: boolean;
  createDefaults?: Record<string, unknown>;
  preserveTaskOrder?: boolean;
  partialResults?: boolean;
  /** Milestones shown as their own event type (Calendar tab). */
  milestones?: Milestone[];
  showMilestones?: boolean;
  /** Google Calendar integration. Omit to keep the calendar Folio-only. */
  google?: ReturnType<typeof useGoogleIntegration>;
  /** Deep-link request from clicking a Google Calendar notification. */
  focusEvent?: CalendarFocusEvent | null;
  onFocusHandled?: (found: boolean) => void;
}

export function TaskCalendar({ actions, tasks, persistKey, showProjects = false, completedToggle = false, createDefaults = {}, milestones, showMilestones = false, google, focusEvent, onFocusHandled, preserveTaskOrder = false, partialResults = false }: TaskCalendarProps) {
  const today = dateKey();
  const weekStartDay = regionalPreferences().weekStart;
  const WEEKDAYS = Array.from({ length: 7 }, (_, index) => WEEKDAY_NAMES[(index + weekStartDay) % 7]);
  const [mode, setMode] = usePersistentState<Mode>(`folio.${persistKey}.calendarMode`, "month", "local", ["month", "week"]);
  const [source, setSource] = usePersistentState<"all" | "tasks" | "projects">(`folio.${persistKey}.calendarSource`, "all", "local", ["all", "tasks", "projects"]);
  const [doneMode, setDoneMode] = usePersistentState<"show" | "hide">(`folio.${persistKey}.calendarDone`, "hide", "local", ["show", "hide"]);
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [eventDialog, setEventDialog] = useState<EventDialogState | null>(null);
  const [eventFilter, setEventFilter] = usePersistentState<"all" | "google" | "tasks" | "projects" | "milestones">(`folio.${persistKey}.eventFilter`, "all", "local", ["all", "google", "tasks", "projects", "milestones"]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const days = useMemo(() => {
    const start = mode === "week" ? weekStart(anchor) : weekStart(`${anchor.slice(0, 7)}-01`);
    return Array.from({ length: mode === "week" ? 7 : 42 }, (_, index) => addDays(start, index));
  }, [mode, anchor]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    if (showProjects && source === "projects") return map;
    for (const task of tasks) {
      if (!task.dueDate || (completedToggle && doneMode === "hide" && task.completed)) continue;
      const list = map.get(task.dueDate) ?? [];
      list.push(task);
      map.set(task.dueDate, list);
    }
    if (!preserveTaskOrder) for (const list of map.values()) list.sort((a, b) => Number(a.completed) - Number(b.completed) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title));
    return map;
  }, [tasks, showProjects, source, completedToggle, doneMode, preserveTaskOrder]);

  const projectsByDay = useMemo(() => {
    const map = new Map<string, Project[]>();
    if (!showProjects || source === "tasks") return map;
    for (const project of actions.data.projects) {
      if (!project.dueDate || project.archived) continue;
      map.set(project.dueDate, [...(map.get(project.dueDate) ?? []), project]);
    }
    return map;
  }, [actions.data.projects, showProjects, source]);

  const title = mode === "month"
    ? formatDate(anchor, { month: "long", year: "numeric" })
    : `${formatDate(days[0], { month: "short", day: "numeric" })} – ${formatDate(days[6], { month: "short", day: "numeric", year: "numeric" })}`;
  const step = (delta: number) => setAnchor(mode === "month" ? shiftMonth(anchor, delta) : addDays(anchor, delta * 7));
  const openCreate = (key: string) => actions.openEditor({ kind: "tasks", defaults: { ...createDefaults, dueDate: key } });
  const longDate = (key: string) => formatDate(key, { weekday: "long", month: "long", day: "numeric" });

  function onDrop(event: DragEvent<HTMLElement>, key: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData(TASK_DRAG_TYPE) || dragId;
    const task = tasks.find((entry) => entry.id === id);
    setDragId(null);
    setOverDay(null);
    if (task && task.dueDate !== key) void actions.mutate("tasks", "PATCH", { dueDate: key }, task.id).catch(() => {});
  }

  async function quickAdd() {
    const value = draft.trim();
    if (!value || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await actions.mutate("tasks", "POST", { ...createDefaults, title: value.slice(0, 200), dueDate: selected });
      setDraft("");
    } catch { /* toast already shown */ } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const milestonesByDay = useMemo(() => {
    const map = new Map<string, Milestone[]>();
    if (!showMilestones) return map;
    for (const milestone of milestones ?? []) {
      if (!milestone.dueDate) continue;
      map.set(milestone.dueDate, [...(map.get(milestone.dueDate) ?? []), milestone]);
    }
    return map;
  }, [milestones, showMilestones]);

  // Google events come from Folio's own mirror, so the calendar renders instantly.
  const googleByDay = useMemo(() => {
    const map = new Map<string, GoogleEventInfo[]>();
    if (!google?.status.connected) return map;
    for (const event of google.events) {
      if (event.status !== "confirmed") continue;
      const first = event.allDay ? event.startDate : event.startAt ? dateKey(new Date(event.startAt)) : null;
      const last = event.allDay ? (event.endDate ? dayKeyMinus(event.endDate) : first) : event.endAt ? dateKey(new Date(event.endAt)) : first;
      if (!first) continue;
      let cursor = first; // a multi-day event appears once per day it covers
      for (let guard = 0; (!last || cursor <= last) && guard < 62; guard++) {
        map.set(cursor, [...(map.get(cursor) ?? []), event]);
        cursor = nextDay(cursor);
      }
    }
    return map;
  }, [google?.status.connected, google?.events]);

  const agendaProjects = projectsByDay.get(selected) ?? [];
  const agendaTasks = tasksByDay.get(selected) ?? [];
  const agendaGoogle = googleByDay.get(selected) ?? [];
  const agendaMilestones = milestonesByDay.get(selected) ?? [];
  const agendaFilter = (kind: "google" | "tasks" | "projects" | "milestones") => eventFilter === "all" || eventFilter === kind;

  // Keep the mirror filled for the visible range plus a little margin.
  const loadEvents = google?.loadEvents;
  const googleReady = Boolean(google?.status.connected);
  const rangeStart = days[0];
  const rangeEnd = days[days.length - 1];
  useEffect(() => {
    if (!googleReady || !loadEvents) return;
    const from = new Date(`${rangeStart}T12:00:00`); from.setDate(from.getDate() - 7);
    const to = new Date(`${rangeEnd}T12:00:00`); to.setDate(to.getDate() + 7);
    void loadEvents(dateKey(from), dateKey(to));
  }, [googleReady, loadEvents, rangeStart, rangeEnd]);

  // Open a specific Google Calendar event inside Folio when navigated from a notification.
  const handledNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!focusEvent || handledNonce.current === focusEvent.nonce) return;
    handledNonce.current = focusEvent.nonce;
    let cancelled = false;

    if (focusEvent.date && /^\d{4}-\d{2}-\d{2}$/.test(focusEvent.date)) {
      setAnchor(focusEvent.date);
      setSelected(focusEvent.date);
    }

    const inMemory = google?.events.find((ev) => ev.id === focusEvent.eventId);
    if (inMemory) {
      const evDate = inMemory.allDay ? inMemory.startDate : (inMemory.startAt ? dateKey(new Date(inMemory.startAt)) : null);
      if (evDate) {
        setAnchor(evDate);
        setSelected(evDate);
      }
      setEventDialog({ mode: "edit", event: inMemory });
      onFocusHandled?.(true);
      return;
    }

    fetch(`/api/integrations/google/events/${encodeURIComponent(focusEvent.eventId)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as { event?: GoogleEventInfo };
        return body.event ?? null;
      })
      .then((ev) => {
        if (cancelled) return;
        if (ev) {
          const evDate = ev.allDay ? ev.startDate : (ev.startAt ? dateKey(new Date(ev.startAt)) : null);
          if (evDate) {
            setAnchor(evDate);
            setSelected(evDate);
          }
          setEventDialog({ mode: "edit", event: ev });
          onFocusHandled?.(true);
        } else {
          onFocusHandled?.(false);
        }
      })
      .catch(() => {
        if (!cancelled) onFocusHandled?.(false);
      });

    return () => {
      cancelled = true;
    };
  }, [focusEvent, google?.events, onFocusHandled]);

  // Google sends the user back to /calendar?google=… — surface the result once, then clean the URL.
  useEffect(() => {
    if (!google?.status.connected) return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("google");
    if (!flag) return;
    if (flag === "connected") void google.sync(false).then(() => google.setMessage(null));
    else google.setMessage({ tone: "error", text: params.get("message") ?? "Google Calendar wasn’t connected." });
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once when Google redirects back
  }, []);

  return (
    <div className={`tk-cal is-${mode}`}>
      <section className="tk-cal-main" aria-label="Calendar">
        <header className="tk-cal-bar">
          <h2>{title}</h2>
          <div className="tk-cal-nav">
            <button type="button" className="tk-icon-btn is-boxed" aria-label={mode === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
            <button type="button" className="pj-btn is-secondary is-sm" onClick={() => { setAnchor(today); setSelected(today); }}>Today</button>
            <button type="button" className="tk-icon-btn is-boxed" aria-label={mode === "month" ? "Next month" : "Next week"} onClick={() => step(1)}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          <div className="tk-cal-tools">
            {showProjects && (
              <label className="pj-select is-sm">
                <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} aria-label="Show on calendar">
                  <option value="all">Tasks & deadlines</option>
                  <option value="tasks">Tasks only</option>
                  <option value="projects">Project deadlines</option>
                </select>
              </label>
            )}
            {google?.status.connected && (
              <label className="pj-select is-sm">
                <select value={eventFilter} onChange={(entry) => setEventFilter(entry.target.value as typeof eventFilter)} aria-label="Filter calendar by event type">
                  <option value="all">All events</option>
                  <option value="google">Google Calendar</option>
                  <option value="tasks">Folio tasks</option>
                  <option value="projects">Project deadlines</option>
                  {showMilestones && <option value="milestones">Milestones</option>}
                </select>
              </label>
            )}
            {google?.status.canWrite && (
              <button type="button" className="pj-btn is-secondary is-sm" onClick={() => setEventDialog({ mode: "create", defaults: { date: selected, allDay: false } })}><Plus size={14} aria-hidden="true" />New event</button>
            )}
            {google?.status.connected && (
              <label className="pj-select is-sm">
                <select value={eventFilter} onChange={(changeEvent) => setEventFilter(changeEvent.target.value as typeof eventFilter)} aria-label="Filter the calendar by event type">
                  <option value="all">All events</option>
                  <option value="google">Google Calendar</option>
                  <option value="tasks">Folio tasks</option>
                  <option value="projects">Project deadlines</option>
                  {showMilestones && <option value="milestones">Milestones</option>}
                </select>
              </label>
            )}
            {google?.status.canWrite && (
              <button type="button" className="pj-btn is-secondary is-sm" onClick={() => setEventDialog({ mode: "create", defaults: { date: selected, allDay: false } })}><Plus size={14} aria-hidden="true" />New event</button>
            )}
            {completedToggle && (
              <button type="button" className={`pj-btn is-ghost is-sm ${doneMode === "show" ? "is-active" : ""}`} aria-pressed={doneMode === "show"} onClick={() => setDoneMode(doneMode === "show" ? "hide" : "show")}>Show completed</button>
            )}
            <div className="pj-segmented" role="group" aria-label="Calendar range">
              <button type="button" className={`tk-seg-text ${mode === "month" ? "is-active" : ""}`} aria-pressed={mode === "month"} onClick={() => setMode("month")}>Month</button>
              <button type="button" className={`tk-seg-text ${mode === "week" ? "is-active" : ""}`} aria-pressed={mode === "week"} onClick={() => { setMode("week"); setAnchor(selected); }}>Week</button>
            </div>
          </div>
        </header>

        <div className="tk-cal-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="tk-cal-grid" role="grid" aria-label={title}>
          {days.map((key) => {
            const dayTasks = agendaFilter("tasks") ? tasksByDay.get(key) ?? [] : [];
            const dayProjects = agendaFilter("projects") ? projectsByDay.get(key) ?? [] : [];
            const dayGoogle = agendaFilter("google") ? googleByDay.get(key) ?? [] : [];
            const dayMilestones = agendaFilter("milestones") ? milestonesByDay.get(key) ?? [] : [];
            const total = dayTasks.length + dayProjects.length + dayGoogle.length + dayMilestones.length;
            const limit = mode === "month" ? MONTH_LIMIT : 50;
            const shownGoogle = dayGoogle.slice(0, limit);
            const shownProjects = dayProjects.slice(0, Math.max(0, limit - shownGoogle.length));
            const shownMilestones = dayMilestones.slice(0, Math.max(0, limit - shownGoogle.length - shownProjects.length));
            const shownTasks = dayTasks.slice(0, Math.max(0, limit - shownGoogle.length - shownProjects.length - shownMilestones.length));
            const more = total - shownGoogle.length - shownProjects.length - shownMilestones.length - shownTasks.length;
            const date = new Date(`${key}T12:00:00`);
            return (
              <div
                key={key}
                role="gridcell"
                aria-selected={selected === key}
                className={`tk-day ${mode === "month" && key.slice(0, 7) !== anchor.slice(0, 7) ? "is-outside" : ""} ${key === today ? "is-today" : ""} ${key < today ? "is-past" : ""} ${selected === key ? "is-selected" : ""} ${overDay === key ? "is-over" : ""}`}
                onClick={() => setSelected(key)}
                onDoubleClick={() => openCreate(key)}
                onDragOver={(event) => { if (!isTaskDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (overDay !== key) setOverDay(key); }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverDay((current) => (current === key ? null : current)); }}
                onDrop={(event) => onDrop(event, key)}
              >
                <div className="tk-day-head">
                  <button type="button" className="tk-day-num" aria-label={`${longDate(key)}${total ? `, ${total} item${total === 1 ? "" : "s"}` : ", nothing scheduled"}`} onClick={(event) => { event.stopPropagation(); setSelected(key); }}>
                    {mode === "week" && <span className="tk-day-name">{WEEKDAY_NAMES[date.getDay()]}</span>}
                    {date.getDate() === 1 && mode === "month" ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : date.getDate()}
                  </button>
                  <button type="button" className="tk-day-add" aria-label={`Add a task on ${longDate(key)}`} onClick={(event) => { event.stopPropagation(); openCreate(key); }}><Plus size={13} aria-hidden="true" /></button>
                </div>
                <div className="tk-day-items">
                  {shownGoogle.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className={`tk-cal-chip is-google ${event.localDirty ? "is-conflict" : ""} ${event.taskId ? "is-linked" : ""}`}
                      title={`${event.title || "(untitled)"}${event.summary ? ` · ${event.summary}` : ""}${event.allDay ? " · all day" : ` · ${formatEventRange(event)}`}`}
                      onClick={(clickEvent) => { clickEvent.stopPropagation(); setEventDialog({ mode: "edit", event }); }}
                      onDoubleClick={(clickEvent) => clickEvent.stopPropagation()}
                    >
                      <GoogleGlyph />
                      <span>{event.title || "(untitled)"}</span>
                    </button>
                  ))}
                  {shownMilestones.map((milestone) => (
                    <button key={milestone.id} type="button" className={`tk-cal-chip is-milestone ${milestone.completed ? "is-done" : ""}`} title={`Milestone: ${milestone.title}`} onClick={(clickEvent) => clickEvent.stopPropagation()}>
                      <Flag size={11} aria-hidden="true" /><span>{milestone.title}</span>
                    </button>
                  ))}
                  {shownProjects.map((project) => (
                    <button key={project.id} type="button" className={`tk-cal-chip is-project c-${project.color}`} title={`Project deadline: ${project.name}`} onClick={(event) => { event.stopPropagation(); actions.openProject(project.id); }}>
                      <FolderKanban size={11} aria-hidden="true" /><span>{project.name}</span>
                    </button>
                  ))}
                  {shownTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      draggable
                      title={task.title}
                      className={`tk-cal-chip pri-${task.priority.toLowerCase()} ${task.completed ? "is-done" : ""} ${isOverdue(task, today) ? "is-late" : ""} ${dragId === task.id ? "is-dragging" : ""}`}
                      onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(TASK_DRAG_TYPE, task.id); event.dataTransfer.setData("text/plain", task.title); requestAnimationFrame(() => setDragId(task.id)); }}
                      onDragEnd={() => { setDragId(null); setOverDay(null); }}
                      onClick={(event) => { event.stopPropagation(); actions.openEditor({ kind: "tasks", item: task }); }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <TaskStatusIcon status={task.status} size={11} /><span>{task.title}</span>
                    </button>
                  ))}
                  {more > 0 && <button type="button" className="tk-cal-more" onClick={(event) => { event.stopPropagation(); setSelected(key); }}>+{more} more</button>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="tk-cal-help">{partialResults ? "Showing loaded matches. Use Load more results below to include the remaining tasks. · " : ""}Drag a task to another day to reschedule · double-click a day, or use <Plus size={11} aria-hidden="true" />, to add a task</p>
      </section>

      <aside className="tk-agenda" aria-label={`Agenda for ${longDate(selected)}`}>
        <span className="tk-agenda-kicker">{selected === today ? "Today" : relativeDay(selected, today)}</span>
        <h3>{longDate(selected)}</h3>
        {agendaProjects.length + agendaTasks.length + agendaGoogle.length + agendaMilestones.length === 0 ? (
          <div className="tk-agenda-empty"><CalendarDays size={20} aria-hidden="true" /><p>{partialResults ? "No loaded matches on this day. Load more results below to include the remaining tasks." : "Nothing scheduled. Keep it open, or plan a small step."}</p></div>
        ) : (
          <ul className="tk-agenda-list">
            {agendaProjects.map((project) => (
              <li key={project.id}>
                <button type="button" className="tk-agenda-project" onClick={() => actions.openProject(project.id)}>
                  <ProjectIcon icon={project.icon} color={project.color} small />
                  <span><strong>{project.name}</strong><small>Project deadline</small></span>
                </button>
              </li>
            ))}
            {agendaGoogle.map((event) => (
              <li key={event.id} className="is-google">
                <button type="button" className="tk-agenda-task" onClick={() => setEventDialog({ mode: "edit", event })}>
                  <strong><GoogleGlyph /> {event.title || "(untitled)"}</strong>
                  <span>{event.summary ?? "Google Calendar"} · {formatEventRange(event)}{event.localDirty && " · changed in both"}</span>
                </button>
              </li>
            ))}
            {agendaMilestones.map((milestone) => (
              <li key={milestone.id} className={milestone.completed ? "is-done" : ""}>
                <span className="tk-ms-dot" aria-hidden="true"><Flag size={11} /></span>
                <span className="tk-agenda-task"><strong>{milestone.title}</strong><span>Milestone{milestone.completed ? " · reached" : ""}</span></span>
              </li>
            ))}
            {agendaTasks.map((task) => (
              <li key={task.id} className={task.completed ? "is-done" : ""}>
                <CompleteCheck task={task} actions={actions} size="sm" />
                <button type="button" className="tk-agenda-task" onClick={() => actions.openEditor({ kind: "tasks", item: task })}>
                  <strong>{task.title}</strong>
                  <span>{task.priority !== "None" && <PriorityIcon priority={task.priority} size={12} />}{task.projectId ? <ProjectChip project={actions.data.projects.find((project) => project.id === task.projectId)} /> : "Personal"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="tk-agenda-add" onSubmit={(event) => { event.preventDefault(); void quickAdd(); }}>
          <Plus size={14} aria-hidden="true" />
          <input value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} maxLength={200} placeholder={`Add a task for ${formatDate(selected)}`} aria-label={`New task due ${longDate(selected)}`} />
          <button type="submit" className="tk-icon-btn" aria-label="Add task" disabled={busy || !draft.trim()}><CornerDownLeft size={14} aria-hidden="true" /></button>
        </form>
        <button type="button" className="pj-btn is-secondary is-sm tk-agenda-more" onClick={() => openCreate(selected)}><Plus size={14} aria-hidden="true" />Add with details</button>
      </aside>

      {eventDialog && google && (
        <GoogleEventDialog
          state={eventDialog}
          integration={google}
          onClose={() => {
            setEventDialog(null);
            if (google.status.connected) {
              const from = new Date(`${rangeStart}T12:00:00`);
              from.setDate(from.getDate() - 7);
              const to = new Date(`${rangeEnd}T12:00:00`);
              to.setDate(to.getDate() + 7);
              void google.loadEvents(dateKey(from), dateKey(to));
            }
          }}
        />
      )}
</div>
  );
}

/** ISO day helpers kept local: the calendar is the only place that walks day-by-day. */
function nextDay(key: string) {
  return addDays(key, 1);
}
function dayKeyMinus(key: string) {
  return addDays(key, -1);
}
function GoogleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285f4" d="M22 12a10 10 0 1 1-3.5-7.6l-3 3A6 6 0 1 0 18 12z" />
      <path fill="#34a853" d="M12 22a10 10 0 0 0 9.5-7H12z" opacity=".9" />
      <path fill="#fbbc04" d="M21.5 15A10 10 0 0 0 22 12h-4a6 6 0 0 1-.2 1.6z" opacity=".9" />
    </svg>
  );
}
