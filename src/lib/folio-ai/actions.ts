import {
  COLORS,
  IDEA_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Color,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/types";
import { REMINDER_TIMINGS, type ReminderTiming } from "@/lib/notifications";

export type ActionConfirmation = "none" | "destructive" | "bulk";

export interface ActionParamField {
  type: "string" | "boolean" | "date" | "datetime" | "number" | "text";
  label: string;
  required?: boolean;
  options?: string[];
}

export interface AIActionDefinition {
  id: string;
  label: string;
  description: string;
  confirmation: ActionConfirmation;
  fields: Record<string, ActionParamField>;
  validate(input: unknown): Record<string, unknown>;
}

class ActionValidationError extends Error {}
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const str = (input: Record<string, unknown>, key: string, max = 500, required = false): string => {
  const value = input[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new ActionValidationError(`“${key}” is required.`);
    return "";
  }
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f]/.test(value)) throw new ActionValidationError(`“${key}” must be text up to ${max} characters.`);
  return value.trim();
};
const bool = (input: Record<string, unknown>, key: string, fallback = false): boolean => {
  if (input[key] === undefined) return fallback;
  if (typeof input[key] !== "boolean") throw new ActionValidationError(`“${key}” must be true or false.`);
  return input[key];
};
const day = (value: unknown, key: string): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ActionValidationError(`“${key}” must be a valid YYYY-MM-DD date.`);
  return value;
};

export const DEPENDENT_REF_REGEX = /^\$(?:[0-9]+|(?:create_)?(?:project|task|idea)|convert_idea|last_project|last_task|last_idea|prev)(?:\.id)?$/i;

const uuid = (input: Record<string, unknown>, key: string, required = true): string => {
  const value = str(input, key, 80, required);
  if (!value) return "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) &&
    !DEPENDENT_REF_REGEX.test(value)
  ) {
    throw new ActionValidationError(`“${key}” is not a valid Folio identifier.`);
  }
  return value;
};
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T, key: string): T => {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new ActionValidationError(`“${key}” has an invalid value.`);
  return value as T;
};
const labelList = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.length > 24)) throw new ActionValidationError("Labels must be a list of short text values.");
  return [...new Set((value as string[]).map(item => item.trim().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean))].slice(0, 8);
};
const estimate = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 43_200) throw new ActionValidationError("Estimate must be a whole number of minutes (1–43200).");
  return value;
};
const numberRange = (value: unknown, key: string, min: number, max: number): number | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new ActionValidationError(`“${key}” must be a whole number from ${min} to ${max}.`);
  return value;
};
const stringList = (value: unknown, key: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new ActionValidationError(`“${key}” must be a list of text values.`);
  return value as string[];
};
const dateRange = (input: Record<string, unknown>, keyFrom: string, keyTo: string) => {
  const from = day(input[keyFrom], keyFrom);
  const to = day(input[keyTo], keyTo);
  if (from && to && from > to) throw new ActionValidationError(`“${keyFrom}” must be on or before “${keyTo}”.`);
  return { from, to };
};

function workspaceAction(id: string, label: string, description: string, confirmation: ActionConfirmation, fields: Record<string, ActionParamField>, validate: (input: unknown) => Record<string, unknown>): AIActionDefinition {
  return { id, label, description, confirmation, fields, validate };
}

export const FOLIO_AI_ACTIONS: readonly AIActionDefinition[] = [
  workspaceAction("create_project", "Create project", "Create a new project in the workspace.", "none", {
    name: { type: "string", label: "Project name", required: true },
    description: { type: "text", label: "Description" },
    status: { type: "string", label: "Status", options: PROJECT_STATUSES },
    priority: { type: "string", label: "Priority", options: PRIORITIES },
    category: { type: "string", label: "Category" },
    startDate: { type: "date", label: "Start date" },
    dueDate: { type: "date", label: "Due date" },
    color: { type: "string", label: "Color", options: COLORS },
    favorite: { type: "boolean", label: "Favorite" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    const startDate = day(value.startDate, "startDate");
    const dueDate = day(value.dueDate, "dueDate");
    if (startDate && dueDate && startDate > dueDate) throw new ActionValidationError("Start date must be on or before the due date.");
    return {
      name: str(value, "name", 100, true),
      description: str(value, "description", 4000),
      status: oneOf(value.status, PROJECT_STATUSES, "Planning", "status"),
      priority: oneOf(value.priority, PRIORITIES, "Medium", "priority"),
      category: str(value, "category", 50) || "Personal",
      startDate,
      dueDate,
      color: oneOf(value.color, COLORS, "violet", "color") as Color,
      favorite: bool(value, "favorite"),
    };
  }),

  workspaceAction("update_project", "Update project", "Edit project details, status, priority, or dates.", "none", {
    projectId: { type: "string", label: "Project ID", required: true },
    name: { type: "string", label: "Project name" },
    description: { type: "text", label: "Description" },
    status: { type: "string", label: "Status", options: PROJECT_STATUSES },
    priority: { type: "string", label: "Priority", options: PRIORITIES },
    category: { type: "string", label: "Category" },
    startDate: { type: "date", label: "Start date" },
    dueDate: { type: "date", label: "Due date" },
    favorite: { type: "boolean", label: "Favorite" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    const result: Record<string, unknown> = { projectId: uuid(value, "projectId") };
    if ("name" in value) result.name = str(value, "name", 100, true);
    if ("description" in value) result.description = str(value, "description", 4000);
    if ("status" in value) result.status = oneOf(value.status, PROJECT_STATUSES, "Planning", "status");
    if ("priority" in value) result.priority = oneOf(value.priority, PRIORITIES, "Medium", "priority");
    if ("category" in value) result.category = str(value, "category", 50);
    if ("startDate" in value) result.startDate = day(value.startDate, "startDate");
    if ("dueDate" in value) result.dueDate = day(value.dueDate, "dueDate");
    if ("favorite" in value) result.favorite = bool(value, "favorite");
    const start = ("startDate" in value ? result.startDate : null) as string | null;
    const due = ("dueDate" in value ? result.dueDate : null) as string | null;
    if (start && due && start > due) throw new ActionValidationError("Start date must be on or before the due date.");
    return result;
  }),

  workspaceAction("archive_project", "Archive project", "Archive a project. Tasks stay in My tasks.", "none", {
    projectId: { type: "string", label: "Project ID", required: true },
  }, (input) => ({ projectId: uuid(isObject(input) ? input : {}, "projectId"), archived: true })),
  workspaceAction("restore_project", "Restore project", "Restore an archived project.", "none", {
    projectId: { type: "string", label: "Project ID", required: true },
  }, (input) => ({ projectId: uuid(isObject(input) ? input : {}, "projectId"), archived: false })),
  workspaceAction("delete_project", "Delete project", "Permanently delete a project and its milestones. Tasks are kept as personal tasks.", "destructive", {
    projectId: { type: "string", label: "Project ID", required: true },
  }, (input) => ({ projectId: uuid(isObject(input) ? input : {}, "projectId") })),

  workspaceAction("create_task", "Create task", "Create a task, optionally in a project with a due date, priority, labels, and reminder.", "none", {
    title: { type: "string", label: "Task title", required: true },
    description: { type: "text", label: "Description" },
    notes: { type: "text", label: "Notes" },
    projectId: { type: "string", label: "Project ID" },
    milestoneId: { type: "string", label: "Milestone ID" },
    status: { type: "string", label: "Status", options: TASK_STATUSES },
    priority: { type: "string", label: "Priority", options: TASK_PRIORITIES },
    dueDate: { type: "date", label: "Due date" },
    startDate: { type: "date", label: "Start date" },
    labels: { type: "string", label: "Labels" },
    estimateMinutes: { type: "number", label: "Estimate (minutes)" },
    reminderEnabled: { type: "boolean", label: "Enable reminder" },
    reminderTiming: { type: "string", label: "Reminder timing", options: REMINDER_TIMINGS },
  }, (input) => {
    const value = isObject(input) ? input : {};
    const startDate = day(value.startDate, "startDate");
    const dueDate = day(value.dueDate, "dueDate");
    if (startDate && dueDate && startDate > dueDate) throw new ActionValidationError("Start date must be on or before the due date.");
    const reminderEnabled = bool(value, "reminderEnabled");
    return {
      title: str(value, "title", 200, true),
      description: str(value, "description", 4000),
      notes: str(value, "notes", 8000),
      projectId: value.projectId ? uuid(value, "projectId") : null,
      milestoneId: value.milestoneId ? uuid(value, "milestoneId") : null,
      status: oneOf(value.status, TASK_STATUSES, "todo", "status") as TaskStatus,
      priority: oneOf(value.priority, TASK_PRIORITIES, "Medium", "priority") as TaskPriority,
      dueDate,
      startDate,
      labels: labelList(value.labels),
      estimateMinutes: estimate(value.estimateMinutes),
      reminder: reminderEnabled
        ? {
            enabled: true,
            timing: oneOf(value.reminderTiming, REMINDER_TIMINGS, "1h_before", "reminderTiming") as ReminderTiming,
            dueTime: typeof value.dueTime === "string" ? value.dueTime : null,
            customLocal: typeof value.customLocal === "string" ? value.customLocal : null,
          }
        : { enabled: false, timing: "1h_before" as const, dueTime: null, customLocal: null },
    };
  }),
  workspaceAction("create_tasks", "Create multiple tasks", "Create several tasks from one instruction.", "bulk", {
    tasks: { type: "text", label: "Task definitions" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    const raw = value.tasks;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) throw new ActionValidationError("Provide a list of 1–20 tasks.");
    return { tasks: raw.map(item => FOLIO_AI_ACTIONS.find(action => action.id === "create_task")!.validate(item)) };
  }),
  workspaceAction("update_task", "Update task", "Edit a task's title, status, priority, dates, project, labels, or notes.", "none", {
    taskId: { type: "string", label: "Task ID", required: true },
    title: { type: "string", label: "Task title" },
    description: { type: "text", label: "Description" },
    notes: { type: "text", label: "Notes" },
    status: { type: "string", label: "Status", options: TASK_STATUSES },
    priority: { type: "string", label: "Priority", options: TASK_PRIORITIES },
    projectId: { type: "string", label: "Project ID" },
    milestoneId: { type: "string", label: "Milestone ID" },
    dueDate: { type: "date", label: "Due date" },
    startDate: { type: "date", label: "Start date" },
    labels: { type: "string", label: "Labels" },
    estimateMinutes: { type: "number", label: "Estimate (minutes)" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    const result: Record<string, unknown> = { taskId: uuid(value, "taskId") };
    if ("title" in value) result.title = str(value, "title", 200, true);
    if ("description" in value) result.description = str(value, "description", 4000);
    if ("notes" in value) result.notes = str(value, "notes", 8000);
    if ("status" in value) result.status = oneOf(value.status, TASK_STATUSES, "todo", "status") as TaskStatus;
    if ("priority" in value) result.priority = oneOf(value.priority, TASK_PRIORITIES, "Medium", "priority") as TaskPriority;
    if ("projectId" in value) result.projectId = value.projectId ? uuid(value, "projectId") : null;
    if ("milestoneId" in value) result.milestoneId = value.milestoneId ? uuid(value, "milestoneId") : null;
    if ("dueDate" in value) result.dueDate = day(value.dueDate, "dueDate");
    if ("startDate" in value) result.startDate = day(value.startDate, "startDate");
    if ("labels" in value) result.labels = labelList(value.labels);
    if ("estimateMinutes" in value) result.estimateMinutes = estimate(value.estimateMinutes);
    return result;
  }),
  workspaceAction("complete_task", "Complete task", "Mark a task as completed.", "none", {
    taskId: { type: "string", label: "Task ID", required: true },
  }, (input) => ({ taskId: uuid(isObject(input) ? input : {}, "taskId"), status: "done" })),
  workspaceAction("reopen_task", "Reopen task", "Reopen a completed task.", "none", {
    taskId: { type: "string", label: "Task ID", required: true },
  }, (input) => ({ taskId: uuid(isObject(input) ? input : {}, "taskId"), completed: false })),
  workspaceAction("delete_task", "Delete task", "Permanently delete a task.", "destructive", {
    taskId: { type: "string", label: "Task ID", required: true },
  }, (input) => ({ taskId: uuid(isObject(input) ? input : {}, "taskId") })),
  workspaceAction("delete_tasks", "Delete multiple tasks", "Permanently delete several tasks.", "destructive", {
    taskIds: { type: "string", label: "Task IDs" },
  }, (input) => {
    const ids = stringList(isObject(input) ? input.taskIds : undefined, "taskIds").map(id => uuid({ taskIds: id as string }, "taskIds"));
    if (ids.length === 0 || ids.length > 100) throw new ActionValidationError("Provide 1–100 task IDs.");
    return { taskIds: ids };
  }),

  workspaceAction("create_idea", "Create idea", "Capture an idea.", "none", {
    title: { type: "string", label: "Idea title", required: true },
    description: { type: "text", label: "Description" },
    category: { type: "string", label: "Category" },
    color: { type: "string", label: "Color", options: COLORS },
    status: { type: "string", label: "Status", options: IDEA_STATUSES },
  }, (input) => {
    const value = isObject(input) ? input : {};
    return { title: str(value, "title", 100, true), description: str(value, "description", 4000), category: str(value, "category", 50) || "Personal", color: oneOf(value.color, COLORS, "yellow", "color") as Color, status: oneOf(value.status, IDEA_STATUSES, "Just an idea", "status") };
  }),
  workspaceAction("update_idea", "Update idea", "Edit an idea.", "none", {
    ideaId: { type: "string", label: "Idea ID", required: true },
    title: { type: "string", label: "Idea title" },
    description: { type: "text", label: "Description" },
    status: { type: "string", label: "Status", options: IDEA_STATUSES },
    category: { type: "string", label: "Category" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    const result: Record<string, unknown> = { ideaId: uuid(value, "ideaId") };
    if ("title" in value) result.title = str(value, "title", 100, true);
    if ("description" in value) result.description = str(value, "description", 4000);
    if ("status" in value) result.status = oneOf(value.status, IDEA_STATUSES, "Just an idea", "status");
    if ("category" in value) result.category = str(value, "category", 50);
    return result;
  }),
  workspaceAction("delete_idea", "Delete idea", "Permanently delete an idea.", "destructive", {
    ideaId: { type: "string", label: "Idea ID", required: true },
  }, (input) => ({ ideaId: uuid(isObject(input) ? input : {}, "ideaId") })),
  workspaceAction("convert_idea", "Convert idea to project", "Turn an idea into a project.", "none", {
    ideaId: { type: "string", label: "Idea ID", required: true },
  }, (input) => ({ ideaId: uuid(isObject(input) ? input : {}, "ideaId") })),

  workspaceAction("search_workspace", "Search workspace", "Search projects, tasks, and ideas.", "none", {
    query: { type: "string", label: "Search query", required: true },
    scope: { type: "string", label: "Category" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    return { query: str(value, "query", 200, true), scope: oneOf(value.scope, ["all", "projects", "tasks", "ideas"] as const, "all", "scope") };
  }),
  workspaceAction("workspace_summary", "Workspace summary", "Summarize projects, tasks, overdue work, and today's priorities.", "none", {}, () => ({})),
  workspaceAction("task_report", "Task report", "Analyze task completion, overdue work, and workload patterns.", "none", {}, () => ({})),
  workspaceAction("project_report", "Project report", "Report project progress and health.", "none", {}, () => ({})),

  workspaceAction("list_calendar_events", "List calendar events", "List Google Calendar events for a date range.", "none", {
    from: { type: "date", label: "From" },
    to: { type: "date", label: "To" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    return dateRange(value, "from", "to");
  }),
  workspaceAction("create_calendar_event", "Create calendar event", "Create a Google Calendar event.", "none", {
    title: { type: "string", label: "Event title", required: true },
    description: { type: "text", label: "Description" },
    location: { type: "string", label: "Location" },
    calendarId: { type: "string", label: "Calendar ID" },
    start: { type: "datetime", label: "Start (ISO)" },
    end: { type: "datetime", label: "End (ISO)" },
    allDay: { type: "boolean", label: "All day" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    const allDay = bool(value, "allDay");
    const start = str(value, "start", 50, true);
    const end = str(value, "end", 50, true);
    if (allDay) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) throw new ActionValidationError("All-day events need start and end dates (end exclusive).");
    } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(end) || new Date(end) <= new Date(start)) {
      throw new ActionValidationError("Timed events need valid start and end datetimes, with the end after the start.");
    }
    return { title: str(value, "title", 300, true), description: str(value, "description", 8000), location: str(value, "location", 500), calendarId: str(value, "calendarId", 300) || "primary", start, end, allDay };
  }),
  workspaceAction("update_calendar_event", "Update calendar event", "Edit a Google Calendar event.", "none", {
    eventId: { type: "string", label: "Event ID", required: true },
    title: { type: "string", label: "Event title" },
    description: { type: "text", label: "Description" },
    location: { type: "string", label: "Location" },
    start: { type: "datetime", label: "Start (ISO)" },
    end: { type: "datetime", label: "End (ISO)" },
    allDay: { type: "boolean", label: "All day" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    const result: Record<string, unknown> = { eventId: uuid(value, "eventId") };
    if ("title" in value) result.title = str(value, "title", 300, true);
    if ("description" in value) result.description = str(value, "description", 8000);
    if ("location" in value) result.location = str(value, "location", 500);
    if ("start" in value) result.start = str(value, "start", 50, true);
    if ("end" in value) result.end = str(value, "end", 50, true);
    if ("allDay" in value) result.allDay = bool(value, "allDay");
    return result;
  }),
  workspaceAction("delete_calendar_event", "Delete calendar event", "Delete a Google Calendar event.", "destructive", {
    eventId: { type: "string", label: "Event ID", required: true },
  }, (input) => ({ eventId: uuid(isObject(input) ? input : {}, "eventId") })),

  workspaceAction("list_reminders", "List reminders", "List configured task reminders.", "none", {}, () => ({})),
  workspaceAction("create_reminder", "Create reminder", "Set or update a task reminder.", "none", {
    taskId: { type: "string", label: "Task ID", required: true },
    enabled: { type: "boolean", label: "Enabled" },
    timing: { type: "string", label: "Timing", options: REMINDER_TIMINGS },
    dueTime: { type: "string", label: "Due time (HH:MM)" },
    customLocal: { type: "datetime", label: "Custom date/time" },
  }, (input) => {
    const value = isObject(input) ? input : {};
    const enabled = value.enabled === undefined ? true : bool(value, "enabled");
    const timing = oneOf(value.timing, REMINDER_TIMINGS, "1h_before", "timing") as ReminderTiming;
    return { taskId: uuid(value, "taskId"), enabled, timing, dueTime: typeof value.dueTime === "string" ? value.dueTime : null, customLocal: timing === "custom" ? str(value, "customLocal", 40, true) : null };
  }),
  workspaceAction("cancel_reminder", "Cancel reminder", "Disable a task reminder.", "none", {
    taskId: { type: "string", label: "Task ID", required: true },
  }, (input) => ({ taskId: uuid(isObject(input) ? input : {}, "taskId"), enabled: false })),
  workspaceAction("delete_reminder", "Delete reminder", "Remove a task reminder configuration.", "none", {
    taskId: { type: "string", label: "Task ID", required: true },
  }, (input) => ({ taskId: uuid(isObject(input) ? input : {}, "taskId") })),
];

export const ACTION_BY_ID: Record<string, AIActionDefinition> = Object.fromEntries(FOLIO_AI_ACTIONS.map(action => [action.id, action]));

export function validateActionPlan(input: unknown): { id: string; params: Record<string, unknown> }[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 25) throw new ActionValidationError("Action plan must contain 1–25 actions.");
  return input.map((entry, index) => {
    if (!isObject(entry) || typeof entry.id !== "string") throw new ActionValidationError(`Action ${index + 1} is missing an id.`);
    const action = ACTION_BY_ID[entry.id];
    if (!action) throw new ActionValidationError(`Action “${entry.id}” is not supported by Folio AI.`);
    return { id: action.id, params: action.validate(entry.params) };
  });
}

export { ActionValidationError };
export const AI_ACTION_PLAN_OPEN = "[AI_ACTION_PLAN]";
export const AI_ACTION_PLAN_CLOSE = "[/AI_ACTION_PLAN]";

/** Extract an action plan from a local model reply, if present. */
export function extractActionPlan(content: string): { id: string; params: Record<string, unknown> }[] | null {
  const { repairAndExtractActionPlan } = require("@/lib/folio-ai/intent-pipeline");
  return repairAndExtractActionPlan(content);
}