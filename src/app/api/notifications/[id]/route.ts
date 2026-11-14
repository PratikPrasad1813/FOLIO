import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notifications } from "@/db/schema";
import { syncUser, corsJson, desktopCorsPreflight, unauthorized } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

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
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return corsJson(request, { error: "Invalid notification ID." }, 400);
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
      return corsJson(request, { error: "Notification not found." }, 404);
    }

    const unreadCount = await countUnread(user.id);
    return corsJson(request, {
      notification: {
        id: updated.id,
        read: updated.read,
        readAt: updated.readAt ? updated.readAt.toISOString() : null,
      },
      unreadCount,
    });
  } catch (error) {
    console.error("Failed to update notification:", error);
    return corsJson(request, { error: "Couldn’t update notification." }, 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return corsJson(request, { error: "Invalid notification ID." }, 400);
    }

    const [deleted] = await db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
      .returning({ id: notifications.id });

    if (!deleted) {
      return corsJson(request, { error: "Notification not found." }, 404);
    }

    const unreadCount = await countUnread(user.id);
    return corsJson(request, { deleted: true, unreadCount });
  } catch (error) {
    console.error("Failed to delete notification:", error);
    return corsJson(request, { error: "Couldn’t delete notification." }, 500);
  }
}
