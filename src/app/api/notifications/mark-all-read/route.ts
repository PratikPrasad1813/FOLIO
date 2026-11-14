import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notifications } from "@/db/schema";
import { corsJson, desktopCorsPreflight, syncUser, unauthorized } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    const updated = await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.deliveryStatus, "delivered"),
          eq(notifications.read, false),
        ),
      )
      .returning({ id: notifications.id });

    return corsJson(request, { updated: updated.length, unreadCount: 0 });
  } catch (error) {
    console.error("Mark all read failed:", error);
    return corsJson(
      request,
      { error: "Couldn’t mark notifications as read." },
      500,
    );
  }
}
