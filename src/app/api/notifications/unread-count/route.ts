import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notifications } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { maybeProcessUserReminders } from "@/lib/reminder-processor";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    const user = await getUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

    await maybeProcessUserReminders(user.id);

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.deliveryStatus, "delivered"),
          eq(notifications.read, false),
        ),
      );

    return Response.json(
      { unreadCount: Number(row?.count ?? 0) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unread count query failed:", error);
    return Response.json({ error: "Couldn’t load unread count." }, { status: 500 });
  }
}
