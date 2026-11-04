"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Idea, Item, Resource, WorkspaceData } from "@/lib/types";

export function useWorkspace(notify: (message: string, tone?: "success" | "error") => void) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const dataRef = useRef(data);
  const pendingRef = useRef(new Set<string>());

  useEffect(() => {
    dataRef.current = data;
    }, [data]);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const result = await response.json();
      if (response.status === 401) { window.location.href = "/"; throw new Error("unauthenticated"); }
      if (!response.ok) throw new Error(result.error || "Could not load your workspace.");
      setData(result); dataRef.current = result; setError("");
    } catch (err) { const message = err instanceof Error ? err.message : "Couldn’t connect to your workspace."; setError(message); throw new Error(message); }
  }, []);
  useEffect(() => {
  let cancelled = false;

  async function loadWorkspace() {
    try {
      const response = await fetch("/api/workspace", {
        cache: "no-store",
      });

      const result = await response.json();

      if (response.status === 401) {
        window.location.href = "/";
        return;
      }

      if (!response.ok) {
        throw new Error(
          result.error || "Could not load your workspace."
        );
      }

      if (!cancelled) {
        dataRef.current = result;
        setData(result);
        setError("");
      }
    } catch (err) {
      if (!cancelled) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn’t connect to your workspace."
        );
      }
    }
  }

  void loadWorkspace();

  return () => {
    cancelled = true;
  };
  }, []);

<<<<<<< Updated upstream
  function markPending(id: string, value: boolean) { if (value) pendingRef.current.add(id); else pendingRef.current.delete(id); setPending(new Set(pendingRef.current)); }
=======
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void fetch("/api/auth/session", { method: "POST" }).catch(() => {}); }, 30 * 60_000);
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
>>>>>>> Stashed changes

  async function mutate(kind: Resource, method: "POST" | "PATCH" | "DELETE", values: Record<string, unknown> = {}, id?: string): Promise<Item> {
    const current = dataRef.current;
    if (!current) throw new Error("Your workspace is still loading.");
    const previous = (current[kind] as Item[]).find(item => item.id === id);
    if (id && pendingRef.current.has(id) && previous) return previous;
    const optimisticId = id || crypto.randomUUID();
    markPending(optimisticId, true);
    const newItem = { id: optimisticId, createdAt: new Date().toISOString(), description: "", status: kind === "ideas" ? "Just an idea" : "Planning", priority: "Medium", color: "violet", icon: "layout", category: "Personal", dueDate: null, favorite: false, completed: false, completedAt: null, projectId: null, ...values } as unknown as Item;
    setData(state => {
      if (!state) return state;
      const list = state[kind] as Item[];
      const next = method === "POST" ? [newItem, ...list] : method === "DELETE" ? list.filter(item => item.id !== id) : list.map(item => item.id === id ? { ...item, ...values } : item);
      return { ...state, [kind]: next } as WorkspaceData;
    });
    try {
      const response = await fetch("/api/workspace", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, data: values }) });
      const result = await response.json();
      if (response.status === 401) { window.location.href = "/"; throw new Error("Your session ended. Please sign in again."); }
      if (!response.ok) throw new Error(result.error || "Could not save your change.");
      setData(state => {
        if (!state) return state;
        const next = method === "DELETE" ? (state[kind] as Item[]).filter(item => item.id !== id) : (state[kind] as Item[]).map(item => item.id === optimisticId ? result.item : item);
        const updated = { ...state, [kind]: next, activities: [result.activity, ...state.activities].slice(0, 30) } as WorkspaceData;
        if (method === "DELETE" && kind === "projects") updated.tasks = state.tasks.map(task => task.projectId === id ? { ...task, projectId: null } : task);
        return updated;
      });
      const label = kind === "projects" ? "Project" : kind === "tasks" ? "Task" : "Idea";
      if (method === "POST") notify(`${label} created. A little momentum starts here.`);
      else if (method === "DELETE") notify(`${label} deleted.`);
      else if (kind === "tasks" && typeof values.completed === "boolean") notify(values.completed ? "One more little win. Task complete!" : "Task moved back to your to-do list.");
      else if ("favorite" in values) notify(values.favorite ? "Added to your favorites." : "Removed from favorites.");
      else notify("Changes saved. Looking good.");
      return result.item;
    } catch (err) {
      setData(state => {
        if (!state) return state;
        const list = state[kind] as Item[];
        const restored = method === "POST" ? list.filter(item => item.id !== optimisticId) : method === "DELETE" && previous ? [...list, previous] : list.map(item => item.id === id && previous ? previous : item);
        return { ...state, [kind]: restored } as WorkspaceData;
      });
      const message = err instanceof Error ? err.message : "Your change couldn’t be saved. Please try again.";
      notify(message, "error"); throw new Error(message);
    } finally { markPending(optimisticId, false); }
  }

  async function convert(idea: Idea) {
    markPending(idea.id, true);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "ideas", action: "convert", id: idea.id }) });
      const result = await response.json();
      if (response.status === 401) { window.location.href = "/"; throw new Error("Your session ended. Please sign in again."); }
      if (!response.ok) throw new Error(result.error || "Couldn’t turn this idea into a project.");
      setData(state => state ? { ...state, projects: [result.item, ...state.projects], ideas: state.ideas.filter(item => item.id !== idea.id), activities: [result.activity, ...state.activities].slice(0, 30) } : state);
      notify("From a little spark to a real project. Let’s go!");
      return result.item;
    } catch (err) { const message = err instanceof Error ? err.message : "Could not create the project."; notify(message, "error"); throw new Error(message); } finally { markPending(idea.id, false); }
  }

  async function saveSettings(values: { name: string; weeklyGoal: number }) {
    const response = await fetch("/api/auth", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const result = await response.json();
    if (response.status === 401) { window.location.href = "/"; throw new Error("Your session ended. Please sign in again."); }
    if (!response.ok) throw new Error(result.error || "Could not save your settings.");
    setData(state => state ? { ...state, user: result.user } : state);
    notify("Your workspace feels a little more like you.");
  }

  return { data, error, pending, reload, mutate, convert, saveSettings };
}
