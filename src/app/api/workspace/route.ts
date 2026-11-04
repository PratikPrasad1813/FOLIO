import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, ideas, projects, tasks } from "@/db/schema";
import { getUser, publicUser, sameOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Input = Record<string, unknown>;
class InputError extends Error {}

function text(value: unknown, label: string, max = 200, required = false) {
  if (typeof value !== "string") { if (value == null && !required) return ""; throw new InputError(`Please enter a valid ${label}.`); }
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new InputError(`${label} must be ${required ? "1" : "0"}–${max} characters.`);
  return result;
}
function choice(value: unknown, choices: string[], fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !choices.includes(value)) throw new InputError("Please select a valid option.");
  return value;
}
function date(value: unknown) {
  if (!value) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new InputError("Please enter a valid date.");
  return value;
}
function bool(value: unknown) { if (typeof value !== "boolean") throw new InputError("Please enter a valid checkbox value."); return value; }
const colors = ["violet", "green", "peach", "blue", "yellow", "pink"];
const priorities = ["Low", "Medium", "High"];
function projectValues(data: Input, partial: boolean) {
  const v: Partial<typeof projects.$inferInsert> = {};
  if (!partial || "name" in data) v.name = text(data.name, "project name", 100, true);
  if (!partial || "description" in data) v.description = text(data.description, "description", 4000);
  if (!partial || "category" in data) v.category = text(data.category ?? "Personal", "category", 50);
  if (!partial || "status" in data) v.status = choice(data.status, ["Planning", "In progress", "On hold", "Completed"], "Planning");
  if (!partial || "priority" in data) v.priority = choice(data.priority, priorities, "Medium");
  if (!partial || "color" in data) v.color = choice(data.color, colors, "violet");
  if (!partial || "icon" in data) v.icon = choice(data.icon, ["layout", "smartphone", "pen", "code", "book", "megaphone", "heart", "coffee"], "layout");
  if (!partial || "dueDate" in data) v.dueDate = date(data.dueDate);
  if ("favorite" in data) v.favorite = bool(data.favorite);
  return v;
}
async function taskValues(data: Input, partial: boolean, userId: string) {
  const v: Partial<typeof tasks.$inferInsert> = {};
  if (!partial || "title" in data) v.title = text(data.title, "task title", 200, true);
  if (!partial || "description" in data) v.description = text(data.description, "description", 4000);
  if (!partial || "priority" in data) v.priority = choice(data.priority, priorities, "Medium");
  if (!partial || "dueDate" in data) v.dueDate = date(data.dueDate);
  if ("completed" in data) { v.completed = bool(data.completed); v.completedAt = v.completed ? new Date() : null; }
  if (!partial || "projectId" in data) {
    if (!data.projectId) v.projectId = null;
    else {
      if (typeof data.projectId !== "string" || !uuid.test(data.projectId)) throw new InputError("Select a valid project.");
      const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, data.projectId), eq(projects.userId, userId))).limit(1);
      if (!p) throw new InputError("That project is not in your workspace.");
      v.projectId = p.id;
    }
  }
  return v;
}
function ideaValues(data: Input, partial: boolean) {
  const v: Partial<typeof ideas.$inferInsert> = {};
  if (!partial || "title" in data) v.title = text(data.title, "idea title", 100, true);
  if (!partial || "description" in data) v.description = text(data.description, "description", 4000);
  if (!partial || "category" in data) v.category = text(data.category ?? "Personal", "category", 50);
  if (!partial || "color" in data) v.color = choice(data.color, colors, "yellow");
  if (!partial || "status" in data) v.status = choice(data.status, ["Just an idea", "Exploring", "Ready to start"], "Just an idea");
  return v;
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Please sign in to see your workspace." }, { status: 401 });
    const [projectList, taskList, ideaList, activityList] = await Promise.all([
      db.select().from(projects).where(eq(projects.userId, user.id)).orderBy(projects.createdAt),
      db.select().from(tasks).where(eq(tasks.userId, user.id)).orderBy(tasks.createdAt),
      db.select().from(ideas).where(eq(ideas.userId, user.id)).orderBy(desc(ideas.createdAt)),
      db.select().from(activities).where(eq(activities.userId, user.id)).orderBy(desc(activities.createdAt)).limit(30),
    ]);
    return Response.json({ user: publicUser(user), projects: projectList, tasks: taskList, ideas: ideaList, activities: activityList }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { console.error("Workspace load failed:", error); return Response.json({ error: "Your workspace couldn’t be loaded. Please try again." }, { status: 500 }); }
}

async function mutate(request: Request, method: "POST" | "PATCH" | "DELETE") {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Your session expired. Please refresh and sign in." }, { status: 401 });
    const body = await request.json();
    const { kind, id } = body;
    if (!["projects", "tasks", "ideas"].includes(kind)) throw new InputError("Unknown resource.");
    if (method !== "POST" && (typeof id !== "string" || !uuid.test(id))) throw new InputError("Invalid item ID.");
    const data: Input = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};

    const isConvertIdea =
      method === "POST" &&
      kind === "ideas" &&
      (body.action === "convert" || (body.data && typeof body.data === "object" && (body.data as Input).action === "convert"));

    if (isConvertIdea) {
      const ideaId = (typeof id === "string" && uuid.test(id))
        ? id
        : (typeof (body.data as Input)?.id === "string" && uuid.test((body.data as Input).id as string))
          ? (body.data as Input).id as string
          : "";
      if (!ideaId) throw new InputError("Invalid idea ID.");
      const result = await db.transaction(async tx => {
        const [idea] = await tx.select().from(ideas).where(and(eq(ideas.id, ideaId), eq(ideas.userId, user.id))).for("update");
        if (!idea) throw new InputError("That idea no longer exists.");
        const [item] = await tx.insert(projects).values({ userId: user.id, name: idea.title, description: idea.description, category: idea.category, color: idea.color, status: "Planning" }).returning();
<<<<<<< Updated upstream
        await tx.delete(ideas).where(eq(ideas.id, id));
        const [activity] = await tx.insert(activities).values({ userId: user.id, text: `Turned “${idea.title}” into a project`, type: "project" }).returning();
=======
        await tx.delete(ideas).where(eq(ideas.id, ideaId));
        const [activity] = await tx.insert(activities).values({ userId: user.id, projectId: item.id, text: `Turned ${quote(idea.title)} into a project`, type: "project" }).returning();
>>>>>>> Stashed changes
        return { item, activity };
      });
      return Response.json(result, { status: 201 });
    }

    let item;
    if (kind === "projects") {
      const condition = and(eq(projects.id, id || "00000000-0000-4000-8000-000000000000"), eq(projects.userId, user.id));
      if (method === "DELETE") [item] = await db.delete(projects).where(condition).returning();
      else if (method === "PATCH") { const values = projectValues(data, true); if (!Object.keys(values).length) throw new InputError("No changes to save."); [item] = await db.update(projects).set(values).where(condition).returning(); }
      else { const values = projectValues(data, false); [item] = await db.insert(projects).values({ ...values, name: values.name!, userId: user.id }).returning(); }
    } else if (kind === "tasks") {
      const condition = and(eq(tasks.id, id || "00000000-0000-4000-8000-000000000000"), eq(tasks.userId, user.id));
      if (method === "DELETE") [item] = await db.delete(tasks).where(condition).returning();
      else if (method === "PATCH") { const values = await taskValues(data, true, user.id); if (!Object.keys(values).length) throw new InputError("No changes to save."); [item] = await db.update(tasks).set(values).where(condition).returning(); }
      else { const values = await taskValues(data, false, user.id); [item] = await db.insert(tasks).values({ ...values, title: values.title!, userId: user.id }).returning(); }
    } else {
      const condition = and(eq(ideas.id, id || "00000000-0000-4000-8000-000000000000"), eq(ideas.userId, user.id));
      if (method === "DELETE") [item] = await db.delete(ideas).where(condition).returning();
      else if (method === "PATCH") { const values = ideaValues(data, true); if (!Object.keys(values).length) throw new InputError("No changes to save."); [item] = await db.update(ideas).set(values).where(condition).returning(); }
      else { const values = ideaValues(data, false); [item] = await db.insert(ideas).values({ ...values, title: values.title!, userId: user.id }).returning(); }
    }
    if (!item) return Response.json({ error: "This item was not found in your workspace." }, { status: 404 });
    const name = "name" in item ? item.name : item.title;
    const verb = method === "POST" ? "Created" : method === "DELETE" ? "Deleted" : kind === "tasks" && data.completed === true ? "Completed" : "Updated";
    const [activity] = await db.insert(activities).values({ userId: user.id, text: `${verb} “${name}”`, type: kind === "tasks" ? "task" : kind === "ideas" ? "idea" : "project" }).returning();
    return Response.json({ item, activity }, { status: method === "POST" ? 201 : 200 });
  } catch (error) {
    if (error instanceof InputError || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400 });
    console.error("Workspace mutation failed:", error);
    return Response.json({ error: "We couldn’t save that change. Please try again." }, { status: 500 });
  }
}
export async function POST(request: Request) { return mutate(request, "POST"); }
export async function PATCH(request: Request) { return mutate(request, "PATCH"); }
export async function DELETE(request: Request) { return mutate(request, "DELETE"); }
