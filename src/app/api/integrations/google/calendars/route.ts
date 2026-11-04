import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts, googleCalendars } from "@/db/schema";
import { getUser, sameOrigin } from "@/lib/auth";
import { GoogleError, googleConfig, isWriteGranted, listCalendars } from "@/lib/google";
import { loadAccount, accessTokenFor } from "@/lib/calendar-sync";

export const dynamic = "force-dynamic";

/** Lists the user's Google calendars, with Folio's visibility/selection state. */
export async function GET() {
  const user = await getUser();
  const account = await loadAccount(user.id);
  if (!account) return Response.json({ error: "Google Calendar isn’t connected." }, { status: 400 });
  try {
    const { client } = await accessTokenFor(account);
    const remote = await listCalendars(client);
    for (const item of remote.items ?? []) {
      const [row] = await db.select({ id: googleCalendars.id }).from(googleCalendars).where(and(eq(googleCalendars.accountId, account.id), eq(googleCalendars.calendarId, item.id))).limit(1);
      const base = { summary: item.summaryOverride ?? item.summary ?? item.id, backgroundColor: item.backgroundColor ?? null, primary: Boolean(item.primary), selected: item.selected ?? Boolean(item.primary), updatedAt: new Date() };
      if (row) await db.update(googleCalendars).set(base).where(eq(googleCalendars.id, row.id));
      else await db.insert(googleCalendars).values({ ...base, accountId: account.id, userId: user.id, calendarId: item.id, description: item.description ?? "", visible: true });
    }
  } catch (error) {
    // Fall back to the cached list: a transient Google hiccup shouldn't blank the settings UI.
    if (!(error instanceof GoogleError)) return Response.json({ error: "Couldn’t refresh your Google calendar list." }, { status: 502 });
  }
  const calendars = await db.select().from(googleCalendars).where(eq(googleCalendars.accountId, account.id)).orderBy(googleCalendars.primary, googleCalendars.summary);
  return Response.json({
    calendars: calendars.map((calendar) => ({
      calendarId: calendar.calendarId, summary: calendar.summary, backgroundColor: calendar.backgroundColor,
      primary: calendar.primary, selected: calendar.selected, visible: calendar.visible, lastError: calendar.lastError,
    })),
    writeEnabled: account.writeEnabled,
    canWrite: account.writeEnabled && isWriteGranted(account.scopes),
  });
}

/** Updates calendar visibility and the write-access preference. */
export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const user = await getUser();
  const account = await loadAccount(user.id);
  if (!account) return Response.json({ error: "Google Calendar isn’t connected." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { calendarId?: unknown; visible?: unknown; writeEnabled?: unknown } | null;
  if (!body) return Response.json({ error: "Please send valid JSON." }, { status: 400 });

  if (typeof body.visible === "boolean" && typeof body.calendarId === "string") {
    const [updated] = await db.update(googleCalendars).set({ visible: body.visible, updatedAt: new Date() }).where(and(eq(googleCalendars.accountId, account.id), eq(googleCalendars.calendarId, body.calendarId))).returning();
    if (!updated) return Response.json({ error: "That calendar isn’t in your list." }, { status: 404 });
    // Toggling visibility also controls whether Folio keeps syncing it.
    await db.update(googleCalendars).set({ selected: body.visible }).where(eq(googleCalendars.id, updated.id));
    const { reconcileGoogleCalendarReminders } = await import("@/lib/reminder-processor");
    await reconcileGoogleCalendarReminders(user.id).catch(() => {});
    return Response.json({ calendar: { calendarId: updated.calendarId, visible: updated.visible, selected: updated.selected } });
  }

  if (typeof body.writeEnabled === "boolean") {
    if (body.writeEnabled && !isWriteGranted(account.scopes)) {
      return Response.json({ error: "Folio needs event write permission before it can create events. Reconnect to grant it.", upgradeRequired: true }, { status: 409 });
    }
    const [updated] = await db.update(googleAccounts).set({ writeEnabled: body.writeEnabled, updatedAt: new Date() }).where(eq(googleAccounts.id, account.id)).returning();
    return Response.json({ writeEnabled: updated.writeEnabled, canWrite: isWriteGranted(updated.scopes) && updated.writeEnabled });
  }

  return Response.json({ error: "Nothing to update." }, { status: 400 });
}

/** Re-reads the calendar list from Google on demand (used after granting more access). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const user = await getUser();
  const account = await loadAccount(user.id);
  if (!account) return Response.json({ error: "Google Calendar isn’t connected." }, { status: 400 });
  const config = googleConfig();
  try {
    const { client } = await accessTokenFor(account);
    const remote = await listCalendars(client);
    let added = 0;
    for (const item of remote.items ?? []) {
      const [row] = await db.select({ id: googleCalendars.id }).from(googleCalendars).where(and(eq(googleCalendars.accountId, account.id), eq(googleCalendars.calendarId, item.id))).limit(1);
      if (row) continue;
      await db.insert(googleCalendars).values({ accountId: account.id, userId: user.id, calendarId: item.id, summary: item.summaryOverride ?? item.summary ?? item.id, description: item.description ?? "", backgroundColor: item.backgroundColor ?? null, primary: Boolean(item.primary), selected: item.selected ?? Boolean(item.primary), visible: true });
      added++;
    }
    return Response.json({ added, total: remote.items?.length ?? 0, configured: config.configured });
  } catch (error) {
    const message = error instanceof GoogleError ? error.message : "Couldn’t refresh your Google calendar list.";
    return Response.json({ error: message }, { status: error instanceof GoogleError && error.needsReauth ? 401 : 502 });
  }
}

export const runtime = "nodejs";
