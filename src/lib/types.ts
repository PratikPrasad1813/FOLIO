import { regionalPreferences, regionalTimezone, regionalDate } from "@/lib/personalization";
import type { PersonalPreferences } from "@/lib/personalization";
export type Color = "violet" | "green" | "peach" | "blue" | "yellow" | "pink";
export type ProjectStatus = "Planning" | "In progress" | "On hold" | "Completed";
export type Priority = "Low" | "Medium" | "High";
export type Resource = "projects" | "tasks" | "ideas" | "milestones" | "subtasks";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export type TaskPriority = "Urgent" | "High" | "Medium" | "Low" | "None";
export type View = "overview" | "projects" | "tasks" | "ideas" | "calendar" | "ai" | "settings";
export interface User { id: string; name: string; email: string; provider: string; weeklyGoal: number; personal?: PersonalPreferences; greetingName?: string; onboardingCompleted: boolean; emailVerified?: boolean; guideDismissed?: boolean; hasPassword?: boolean; timezone?: string }
export interface Project { id: string; name: string; description: string; status: ProjectStatus; priority: Priority; color: Color; icon: string; category: string; startDate: string | null; dueDate: string | null; favorite: boolean; archived: boolean; createdAt: string; updatedAt: string }
export interface Task { id: string; title: string; description: string; projectId: string | null; milestoneId: string | null; status: TaskStatus; completed: boolean; priority: TaskPriority; startDate: string | null; dueDate: string | null; labels: string[]; estimateMinutes: number | null; notes: string; completedAt: string | null; createdAt: string; updatedAt: string }
export interface Subtask { id: string; taskId: string; title: string; completed: boolean; completedAt: string | null; position: number; createdAt: string }
export interface Idea { id: string; title: string; description: string; color: Color; category: string; status: string; createdAt: string }
export interface Milestone { id: string; projectId: string; title: string; description: string; dueDate: string | null; completed: boolean; completedAt: string | null; createdAt: string }
export interface Activity { id: string; text: string; type: string; projectId: string | null; taskId: string | null; createdAt: string }
export interface WorkspaceData { user: User; projects: Project[]; tasks: Task[]; subtasks: Subtask[]; ideas: Idea[]; milestones: Milestone[]; activities: Activity[] }
export type Item = Project | Task | Idea | Milestone | Subtask;
export const COLORS: Color[] = ["violet", "green", "peach", "blue", "yellow", "pink"];
export const PRIORITIES: Priority[] = ["High", "Medium", "Low"];
export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "done"];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", in_review: "In review", done: "Completed" };
export const TASK_PRIORITIES: TaskPriority[] = ["Urgent", "High", "Medium", "Low", "None"];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { Urgent: "Urgent", High: "High", Medium: "Medium", Low: "Low", None: "No priority" };
export const PROJECT_STATUSES: ProjectStatus[] = ["Planning", "In progress", "On hold", "Completed"];
export const STATUS_LABELS: Record<ProjectStatus, string> = { Planning: "Planned", "In progress": "In progress", "On hold": "On hold", Completed: "Completed" };
export const IDEA_STATUSES = ["Just an idea", "Exploring", "Ready to start"];
export function statusLabel(status: string): string { return STATUS_LABELS[status as ProjectStatus] ?? status; }
export function dateKey(date: Date = new Date()): string {
  const tz = regionalTimezone();
  if (tz) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const part = (type: string) => parts.find(p => p.type === type)?.value; return `${part("year")}-${part("month")}-${part("day")}`; }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
export function formatDate(date: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!date) return "No due date";
  const [y,m,d] = date.slice(0,10).split("-");
  const format = regionalPreferences().dateFormat;
  if (!options && format !== "readable") return format === "ymd" ? `${y}-${m}-${d}` : format === "dmy" ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
  return new Intl.DateTimeFormat(regionalPreferences().locale, { ...(options || { month: "short", day: "numeric" }), timeZone: "UTC" }).format(new Date(`${date.slice(0,10)}T12:00:00Z`));
}
export function initials(name: string): string { return name.split(" ").filter(Boolean).map(n => n[0]).slice(0, 2).join("").toUpperCase(); }
export function projectProgress(projectId: string, tasks: Task[]): { total: number; done: number; percent: number } { const list = tasks.filter(t => t.projectId === projectId); const done = list.filter(t => t.completed).length; return { total: list.length, done, percent: list.length ? Math.round(done / list.length * 100) : 0 }; }
export function milestoneProgress(milestone: Milestone, tasks: Task[]): { total: number; done: number; percent: number } { const list = tasks.filter(t => t.milestoneId === milestone.id); const done = list.filter(t => t.completed).length; return { total: list.length, done, percent: milestone.completed ? 100 : list.length ? Math.round(done / list.length * 100) : 0 }; }
/** Whole days from `from` to `to` (both YYYY-MM-DD), timezone-safe. */
export function daysBetween(from: string, to: string): number { return Math.round((new Date(`${to.slice(0, 10)}T12:00:00`).getTime() - new Date(`${from.slice(0, 10)}T12:00:00`).getTime()) / 86_400_000); }
export function relativeDay(due: string, today: string = dateKey()): string { const diff = daysBetween(today, due); if (diff === 0) return "Today"; if (diff === 1) return "Tomorrow"; if (diff === -1) return "Yesterday"; if (diff < 0) return `${Math.abs(diff)}d overdue`; if (diff < 7) return `in ${diff} days`; if (diff < 14) return "next week"; if (diff < 60) return `in ${Math.round(diff / 7)} weeks`; return `in ${Math.round(diff / 30)} months`; }
export function timeAgo(date: string, now: number = Date.now()): string { const minutes = Math.floor((now - new Date(date).getTime()) / 60000); if (minutes < 1) return "just now"; if (minutes < 60) return `${minutes}m ago`; if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`; const days = Math.floor(minutes / 1440); if (days === 1) return "yesterday"; if (days < 30) return `${days}d ago`; return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
