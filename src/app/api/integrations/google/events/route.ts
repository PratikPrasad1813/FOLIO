import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts, googleEvents } from "@/db/schema";
import { requireUser, sameOrigin } from "@/lib/auth";
import { GoogleError, createEvent } from "@/lib/google";
import { accessTokenFor, loadAccount, readEvents, syncAccount } from "@/lib/calendar-sync";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Google events for a date range, read from Folio's mirror (no live Google call). */
export async function GET(request: Request) {
  const user = await requireUser();
  const account = await loadAccount(user.id);
  if (!account) return Response.json({ connected: false, events: [] });
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) return Response.json({ error: "Provide a valid from/to date range." }, { status: 400 });
  const events = await readEvents(user.id, from, to);
  const [row] = await db.select({ lastSyncAt: googleAccounts.lastSyncAt, lastSyncStatus: googleAccounts.lastSyncStatus, lastSyncDetail: googleAccounts.lastSyncDetail, connectionError: googleAccounts.connectionError }).from(googleAccounts).where(eq(googleAccounts.userId, user.id)).limit(1);
  return Response.json({ connected: true, needsReauth: Boolean(row?.connectionError), events, lastSync: { at: row?.lastSyncAt, status: row?.lastSyncStatus, detail: row?.lastSyncDetail } }, { headers: { "Cache-Control": "no-store" } });
}

/** Creates a Google Calendar event, optionally linked to a Folio task. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const user = await requireUser();
  const account = await loadAccount(user.id);
  if (!account) return Response.json({ error: "Connect Google Calendar first." }, { status: 400 });
  if (!account.writeEnabled) return Response.json({ error: "Folio doesn’t have permission to create events. Enable event access in Settings → Integrations.", upgradeRequired: true }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Please send valid JSON." }, { status: 400 });
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 300) return Response.json({ error: "Give the event a title (1–300 characters)." }, { status: 400 });
  const calendarId = typeof body.calendarId === "string" && body.calendarId ? body.calendarId : "primary";
  const description = typeof body.description === "string" ? body.description.slice(0, 8000) : "";
  const location = typeof body.location === "string" ? body.location.slice(0, 500) : "";
  const allDay = body.allDay === true;
  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";
  if (allDay ? !DAY.test(start) || !DAY.test(end) || end < start : !RFC3339.test(start) || !RFC3339.test(end) || new Date(end) <= new Date(start)) {
    return Response.json({ error: allDay ? "For an all-day event, provide a start and end date (end is exclusive)." : "Provide a valid start and end time, with the end after the start." }, { status: 400 });
  }
  const taskId = typeof body.taskId === "string" && body.taskId ? body.taskId : null;
  const timeZone = typeof body.timeZone === "string" && body.timeZone ? body.timeZone : null;

  try {
    const { client } = await accessTokenFor(account);
    const created = await createEvent(client, { summary: title, description, location, calendarId, start, end, allDay, timeZone });
    const [row] = await db.insert(googleEvents).values({
      userId: user.id, accountId: account.id, calendarId, googleEventId: created.id,
      title, description, location,
      startAt: allDay ? new Date(`${start}T12:00:00Z`) : new Date(start),
      endAt: allDay ? new Date(`${end}T12:00:00Z`) : new Date(end),
      startDate: allDay ? start : start.slice(0, 10),
      endDate: allDay ? end : end.slice(0, 10),
      allDay, timezone: created.start?.timeZone ?? timeZone, status: created.status ?? "confirmed",
      htmlLink: created.htmlLink ?? null, googleUpdatedAt: created.updated ? new Date(created.updated) : new Date(),
      taskId, // freshly created here, so Google already matches Folio
    }).onConflictDoUpdate({ target: [googleEvents.accountId, googleEvents.googleEventId], set: { title, taskId, updatedAt: new Date() } }).returning();
    const { reconcileGoogleCalendarReminders } = await import("@/lib/reminder-processor");
    await reconcileGoogleCalendarReminders(user.id).catch(() => {});
    return Response.json({ event: row }, { status: 201 });
  } catch (error) {
    if (error instanceof GoogleError) {
      if (error.needsReauth) await db.update(googleAccounts).set({ connectionError: error.message, revokedAt: new Date(), updatedAt: new Date() }).where(eq(googleAccounts.id, account.id));
      return Response.json({ error: error.message, needsReauth: error.needsReauth, upgradeRequired: error.status === 403 }, { status: error.status === 403 ? 403 : 502 });
    }
    return Response.json({ error: "Google Calendar couldn’t create that event." }, { status: 502 });
  }
}

/** Manual full resync for the current user. */
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const user = await requireUser();
  try {
    const summary = await syncAccount(user.id, { full: new URL(request.url).searchParams.get("full") === "1" });
    return Response.json({ summary });
  } catch (error) {
    const message = error instanceof GoogleError ? error.message : "Couldn’t sync with Google Calendar right now.";
    return Response.json({ error: message }, { status: error instanceof GoogleError && error.needsReauth ? 401 : 502 });
  }
}

