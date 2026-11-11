"use client";

import type { SearchKind } from "@/lib/search-types";
import { searchRequest } from "@/lib/search-client";
import { DEFAULT_PERSONAL, setBrowserPersonal } from "@/lib/personalization";
import { applyTheme } from "@/components/theme-toggle";
import { isDesktopRuntime } from "@/lib/desktop/runtime";
import { desktopApiUrl } from "@/lib/desktop/api-base";
import { getSyncEngine } from "@/lib/desktop/sync-engine";
import { markLocalProfilePending, setCachedProfile } from "@/lib/desktop/local-db";
import {
  desktopBulkTasks,
  desktopConvertIdea,
  desktopMutate,
  loadDesktopWorkspace,
} from "@/lib/desktop/desktop-workspace";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate, statusLabel, TASK_STATUS_LABELS, type Activity, type Idea, type Item, type Milestone, type Project, type Resource, type Subtask, type Task, type TaskStatus, type WorkspaceData } from "@/lib/types";

// Sensible optimistic defaults per resource, mirroring the database defaults.
const DEFAULTS: Record<Resource, Record<string, unknown>> = {
  projects: { description: "", status: "Planning", priority: "Medium", color: "violet", icon: "layout", category: "Personal", startDate: null, dueDate: null, favorite: false, archived: false },
  tasks: { description: "", notes: "", status: "todo", priority: "Medium", startDate: null, dueDate: null, labels: [], estimateMinutes: null, completed: false, completedAt: null, projectId: null, milestoneId: null },
  ideas: { description: "", status: "Just an idea", color: "yellow", category: "Personal" },
  milestones: { description: "", dueDate: null, completed: false, completedAt: null },
  subtasks: { completed: false, completedAt: null, position: 9999 },
};
// Kinds whose creation is a meaningful first workspace action.
const CREATION_KINDS = new Set<Resource>(["projects", "tasks", "ideas", "milestones"]);

const LABELS: Record<Resource, string> = { projects: "Project", tasks: "Task", ideas: "Idea", milestones: "Milestone", subtasks: "Subtask" };

export interface MutateOptions {
  /** Skip the success toast (inline edits show their own feedback). Errors always surface. */
  quiet?: boolean;
}
export interface BulkResult { count: number; missing: number }

function normalise(result: Partial<WorkspaceData>): WorkspaceData {
  if (result.user && typeof window !== "undefined") {
    const personal = { ...DEFAULT_PERSONAL, ...result.user.personal };
    setBrowserPersonal(personal, result.user.timezone || "UTC");
    document.documentElement.dataset.folioAccount = result.user.id;
    applyTheme(personal.theme, false);
    try {
      localStorage.setItem("folio.tasks.density", personal.taskDensity);
      localStorage.setItem("folio.tasks.insights", personal.taskInsights ? "open" : "closed");
    } catch { /* browser storage is optional; the account profile remains authoritative */ }
  }
  return { ...(result as WorkspaceData), subtasks: result.subtasks ?? [], milestones: result.milestones ?? [], activities: result.activities ?? [] };
}

export function useWorkspace(notify: (message: string, tone?: "success" | "error") => void) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const dataRef = useRef(data);
  const pendingRef = useRef(new Set<string>());
  // Requests for the same item run strictly in order, so rapid edits can't race.
  const queueRef = useRef(new Map<string, Promise<unknown>>());
  // Fields with an edit still in flight. A server response never overwrites them.
  const inflightRef = useRef(new Map<string, Map<string, number>>());

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const reload = useCallback(async () => {
    try {
      // Local-first: in the desktop shell the SQLite mirror is the source of
      // truth (0ms, offline-capable). The network path is the web fallback.
      if (isDesktopRuntime()) {
        const local = await loadDesktopWorkspace();
        if (local) {
          const next = normalise(local);
          setData(next); dataRef.current = next; setError("");
          return;
        }
        // No cached profile yet (first seconds after sign-in, or a broken
        // local database): show a transient state — never a redirect, never
        // a network call that could unmount the workspace while offline.
        throw new Error("Your workspace is still syncing. One moment…");
      }
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const result = await response.json();
      if (response.status === 401) { window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`); throw new Error("Please sign in again."); }
      if (!response.ok) throw new Error(result.error || "Could not load your workspace.");
      const next = normalise(result);
      setData(next); dataRef.current = next; setError("");
    } catch (err) { const message = err instanceof Error ? err.message : "Couldn’t connect to your workspace."; setError(message); throw new Error(message); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Desktop shell: boot the background sync engine (launch trigger) and
    // render from the local SQLite mirror — the web keeps the classic
    // request/response flow.
    const engine = getSyncEngine();
    engine?.start();
    async function loadWorkspace() {
      try {
        if (isDesktopRuntime()) {
          const local = await loadDesktopWorkspace();
          if (local && !cancelled) {
            const next = normalise(local);
            dataRef.current = next;
            setData(next);
            setError("");
            return;
          }
          if (local) return;
          // The session gate guarantees a local_auth row before this hook
          // mounts; an empty mirror simply means the first pull is still
          // running. No network call, no login redirect — a splash state.
          if (!cancelled) setError("Your workspace is still syncing. One moment…");
          return;
        }
        const response = await fetch("/api/workspace", { cache: "no-store" });
        const result = await response.json();
        if (response.status === 401) { window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`); throw new Error("Please sign in again."); }
      if (!response.ok) throw new Error(result.error || "Could not load your workspace.");
        if (!cancelled) {
          const next = normalise(result);
          dataRef.current = next;
          setData(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn’t connect to your workspace.");
      }
    }
    void loadWorkspace();
    return () => { cancelled = true; };
  }, []);

  // Web only: refresh the server session cookie every 30 minutes. The
  // desktop shell NEVER validates its session over the network — its
  // session lives in local_auth and stays valid offline.
  useEffect(() => {
    if (isDesktopRuntime()) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void fetch(desktopApiUrl("/api/auth/session"), { method: "POST" }).catch(() => {}); }, 30 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onWorkspaceSync = () => { void reload().catch(() => {}); };
    window.addEventListener("folio:workspace-sync", onWorkspaceSync);
    return () => window.removeEventListener("folio:workspace-sync", onWorkspaceSync);
  }, [reload]);

  function markPending(ids: string[], value: boolean) {
    for (const id of ids) { if (value) pendingRef.current.add(id); else pendingRef.current.delete(id); }
    setPending(new Set(pendingRef.current));
  }

  function track(id: string, keys: string[], delta: 1 | -1) {
    const map = inflightRef.current.get(id) ?? new Map<string, number>();
    for (const key of keys) { const next = (map.get(key) ?? 0) + delta; if (next > 0) map.set(key, next); else map.delete(key); }
    if (map.size) inflightRef.current.set(id, map); else inflightRef.current.delete(id);
  }

  function enqueue<T>(id: string | undefined, run: () => Promise<T>): Promise<T> {
    if (!id) return run();
    const prior = queueRef.current.get(id);
    const job = prior ? prior.catch(() => undefined).then(run) : run();
    queueRef.current.set(id, job);
    void job.catch(() => undefined).finally(() => { if (queueRef.current.get(id) === job) queueRef.current.delete(id); });
    return job;
  }

  function successMessage(kind: Resource, method: "POST" | "PATCH" | "DELETE", values: Record<string, unknown>, previous?: Item) {
    const label = LABELS[kind];
    if (method === "POST") return kind === "milestones" ? "Milestone added. Big goals, smaller steps." : `${label} created. A little momentum starts here.`;
    if (method === "DELETE") return `${label} deleted.`;
    if (kind === "tasks" && typeof values.status === "string") {
      if (values.status === "done") return "One more little win. Task complete!";
      const was = (previous as Task | undefined)?.status;
      return was === "done" ? `Reopened — back in ${TASK_STATUS_LABELS[values.status as TaskStatus]}.` : `Moved to ${TASK_STATUS_LABELS[values.status as TaskStatus]}.`;
    }
    if (kind === "tasks" && Object.keys(values).length === 1 && "dueDate" in values) return typeof values.dueDate === "string" ? `Rescheduled to ${formatDate(values.dueDate, { weekday: "short", month: "short", day: "numeric" })}.` : "Due date cleared.";
    if (kind === "tasks" && typeof values.completed === "boolean") return values.completed ? "One more little win. Task complete!" : "Task moved back to your to-do list.";
    if (kind === "milestones" && typeof values.completed === "boolean") return values.completed ? "Milestone reached. That’s real progress!" : "Milestone reopened.";
    if ("archived" in values) return values.archived ? "Project archived. Restore it any time." : "Project restored from the archive.";
    if ("favorite" in values) return values.favorite ? "Added to your favorites." : "Removed from favorites.";
    if (kind === "projects" && Object.keys(values).length === 1 && typeof values.status === "string") return `Moved to ${statusLabel(values.status)}.`;
    return "Changes saved. Looking good.";
  }

  async function mutate(kind: Resource, method: "POST" | "PATCH" | "DELETE", values: Record<string, unknown> = {}, id?: string, options: MutateOptions = {}): Promise<Item> {
    const current = dataRef.current;
    if (!current) throw new Error("Your workspace is still loading.");
    const previous = id ? (current[kind] as Item[]).find(item => item.id === id) : undefined;
    const optimisticId = id || crypto.randomUUID();
    // `subtasks` and `reminder` on a new task are creation payloads, not fields of the task row itself.
    const fields = Object.fromEntries(Object.entries(values).filter(([key]) => !(kind === "tasks" && (key === "subtasks" || key === "reminder"))));
    const keys = Object.keys(fields);
    const now = new Date().toISOString();
    if (method === "PATCH" && id) track(id, keys, 1);
    markPending([optimisticId], true);
    setData(state => {
      if (!state) return state;
      const list = state[kind] as Item[];
      const stamp = kind === "projects" || kind === "tasks" ? { updatedAt: now } : {};
      const newItem = { id: optimisticId, createdAt: now, ...stamp, ...DEFAULTS[kind], ...fields } as unknown as Item;
      const next = method === "POST" ? [newItem, ...list] : method === "DELETE" ? list.filter(item => item.id !== id) : list.map(item => item.id === id ? { ...item, ...fields, ...stamp } : item);
      return { ...state, [kind]: next } as WorkspaceData;
    });
    let released = false;
    try {
      const result = await enqueue(id, async () => {
        // Local-first path: persist to SQLite + outbox instead of the network.
        // NEVER blocks on HTTP — the mutation lands locally in milliseconds
        // and the background engine uploads it later.
        if (isDesktopRuntime()) {
          return await desktopMutate(kind, method, values, id);
        }
        const response = await fetch("/api/workspace", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, data: values }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not save your change.");
        return body;
      });
      if (method === "PATCH" && id) { track(id, keys, -1); released = true; }
      const keep = id ? [...(inflightRef.current.get(id)?.keys() ?? [])] : [];
      setData(state => {
        if (!state) return state;
        const list = state[kind] as Item[];
        const next = method === "DELETE" ? list.filter(item => item.id !== id) : list.map(item => {
          if (item.id !== optimisticId) return item;
          if (!keep.length) return result.item;
          const merged = { ...result.item } as Record<string, unknown>;
          for (const key of keep) merged[key] = (item as unknown as Record<string, unknown>)[key];
          return merged as unknown as Item;
        });
        const activity = result.activity as Activity | null | undefined;
        const updated = { ...state, [kind]: next, activities: activity ? [activity, ...state.activities].slice(0, 40) : state.activities } as WorkspaceData;
        // Work inside a project or task refreshes its "last updated" time — nothing else.
        const touchedProjects = Array.isArray(result.projects) ? new Map((result.projects as Project[]).map(project => [project.id, project.updatedAt])) : null;
        if (touchedProjects?.size) updated.projects = updated.projects.map(project => touchedProjects.has(project.id) ? { ...project, updatedAt: touchedProjects.get(project.id) ?? project.updatedAt } : project);
        const touchedTasks = Array.isArray(result.tasks) ? new Map((result.tasks as Pick<Task, "id" | "updatedAt">[]).map(task => [task.id, task.updatedAt])) : null;
        if (touchedTasks?.size) updated.tasks = updated.tasks.map(task => touchedTasks.has(task.id) ? { ...task, updatedAt: touchedTasks.get(task.id) ?? task.updatedAt } : task);
        if (Array.isArray(result.subtasks) && result.subtasks.length) updated.subtasks = [...updated.subtasks, ...(result.subtasks as Subtask[])];
        if (method === "DELETE" && kind === "projects") {
          updated.tasks = updated.tasks.map(task => task.projectId === id ? { ...task, projectId: null, milestoneId: null } : task);
          updated.milestones = updated.milestones.filter(milestone => milestone.projectId !== id);
        }
        if (method === "DELETE" && kind === "milestones") updated.tasks = updated.tasks.map(task => task.milestoneId === id ? { ...task, milestoneId: null } : task);
        if (method === "DELETE" && kind === "tasks") updated.subtasks = updated.subtasks.filter(subtask => subtask.taskId !== id);
        return updated;
      });
      if (!options.quiet) notify(successMessage(kind, method, values, previous));
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("folio:notifications-sync"));
      // The first successfully created workspace item completes first-time
      // onboarding. Only a server-confirmed POST counts — never an opened
      // modal, an abandoned form, a validation error or a failed request.
      if (method === "POST" && CREATION_KINDS.has(kind) && !result.item?.id?.startsWith?.("optimistic")) {
        const wasIncomplete = !dataRef.current?.user.onboardingCompleted;
        if (wasIncomplete) {
          setData(state => state ? ({ ...state, user: { ...state.user, onboardingCompleted: true } }) as WorkspaceData : state);
          if (isDesktopRuntime()) {
            // Desktop: complete locally and let the background engine push
            // the flag (it rides the profile-dirty queue — works offline).
            void markLocalProfilePending({ complete: true }).catch(() => {});
          } else {
            void fetch("/api/profile", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ complete: true, firstAction: true }),
            }).catch(() => { /* completion is retried on the next workspace load */ });
          }
        }
      }
      return result.item;
    } catch (err) {
      setData(state => {
        if (!state) return state;
        const list = state[kind] as Item[];
        let restored = list;
        if (method === "POST") restored = list.filter(item => item.id !== optimisticId);
        else if (method === "DELETE") restored = previous && !list.some(item => item.id === id) ? [...list, previous] : list;
        else if (previous) restored = list.map(item => {
          if (item.id !== id) return item;
          // Only roll back fields that still hold this edit's value; newer edits win.
          const copy = { ...item } as Record<string, unknown>;
          for (const key of keys) if (copy[key] === fields[key]) copy[key] = (previous as unknown as Record<string, unknown>)[key];
          return copy as unknown as Item;
        });
        return { ...state, [kind]: restored } as WorkspaceData;
      });
      const message = err instanceof Error ? err.message : "Your change couldn’t be saved. Please try again.";
      notify(message, "error"); throw new Error(message);
    } finally {
      if (method === "PATCH" && id && !released) track(id, keys, -1);
      markPending([optimisticId], false);
    }
  }

  /** Apply one change to many tasks in a single transaction (or delete them). */
  async function bulkTasks(ids: string[], change: Record<string, unknown> | "delete"): Promise<BulkResult> {
    const current = dataRef.current;
    if (!current) throw new Error("Your workspace is still loading.");
    const unique = [...new Set(ids)];
    const before = new Map(current.tasks.filter(task => unique.includes(task.id)).map(task => [task.id, task]));
    const selected = new Set(unique);
    const isDelete = change === "delete";
    const now = new Date().toISOString();
    markPending(unique, true);
    setData(state => {
      if (!state) return state;
      if (isDelete) return { ...state, tasks: state.tasks.filter(task => !selected.has(task.id)) };
      return { ...state, tasks: state.tasks.map(task => {
        if (!selected.has(task.id)) return task;
        const next = { ...task, ...change, updatedAt: now } as Task;
        if ("projectId" in change && change.projectId !== task.projectId) next.milestoneId = null;
        if (change.status === "done" && task.completed) next.completedAt = task.completedAt;
        return next;
      }) };
    });
    try {
      let result: { items?: Task[]; deleted?: string[]; missing?: number; activity: Activity | null; projects: Project[] };
      if (isDesktopRuntime()) {
        result = await desktopBulkTasks(unique, change);
      } else {
        const response = await fetch("/api/workspace", { method: isDelete ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "tasks", ids: unique, data: isDelete ? {} : change }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "We couldn’t apply that change. Nothing was modified.");
        result = body;
      }
      const returned = new Map(((result.items ?? []) as Task[]).map(task => [task.id, task]));
      setData(state => {
        if (!state) return state;
        // Anything not returned no longer exists on the server — drop it locally too.
        const tasks = isDelete ? state.tasks.filter(task => !selected.has(task.id)) : state.tasks.flatMap(task => (!selected.has(task.id) ? [task] : returned.has(task.id) ? [returned.get(task.id) as Task] : []));
        const touched = new Map(((result.projects ?? []) as Project[]).map(project => [project.id, project.updatedAt]));
        const removed = new Set(unique.filter(id => isDelete || !returned.has(id)));
        return {
          ...state,
          tasks,
          subtasks: state.subtasks.filter(subtask => !removed.has(subtask.taskId)),
          projects: touched.size ? state.projects.map(project => touched.has(project.id) ? { ...project, updatedAt: touched.get(project.id) ?? project.updatedAt } : project) : state.projects,
          activities: result.activity ? [result.activity as Activity, ...state.activities].slice(0, 40) : state.activities,
        };
      });
      const count = isDelete ? (result.deleted?.length ?? 0) : returned.size;
      const missing = Number(result.missing) || 0;
      const noun = (n: number) => `${n} task${n === 1 ? "" : "s"}`;
      const verb = isDelete ? "Deleted" : "Updated";
      notify(missing ? `${verb} ${count} of ${unique.length} tasks — ${noun(missing)} no longer existed.` : `${verb} ${noun(count)}.`);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("folio:notifications-sync"));
      return { count, missing };
    } catch (err) {
      setData(state => {
        if (!state) return state;
        if (isDelete) return { ...state, tasks: [...state.tasks, ...[...before.values()].filter(task => !state.tasks.some(entry => entry.id === task.id))] };
        return { ...state, tasks: state.tasks.map(task => before.get(task.id) ?? task) };
      });
      const message = err instanceof Error ? err.message : "We couldn’t apply that change. Nothing was modified.";
      notify(message, "error");
      throw new Error(message);
    } finally {
      markPending(unique, false);
    }
  }

  async function convert(idea: Idea) {
    markPending([idea.id], true);
    try {
      let result: { item: Project; activity: Activity };
      if (isDesktopRuntime()) {
        result = await desktopConvertIdea(idea);
      } else {
        const response = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "ideas", action: "convert", id: idea.id }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Couldn’t turn this idea into a project.");
        result = body;
      }
      setData(state => state ? { ...state, projects: [result.item, ...state.projects], ideas: state.ideas.filter(item => item.id !== idea.id), activities: [result.activity, ...state.activities].slice(0, 40) } : state);
      notify("From a little spark to a real project. Let’s go!");
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("folio:notifications-sync"));
      return result.item;
    } catch (err) { const message = err instanceof Error ? err.message : "Could not create the project."; notify(message, "error"); throw new Error(message); } finally { markPending([idea.id], false); }
  }

  async function saveSettings(values: { name: string; weeklyGoal: number }): Promise<void> {
    if (isDesktopRuntime()) {
      // Local-first: the profile snapshot updates immediately, the change is
      // marked pending, and the background engine PATCHes the cloud profile
      // on its next cycle. Works identically online and offline.
      const currentUser = dataRef.current?.user;
      setData(state => state ? { ...state, user: { ...state.user, name: values.name, weeklyGoal: values.weeklyGoal } } : state);
      await markLocalProfilePending(values).catch(() => {});
      // Keep the cached profile (the local mirror's `user`) in sync so a
      // reload keeps the new name even before the cloud push lands.
      if (currentUser) {
        await setCachedProfile({ ...currentUser, name: values.name, weeklyGoal: values.weeklyGoal }).catch(() => {});
      }
      notify("Your workspace feels a little more like you.");
      return;
    }
    const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save your settings.");
    setData(state => state ? { ...state, user: result.user } : state);
    notify("Your workspace feels a little more like you.");
  }

  // A result may have been created in another tab after the workspace loaded.
  // Fetch its current owner-checked record and hydrate the existing editors.
  async function loadSearchItem(kind: SearchKind, id: string): Promise<Item> {
    const result = await searchRequest<{ item: Item; subtasks: Subtask[]; milestones: Milestone[]; projects: Project[]; tasks: Task[] }>(
      `/api/search/entity?${new URLSearchParams({ kind, id })}`,
    );
    setData(state => {
      if (!state) return state;
      const merge = <T extends { id: string }>(rows: T[], incoming: T[]) => {
        const byId = new Map(rows.map(row => [row.id, row]));
        for (const row of incoming) byId.set(row.id, row);
        return [...byId.values()];
      };
      const hydrated = {
        ...state,
        projects: merge(state.projects, result.projects),
        tasks: merge(state.tasks, result.tasks),
        subtasks: merge(state.subtasks, result.subtasks),
        milestones: merge(state.milestones, result.milestones),
      };
      const next = { ...hydrated, [kind]: merge(hydrated[kind] as Item[], [result.item]) } as WorkspaceData;
      dataRef.current = next;
      return next;
    });
    return result.item;
  }

  return { data, error, pending, reload, mutate, bulkTasks, convert, saveSettings, loadSearchItem };
}
