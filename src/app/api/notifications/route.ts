import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notifications } from "@/db/schema";
import { syncUser, corsJson, desktopCorsPreflight, unauthorized } from "@/lib/sync-auth";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationEntityType,
  type NotificationItem,
  type NotificationMetadata,
  type NotificationType,
} from "@/lib/notifications";
import { getOrCreatePreferences, maybeProcessUserReminders } from "@/lib/reminder-processor";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

function serializeNotification(row: typeof notifications.$inferSelect): NotificationItem {
  return {
    id: row.id,
    category: (row.category as NotificationCategory) || "task",
    type: row.type as NotificationType,
    title: row.title,
    description: row.description,
    entityType: (row.entityType as NotificationEntityType | null) ?? null,
    entityId: row.entityId ?? null,
    metadata: (row.metadata as NotificationMetadata | null) ?? null,
    read: row.read,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    deliveryStatus: row.deliveryStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    await maybeProcessUserReminders(user.id);
    const prefs = await getOrCreatePreferences(user.id);

    const params = new URL(request.url).searchParams;
    const rawLimit = Number(params.get("limit") ?? 35);
    const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 35;
    const rawOffset = Number(params.get("offset") ?? 0);
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const unreadOnly = params.get("unreadOnly") === "1" || params.get("unreadOnly") === "true";
    const categoryParam = params.get("category");
    const category =
      categoryParam && NOTIFICATION_CATEGORIES.includes(categoryParam as NotificationCategory)
        ? (categoryParam as NotificationCategory)
        : null;

    const conditions = [
      eq(notifications.userId, user.id),
      eq(notifications.deliveryStatus, "delivered"),
    ];
    if (unreadOnly) conditions.push(eq(notifications.read, false));
    if (category) conditions.push(eq(notifications.category, category));

    const whereClause = and(...conditions);

    const [rows, [unreadRow], [totalRow]] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(whereClause)
        .orderBy(desc(notifications.createdAt))
        .limit(limit + 1)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, user.id),
            eq(notifications.deliveryStatus, "delivered"),
            eq(notifications.read, false),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(whereClause),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return corsJson(request, {
      notifications: page.map(serializeNotification),
      unreadCount: Number(unreadRow?.count ?? 0),
      total: Number(totalRow?.count ?? 0),
      hasMore,
      timezone: prefs.timezone,
    });
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    return corsJson(
      request,
      { error: "Couldn’t load your notifications. Please try again." },
      500,
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const user = await syncUser(request);
    if (!user) return unauthorized("Please sign in.", request);

    const deleted = await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.deliveryStatus, "delivered"),
        ),
      )
      .returning({ id: notifications.id });

    return corsJson(request, { cleared: deleted.length, unreadCount: 0 });
  } catch (error) {
    console.error("Failed to clear notifications:", error);
    return corsJson(
      request,
      { error: "Couldn’t clear your notifications. Please try again." },
      500,
    );
  }
}
