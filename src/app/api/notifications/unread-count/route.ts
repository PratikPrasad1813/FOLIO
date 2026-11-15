import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notifications } from "@/db/schema";
import { maybeProcessUserReminders } from "@/lib/reminder-processor";
import { corsJson, desktopCorsPreflight, syncUser, unauthorized, desktopCorsHeaders } from "@/lib/sync-auth";
import { apiFailure } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

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

    return corsJson(request, { unreadCount: Number(row?.count ?? 0) });
  } catch (error) {
    console.error("Unread count query failed:", error);
    return apiFailure(error, "Couldn’t load unread count.", { headers: desktopCorsHeaders(request) });
  }
}
