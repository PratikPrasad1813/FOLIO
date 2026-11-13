import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notifications } from "@/db/schema";
import { requireUser, sameOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }
  try {
    await ensureSchema();
    const user = await requireUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

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

    return Response.json({ updated: updated.length, unreadCount: 0 });
  } catch (error) {
    console.error("Mark all read failed:", error);
    return Response.json(
      { error: "Couldn’t mark notifications as read." },
      { status: 500 },
    );
  }
}
