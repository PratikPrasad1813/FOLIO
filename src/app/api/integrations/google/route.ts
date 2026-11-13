import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts, googleCalendars, googleEvents } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { googleConfig, redirectUri, revokeToken } from "@/lib/google";
import { loadAccount } from "@/lib/calendar-sync";
import { openToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/** Connection status for the integration card. Never returns tokens. */
export async function GET(request: Request) {
  const user = await requireUser();
  const config = googleConfig();
  if (!config.configured) {
    return Response.json({ connected: false, notConfigured: true, redirectUri: redirectUri(request), hint: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then register the redirect URI below in Google Cloud Console." });
  }
  const [account] = await db.select().from(googleAccounts).where(eq(googleAccounts.userId, user.id)).limit(1);
  if (!account) return Response.json({ connected: false });
  const calendars = await db.select({ calendarId: googleCalendars.calendarId, summary: googleCalendars.summary, backgroundColor: googleCalendars.backgroundColor, primary: googleCalendars.primary, selected: googleCalendars.selected, visible: googleCalendars.visible, lastError: googleCalendars.lastError, lastSyncedAt: googleCalendars.lastSyncedAt })
    .from(googleCalendars).where(eq(googleCalendars.accountId, account.id)).orderBy(googleCalendars.primary, googleCalendars.summary);
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(googleEvents).where(eq(googleEvents.userId, user.id));
  const needsReauth = Boolean(account.revokedAt) || Boolean(account.connectionError);
  return Response.json({
    connected: !needsReauth,
    needsReauth,
    account: { email: account.email, name: account.name, picture: account.picture },
    scopes: account.scopes,
    writeEnabled: account.writeEnabled,
    canWrite: account.writeEnabled,
    calendars,
    eventCount: Number(countRow?.total ?? 0),
    lastSync: { at: account.lastSyncAt, status: account.lastSyncStatus, detail: account.lastSyncDetail },
    connectionError: account.connectionError,
  });
}

/**
 * Disconnect: stops all syncing and deletes the stored credentials and event
 * mirror. Nothing is deleted in Google Calendar — revoking the grant only means
 * Folio can no longer see or change those events.
 */
export async function DELETE() {
  const user = await requireUser();
  const account = await loadAccount(user.id);
  if (account) {
    const refreshToken = openToken(account.refreshTokenEnc);
    if (refreshToken) await revokeToken(refreshToken);
    await db.delete(googleEvents).where(eq(googleEvents.userId, user.id));
    await db.delete(googleCalendars).where(eq(googleCalendars.userId, user.id));
    await db.delete(googleAccounts).where(and(eq(googleAccounts.userId, user.id), eq(googleAccounts.id, account.id)));
    const { reconcileGoogleCalendarReminders } = await import("@/lib/reminder-processor");
    await reconcileGoogleCalendarReminders(user.id).catch(() => {});
  }
  return Response.json({ disconnected: true });
}
