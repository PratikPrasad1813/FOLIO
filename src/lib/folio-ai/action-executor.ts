import { getZonedParts } from "@/lib/timezone";
import { ACTION_BY_ID, DEPENDENT_REF_REGEX, type AIActionDefinition } from "@/lib/folio-ai/actions";
import type { AIActionResult } from "@/lib/folio-ai/types";
import { formatDate, type Project, type Task } from "@/lib/types";

type User = { id: string };

class ActionExecutionError extends Error {}

async function internalApi(request: Request, path: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET", body?: unknown) {
  const reqUrl = new URL(request.url);
  const origin = request.headers.get("origin") || reqUrl.origin;
  const cookie = request.headers.get("cookie");
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: origin };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${reqUrl.origin}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ActionExecutionError((data as { error?: string }).error || `Folio API returned ${response.status}.`);
  return data;
}

async function workspaceMutation(request: Request, kind: string, method: "POST" | "PATCH" | "DELETE", id?: string, data?: Record<string, unknown>, extraBody?: Record<string, unknown>) {
  return internalApi(request, "/api/workspace", method, {
    kind,
    ...(id ? { id } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(extraBody ?? {}),
  });
}

function summarizeWorkspace(projects: Project[], tasks: Task[], date: string) {
  const today = date;
  const overdue = tasks.filter(task => !task.completed && !!task.dueDate && task.dueDate < today);
  const dueToday = tasks.filter(task => !task.completed && task.dueDate === today);
  const done = tasks.filter(task => task.completed).length;
  const completionRate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const inProgress = projects.filter(project => project.status === "In progress" && !project.archived);
  const activeProjects = projects.filter(project => !project.archived);
  return {
    projects: activeProjects.length,
    inProgressProjects: inProgress.length,
    tasks: tasks.length,
    completedTasks: done,
    openTasks: tasks.length - done,
    overdueTasks: overdue.length,
    dueToday: dueToday.length,
    completionRate,
    overdueExamples: overdue.slice(0, 5).map(task => ({ id: task.id, title: task.title, dueDate: task.dueDate })),
    dueTodayExamples: dueToday.slice(0, 5).map(task => ({ id: task.id, title: task.title })),
  };
}

interface WorkflowExecutionContext {
  lastCreatedProjectId?: string;
  lastCreatedProjectName?: string;
  lastCreatedTaskId?: string;
  lastCreatedIdeaId?: string;
  failedActionIds: Set<string>;
}

async function executeWorkspaceAction(
  request: Request,
  action: AIActionDefinition,
  params: Record<string, unknown>,
  ctx: WorkflowExecutionContext,
): Promise<AIActionResult> {
  switch (action.id) {
    case "create_project": {
      const result = await workspaceMutation(request, "projects", "POST", undefined, params);
      const projectId = result.item.id as string;
      const projectName = result.item.name as string;
      ctx.lastCreatedProjectId = projectId;
      ctx.lastCreatedProjectName = projectName;
      return { actionId: action.id, ok: true, summary: `Created project “${projectName}”.`, result: { id: projectId, name: projectName } };
    }
    case "update_project": {
      const { projectId, ...data } = params;
      const result = await workspaceMutation(request, "projects", "PATCH", projectId as string, data);
      return { actionId: action.id, ok: true, summary: `Updated project “${result.item.name}”.`, result: { id: result.item.id, name: result.item.name } };
    }
    case "archive_project":
    case "restore_project": {
      const result = await workspaceMutation(request, "projects", "PATCH", params.projectId as string, { archived: params.archived });
      return { actionId: action.id, ok: true, summary: result.item.archived ? `Archived “${result.item.name}”.` : `Restored “${result.item.name}”.`, result: { id: result.item.id } };
    }
    case "delete_project": {
      const result = await workspaceMutation(request, "projects", "DELETE", params.projectId as string);
      return { actionId: action.id, ok: true, summary: `Deleted project “${result.item.name}”.`, result: { deleted: true } };
    }
    case "create_task": {
      const { reminder, ...data } = params;
      const result = await workspaceMutation(request, "tasks", "POST", undefined, data);
      const taskId = result.item.id as string;
      ctx.lastCreatedTaskId = taskId;
      const summary = ctx.lastCreatedProjectName
        ? `Created task “${result.item.title}” in “${ctx.lastCreatedProjectName}”.`
        : `Created task “${result.item.title}”.`;
      return { actionId: action.id, ok: true, summary, result: { id: taskId, title: result.item.title } };
    }
    case "create_tasks": {
      const created: { id: string; title: string }[] = [];
      const failed: { title: string; error: string }[] = [];
      const rawTasks = (params.tasks as Record<string, unknown>[]) || [];

      for (const rawTaskParams of rawTasks) {
        const taskParams = { ...rawTaskParams };
        if (
          (!taskParams.projectId || DEPENDENT_REF_REGEX.test(String(taskParams.projectId))) &&
          ctx.lastCreatedProjectId
        ) {
          taskParams.projectId = ctx.lastCreatedProjectId;
        }

        try {
          const result = await workspaceMutation(request, "tasks", "POST", undefined, taskParams);
          created.push({ id: result.item.id, title: result.item.title });
          ctx.lastCreatedTaskId = result.item.id;
        } catch (err) {
          failed.push({
            title: String(taskParams.title || "Untitled task"),
            error: err instanceof Error ? err.message : "Failed to create task",
          });
        }
      }

      if (created.length === 0 && failed.length > 0) {
        throw new ActionExecutionError(`Failed to create tasks: ${failed.map(f => `“${f.title}”: ${f.error}`).join("; ")}`);
      }

      const projectRef = ctx.lastCreatedProjectName ? ` in “${ctx.lastCreatedProjectName}”` : "";
      if (failed.length === 0) {
        return {
          actionId: action.id,
          ok: true,
          summary: `Created ${created.length} tasks${projectRef}.`,
          result: { created, count: created.length },
        };
      }

      return {
        actionId: action.id,
        ok: true,
        summary: `Created ${created.length} of ${rawTasks.length} tasks${projectRef}. ${failed.length} failed (${failed.map(f => `“${f.title}”: ${f.error}`).join("; ")}).`,
        result: { created, failed, partialSuccess: true },
      };
    }
    case "update_task": {
      const { taskId, ...data } = params;
      const result = await workspaceMutation(request, "tasks", "PATCH", taskId as string, data);
      return { actionId: action.id, ok: true, summary: `Updated task “${result.item.title}”.`, result: { id: result.item.id, title: result.item.title } };
    }
    case "complete_task": {
      const result = await workspaceMutation(request, "tasks", "PATCH", params.taskId as string, { status: "done" });
      return { actionId: action.id, ok: true, summary: `Completed task “${result.item.title}”.`, result: { id: result.item.id, title: result.item.title } };
    }
    case "reopen_task": {
      const result = await workspaceMutation(request, "tasks", "PATCH", params.taskId as string, { completed: false });
      return { actionId: action.id, ok: true, summary: `Reopened task “${result.item.title}”.`, result: { id: result.item.id, title: result.item.title } };
    }
    case "delete_task": {
      const result = await workspaceMutation(request, "tasks", "DELETE", params.taskId as string);
      return { actionId: action.id, ok: true, summary: `Deleted task “${result.item.title}”.`, result: { deleted: true } };
    }
    case "delete_tasks": {
      const ids = params.taskIds as string[];
      const result = await internalApi(request, "/api/workspace", "DELETE", { kind: "tasks", ids });
      const count = result.deleted?.length ?? ids.length;
      return { actionId: action.id, ok: true, summary: `Deleted ${count} tasks.`, result: { deleted: count } };
    }
    case "create_idea": {
      const result = await workspaceMutation(request, "ideas", "POST", undefined, params);
      ctx.lastCreatedIdeaId = result.item.id as string;
      return { actionId: action.id, ok: true, summary: `Captured idea “${result.item.title}”.`, result: { id: result.item.id } };
    }
    case "update_idea": {
      const { ideaId, ...data } = params;
      const result = await workspaceMutation(request, "ideas", "PATCH", ideaId as string, data);
      return { actionId: action.id, ok: true, summary: `Updated idea “${result.item.title}”.`, result: { id: result.item.id } };
    }
    case "delete_idea": {
      const result = await workspaceMutation(request, "ideas", "DELETE", params.ideaId as string);
      return { actionId: action.id, ok: true, summary: `Deleted idea “${result.item.title}”.`, result: { deleted: true } };
    }
    case "convert_idea": {
      const result = await workspaceMutation(
        request,
        "ideas",
        "POST",
        params.ideaId as string,
        { action: "convert", id: params.ideaId },
        { action: "convert" },
      );
      ctx.lastCreatedProjectId = result.item.id as string;
      ctx.lastCreatedProjectName = result.item.name as string;
      return { actionId: action.id, ok: true, summary: `Converted idea into project “${result.item.name}”.`, result: { id: result.item.id, name: result.item.name } };
    }
    case "search_workspace": {
      const paramsObj = new URLSearchParams({ q: params.query as string, scope: params.scope as string, limit: "8" });
      const result = await internalApi(request, `/api/search?${paramsObj.toString()}`);
      const total = result.groups?.reduce((sum: number, group: { items: unknown[] }) => sum + group.items.length, 0) ?? 0;
      return { actionId: action.id, ok: true, summary: `Found ${total} matching ${params.scope === "tasks" ? "tasks" : params.scope === "projects" ? "projects" : params.scope === "ideas" ? "ideas" : "items"}.`, result };
    }
    case "workspace_summary": {
      const workspace = await internalApi(request, "/api/workspace");
      const summary = summarizeWorkspace(workspace.projects ?? [], workspace.tasks ?? [], getZonedParts(new Date(), workspace.user?.timezone || "UTC").dateKey);
      return { actionId: action.id, ok: true, summary: "Workspace summary prepared.", result: summary };
    }
    case "task_report": {
      const workspace = await internalApi(request, "/api/workspace");
      const tasksList: Task[] = workspace.tasks ?? [];
      const today = getZonedParts(new Date(), workspace.user?.timezone || "UTC").dateKey;
      const byStatus = Object.fromEntries(["todo", "in_progress", "in_review", "done"].map(status => [status, tasksList.filter(t => t.status === status).length]));
      const byPriority = Object.fromEntries(["Urgent", "High", "Medium", "Low", "None"].map(priority => [priority, tasksList.filter(t => t.priority === priority).length]));
      const overdue = tasksList.filter(t => !t.completed && !!t.dueDate && t.dueDate < today);
      return {
        actionId: action.id, ok: true,
        summary: "Task report prepared.",
        result: { total: tasksList.length, byStatus, byPriority, overdue: overdue.length, completionRate: tasksList.length ? Math.round(tasksList.filter(t => t.completed).length / tasksList.length * 100) : 0 },
      };
    }
    case "project_report": {
      const workspace = await internalApi(request, "/api/workspace");
      const projectsList: Project[] = workspace.projects ?? [];
      const tasksList: Task[] = workspace.tasks ?? [];
      const today = getZonedParts(new Date(), workspace.user?.timezone || "UTC").dateKey;
      const report = projectsList.filter(p => !p.archived).map(project => {
        const projectTasks = tasksList.filter(t => t.projectId === project.id);
        const done = projectTasks.filter(t => t.completed).length;
        return {
          id: project.id, name: project.name, status: project.status,
          progress: projectTasks.length ? Math.round((done / projectTasks.length) * 100) : 0,
          overdueTasks: projectTasks.filter(t => !t.completed && !!t.dueDate && t.dueDate < today).length,
          dueDate: project.dueDate ? formatDate(project.dueDate) : null,
        };
      });
      return { actionId: action.id, ok: true, summary: "Project report prepared.", result: report };
    }
    default:
      throw new ActionExecutionError(`Action “${action.id}” is not supported.`);
  }
}

async function executeCalendarAction(request: Request, action: AIActionDefinition, params: Record<string, unknown>): Promise<AIActionResult> {
  switch (action.id) {
    case "list_calendar_events": {
      const from = (params.from as string) ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const to = (params.to as string) ?? new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      const result = await internalApi(request, `/api/integrations/google/events?from=${from}&to=${to}`);
      const events = result.events ?? [];
      return { actionId: action.id, ok: true, summary: `Found ${events.length} calendar event${events.length === 1 ? "" : "s"}.`, result: { events: events.slice(0, 20) } };
    }
    case "create_calendar_event": {
      const result = await internalApi(request, "/api/integrations/google/events", "POST", params);
      return { actionId: action.id, ok: true, summary: `Created calendar event “${result.event?.title ?? params.title}”.`, result: { id: result.event?.id } };
    }
    case "update_calendar_event": {
      const { eventId, ...data } = params;
      const result = await internalApi(request, `/api/integrations/google/events/${eventId}`, "PATCH", data);
      return { actionId: action.id, ok: true, summary: `Updated calendar event “${result.event?.title ?? ""}”.`, result: { id: result.event?.id } };
    }
    case "delete_calendar_event": {
      const result = await internalApi(request, `/api/integrations/google/events/${params.eventId}`, "DELETE");
      return { actionId: action.id, ok: true, summary: "Deleted calendar event.", result: { deleted: true } };
    }
    default:
      throw new ActionExecutionError(`Calendar action “${action.id}” is not supported.`);
  }
}

async function executeReminderAction(request: Request, action: AIActionDefinition, params: Record<string, unknown>): Promise<AIActionResult> {
  switch (action.id) {
    case "list_reminders": {
      const result = await internalApi(request, "/api/notifications/reminders");
      return { actionId: action.id, ok: true, summary: `Found ${(result.reminders ?? []).length} task reminder${(result.reminders ?? []).length === 1 ? "" : "s"}.`, result: result.reminders ?? [] };
    }
    case "create_reminder":
    case "cancel_reminder": {
      const result = await internalApi(request, "/api/notifications/reminders", "PUT", params);
      return { actionId: action.id, ok: true, summary: params.enabled === false ? "Reminder disabled." : "Reminder saved.", result: { id: result.reminder?.id } };
    }
    case "delete_reminder": {
      await internalApi(request, `/api/notifications/reminders?taskId=${encodeURIComponent(params.taskId as string)}`, "DELETE");
      return { actionId: action.id, ok: true, summary: "Reminder removed.", result: { deleted: true } };
    }
    default:
      throw new ActionExecutionError(`Reminder action “${action.id}” is not supported.`);
  }
}

export async function executeAIActions(
  _user: User,
  actions: { id: string; params: Record<string, unknown> }[],
  request: Request,
): Promise<AIActionResult[]> {
  const results: AIActionResult[] = [];
  const ctx: WorkflowExecutionContext = {
    failedActionIds: new Set<string>(),
  };

  for (const entry of actions) {
    const action = ACTION_BY_ID[entry.id];
    if (!action) {
      results.push({ actionId: entry.id, ok: false, summary: `Action “${entry.id}” is not supported.`, error: "Unsupported action." });
      ctx.failedActionIds.add(entry.id);
      continue;
    }

    const resolvedParams = { ...entry.params };

    // Resolve dependent project references
    if (entry.id === "create_task" || entry.id === "create_tasks") {
      const rawPid = resolvedParams.projectId ? String(resolvedParams.projectId) : "";
      if (rawPid && DEPENDENT_REF_REGEX.test(rawPid)) {
        if (ctx.failedActionIds.has("create_project")) {
          results.push({
            actionId: entry.id,
            ok: false,
            summary: "Skipped: prerequisite project creation failed.",
            error: "Prerequisite create_project failed.",
          });
          continue;
        }
        if (ctx.lastCreatedProjectId) {
          resolvedParams.projectId = ctx.lastCreatedProjectId;
        }
      } else if (!rawPid && ctx.lastCreatedProjectId) {
        resolvedParams.projectId = ctx.lastCreatedProjectId;
      }
    }

    // Resolve dependent task references
    if (entry.id === "create_reminder" || entry.id === "update_task" || entry.id === "complete_task") {
      const rawTid = resolvedParams.taskId ? String(resolvedParams.taskId) : "";
      if (rawTid && DEPENDENT_REF_REGEX.test(rawTid)) {
        if (ctx.failedActionIds.has("create_task") || ctx.failedActionIds.has("create_tasks")) {
          results.push({
            actionId: entry.id,
            ok: false,
            summary: "Skipped: prerequisite task creation failed.",
            error: "Prerequisite task creation failed.",
          });
          continue;
        }
        if (ctx.lastCreatedTaskId) {
          resolvedParams.taskId = ctx.lastCreatedTaskId;
        }
      } else if (!rawTid && ctx.lastCreatedTaskId) {
        resolvedParams.taskId = ctx.lastCreatedTaskId;
      }
    }

    // Resolve dependent idea references
    if (entry.id === "convert_idea" || entry.id === "update_idea" || entry.id === "delete_idea") {
      const rawIid = resolvedParams.ideaId ? String(resolvedParams.ideaId) : "";
      if (rawIid && DEPENDENT_REF_REGEX.test(rawIid)) {
        if (ctx.failedActionIds.has("create_idea")) {
          results.push({
            actionId: entry.id,
            ok: false,
            summary: "Skipped: prerequisite idea creation failed.",
            error: "Prerequisite create_idea failed.",
          });
          continue;
        }
        if (ctx.lastCreatedIdeaId) {
          resolvedParams.ideaId = ctx.lastCreatedIdeaId;
        }
      }
    }

    try {
      if (action.id.startsWith("create_calendar") || action.id.startsWith("update_calendar") || action.id.startsWith("delete_calendar") || action.id.startsWith("list_calendar")) {
        results.push(await executeCalendarAction(request, action, resolvedParams));
      } else if (action.id.startsWith("create_reminder") || action.id.startsWith("cancel_reminder") || action.id.startsWith("delete_reminder") || action.id.startsWith("list_reminders")) {
        results.push(await executeReminderAction(request, action, resolvedParams));
      } else {
        results.push(await executeWorkspaceAction(request, action, resolvedParams, ctx));
      }
    } catch (error) {
      ctx.failedActionIds.add(action.id);
      results.push({
        actionId: action.id,
        ok: false,
        summary: error instanceof Error ? error.message : `Action “${action.id}” failed.`,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return results;
}
