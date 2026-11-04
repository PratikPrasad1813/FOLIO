import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ideas, milestones, projects, subtasks, tasks } from "@/db/schema";
import { privateJson, searchError, searchUser } from "@/lib/search-http";
import { searchScope, SearchInputError, UUID_PATTERN } from "@/lib/search-types";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await searchUser(request);
    const params = new URL(request.url).searchParams;
    const kind = searchScope(params.get("kind"));
    const id = params.get("id");
    if (kind === "all" || !id || !UUID_PATTERN.test(id)) throw new SearchInputError("Choose a valid workspace item.");
    const table = kind === "tasks" ? tasks : kind === "projects" ? projects : ideas;
    const [item] = await db.select().from(table).where(and(eq(table.userId, user.id), eq(table.id, id))).limit(1);
    if (!item) throw new SearchInputError("This item was removed or is no longer accessible.", 404);
    // Hydrate existing drawers/workspaces, never invent new routes. Bounded
    // child data complements (rather than replaces) Folio's workspace cache.
    const projectId = kind === "projects" ? id : "projectId" in item ? item.projectId : null;
    const [steps, checkpoints, relatedProjects, relatedTasks] = await Promise.all([
      kind === "tasks" ? db.select().from(subtasks).where(and(eq(subtasks.userId, user.id), eq(subtasks.taskId, id))).orderBy(subtasks.position).limit(500) : [],
      projectId ? db.select().from(milestones).where(and(eq(milestones.userId, user.id), eq(milestones.projectId, projectId))).limit(500) : [],
      projectId && kind === "tasks" ? db.select().from(projects).where(and(eq(projects.userId, user.id), eq(projects.id, projectId))).limit(1) : [],
      kind === "projects" ? db.select().from(tasks).where(and(eq(tasks.userId, user.id), eq(tasks.projectId, id))).orderBy(tasks.createdAt, tasks.id).limit(500) : [],
    ]);
    return privateJson({ kind, item, subtasks: steps, milestones: checkpoints, projects: relatedProjects, tasks: relatedTasks });
  } catch (error) { return searchError(error); }
}
