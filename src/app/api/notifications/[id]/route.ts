import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notifications } from "@/db/schema";
import { requireUser, sameOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function countUnread(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.deliveryStatus, "delivered"),
        eq(notifications.read, false),
      ),
    );
  return Number(row?.count ?? 0);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }
  try {
    await ensureSchema();
    const user = await requireUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return Response.json({ error: "Invalid notification ID." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { read?: unknown };
    const nextRead = typeof body.read === "boolean" ? body.read : true;

    const [updated] = await db
      .update(notifications)
      .set({
        read: nextRead,
        readAt: nextRead ? new Date() : null,
      })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
      .returning();

    if (!updated) {
      return Response.json({ error: "Notification not found." }, { status: 404 });
    }

    const unreadCount = await countUnread(user.id);
    return Response.json({
      notification: {
        id: updated.id,
        read: updated.read,
        readAt: updated.readAt ? updated.readAt.toISOString() : null,
      },
      unreadCount,
    });
  } catch (error) {
    console.error("Failed to update notification:", error);
    return Response.json({ error: "Couldn’t update notification." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }
  try {
    await ensureSchema();
    const user = await requireUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return Response.json({ error: "Invalid notification ID." }, { status: 400 });
    }

    const [deleted] = await db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
      .returning({ id: notifications.id });

    if (!deleted) {
      return Response.json({ error: "Notification not found." }, { status: 404 });
    }

    const unreadCount = await countUnread(user.id);
    return Response.json({ deleted: true, unreadCount });
  } catch (error) {
    console.error("Failed to delete notification:", error);
    return Response.json({ error: "Couldn’t delete notification." }, { status: 500 });
  }
}
