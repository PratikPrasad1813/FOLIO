import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { googleEvents, tasks } from "@/db/schema";
import { getUser, sameOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Links a Folio task to an existing Google event (stable mapping by Google event ID). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const user = await getUser();
  const body = (await request.json().catch(() => null)) as { eventId?: unknown; taskId?: unknown } | null;
  const eventId = typeof body?.eventId === "string" && UUID.test(body.eventId) ? body.eventId : null;
  const taskId = typeof body?.taskId === "string" && UUID.test(body.taskId) ? body.taskId : null;
  if (!eventId || !taskId) return Response.json({ error: "Provide a valid event and task ID." }, { status: 400 });
  const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.userId, user.id), eq(tasks.id, taskId))).limit(1);
  if (!task) return Response.json({ error: "That task isn’t in your workspace." }, { status: 404 });
  const [event] = await db.select({ id: googleEvents.id }).from(googleEvents).where(and(eq(googleEvents.userId, user.id), eq(googleEvents.id, eventId))).limit(1);
  if (!event) return Response.json({ error: "That Google event isn’t in your workspace." }, { status: 404 });
  const [updated] = await db.update(googleEvents).set({ taskId, updatedAt: new Date() }).where(eq(googleEvents.id, eventId)).returning();
  return Response.json({ event: updated });
}

/** Removes the link. The Google event and the Folio task both stay. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const user = await getUser();
  const body = (await request.json().catch(() => null)) as { eventId?: unknown } | null;
  const eventId = typeof body?.eventId === "string" && UUID.test(body.eventId) ? body.eventId : null;
  if (!eventId) return Response.json({ error: "Provide a valid event ID." }, { status: 400 });
  const [updated] = await db.update(googleEvents).set({ taskId: null, updatedAt: new Date() }).where(and(eq(googleEvents.userId, user.id), eq(googleEvents.id, eventId))).returning();
  if (!updated) return Response.json({ error: "That Google event isn’t in your workspace." }, { status: 404 });
  return Response.json({ event: updated });
}
