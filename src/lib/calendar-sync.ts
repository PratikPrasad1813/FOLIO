import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts, googleCalendars, googleEvents } from "@/db/schema";
import { openToken, sealToken } from "@/lib/crypto";
import { GoogleError, authorisedClient, isWriteGranted, listCalendars, listEvents, refreshAccessToken, type GoogleEvent } from "@/lib/google";
import { dateKey } from "@/lib/types";

/** Folio only keeps a bounded window of Google history to stay fast. */
const HISTORY_DAYS = 400;

export interface SyncSummary {
  status: "ok" | "partial" | "error" | "revoked";
  calendars: { calendarId: string; summary: string; added: number; updated: number; removed: number; full: boolean; error?: string }[];
  added: number;
  updated: number;
  removed: number;
  conflicts: { eventId: string; title: string; taskId: string | null; reason: string }[];
  message: string;
  syncedAt: string;
}

interface AccountRow { id: string; userId: string; refreshTokenEnc: string; accessTokenEnc: string | null; accessTokenExpiresAt: Date | null; scopes: string[]; writeEnabled: boolean }

/** Returns a valid access token, refreshing and persisting it when needed. */
export async function accessTokenFor(account: AccountRow): Promise<{ token: string; client: Awaited<ReturnType<typeof authorisedClient>> }> {
  const refreshToken = openToken(account.refreshTokenEnc);
  if (!refreshToken) throw new GoogleError("The stored Google credentials are unreadable. Reconnect Google Calendar.", 401, "no_token", true);
  const { googleConfig } = await import("@/lib/google");
  const config = googleConfig();
  const fresh = account.accessTokenEnc ? openToken(account.accessTokenEnc) : null;
  const expires = account.accessTokenExpiresAt?.getTime() ?? 0;
  // Refresh a minute early to avoid racing an in-flight request against expiry.
  if (fresh && expires - 60_000 > Date.now()) {
    const client = await authorisedClient({ accessToken: fresh });
    return { token: fresh, client };
  }
  const rotated = await refreshAccessToken(refreshToken, config);
  await db.update(googleAccounts).set({ accessTokenEnc: sealToken(rotated.accessToken), accessTokenExpiresAt: new Date(Date.now() + rotated.expiresIn * 1000), updatedAt: new Date() }).where(eq(googleAccounts.id, account.id));
  const client = await authorisedClient({ accessToken: rotated.accessToken });
  return { token: rotated.accessToken, client };
}

export async function loadAccount(userId: string): Promise<AccountRow | null> {
  const [row] = await db.select({ id: googleAccounts.id, userId: googleAccounts.userId, refreshTokenEnc: googleAccounts.refreshTokenEnc, accessTokenEnc: googleAccounts.accessTokenEnc, accessTokenExpiresAt: googleAccounts.accessTokenExpiresAt, scopes: googleAccounts.scopes, writeEnabled: googleAccounts.writeEnabled }).from(googleAccounts).where(eq(googleAccounts.userId, userId)).limit(1);
  return row ?? null;
}

/** Marks a connection as needing re-authentication and clears its secrets. */
async function markRevoked(accountId: string, message: string) {
  await db.update(googleAccounts).set({ connectionError: message, revokedAt: new Date(), accessTokenEnc: null, updatedAt: new Date() }).where(eq(googleAccounts.id, accountId));
}

function parseInstant(event: GoogleEvent): { startAt: Date | null; endAt: Date | null; startDate: string | null; endDate: string | null; allDay: boolean; timezone: string | null } {
  const allDay = Boolean(event.start?.date) && !event.start?.dateTime;
  if (allDay) {
    const start = event.start?.date ?? null;
    // Google's end date is exclusive; keep it exclusive in Folio too.
    const end = event.end?.date ?? start;
    return { startAt: start ? new Date(`${start}T12:00:00Z`) : null, endAt: end ? new Date(`${end}T12:00:00Z`) : null, startDate: start, endDate: end, allDay: true, timezone: null };
  }
  const start = event.start?.dateTime ?? null;
  const end = event.end?.dateTime ?? start;
  return {
    startAt: start ? new Date(start) : null,
    endAt: end ? new Date(end) : start ? new Date(start) : null,
    startDate: start ? dateKey(new Date(start)) : null,
    endDate: end ? dateKey(new Date(end)) : null,
    allDay: false,
    timezone: event.start?.timeZone ?? null,
  };
}

/**
 * Synchronises every selected calendar.
 *
 * Idempotency: each Google event maps to exactly one row via a unique index on
 * (account, googleEventId), so replaying the same change is a no-op. Expired sync
 * tokens (HTTP 410) fall back to a full resync automatically.
 */
export async function syncAccount(userId: string, options: { full?: boolean } = {}): Promise<SyncSummary> {
  const account = await loadAccount(userId);
  if (!account) throw new GoogleError("Google Calendar isn’t connected.", 400, "not_connected");
  let client: Awaited<ReturnType<typeof authorisedClient>>;
  try {
    client = (await accessTokenFor(account)).client;
  } catch (error) {
    if (error instanceof GoogleError && error.needsReauth) await markRevoked(account.id, error.message);
    throw error;
  }

  const calendars = await db.select().from(googleCalendars).where(and(eq(googleCalendars.accountId, account.id), eq(googleCalendars.userId, userId))).orderBy(googleCalendars.primary, googleCalendars.summary);
  const targets = calendars.filter((calendar) => calendar.selected && calendar.visible);
  const summary: SyncSummary = { status: "ok", calendars: [], added: 0, updated: 0, removed: 0, conflicts: [], message: "", syncedAt: new Date().toISOString() };

  // Refresh the calendar list so renames, colours and new calendars show up.
  try {
    const remote = await listCalendars(client);
    const byId = new Map(remote.items.map((item) => [item.id, item]));
    for (const row of calendars) {
      const item = byId.get(row.calendarId);
      if (!item) continue; // calendar was removed from the user's list; leave its events alone
      await db.update(googleCalendars).set({ summary: item.summaryOverride ?? item.summary ?? row.calendarId, description: item.description ?? "", backgroundColor: item.backgroundColor ?? null, primary: Boolean(item.primary), selected: item.selected ?? row.selected, updatedAt: new Date() }).where(eq(googleCalendars.id, row.id));
    }
  } catch {
    // Calendar-list metadata is cosmetic; a failed refresh must not block the event sync.
  }

  for (const calendar of targets) {
    let pageToken: string | undefined;
    let added = 0, updated = 0, removed = 0;
    let full = options.full || !calendar.syncToken;
    let nextSyncToken: string | null = null;
    const calendarErrors: string[] = [];

    // A full resync replaces the mirror for this calendar, so remember what we knew.
    const known = full ? new Set((await db.select({ googleEventId: googleEvents.googleEventId }).from(googleEvents).where(and(eq(googleEvents.accountId, account.id), eq(googleEvents.calendarId, calendar.calendarId)))).map((row) => row.googleEventId)) : null;

    for (let page = 0; page < 40; page++) {
      let pageResult: Awaited<ReturnType<typeof listEvents>>;
      try {
        pageResult = await listEvents(client, full
          ? { calendarId: calendar.calendarId, timeMin: new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString(), pageToken }
          : { calendarId: calendar.calendarId, syncToken: pageToken ? undefined : calendar.syncToken, pageToken });
      } catch (error) {
        if (error instanceof GoogleError && error.status === 410) {
          // Sync token expired (Google invalidates them after a few weeks of quiet).
          full = true; pageToken = undefined; known?.clear();
          continue;
        }
        if (error instanceof GoogleError && error.needsReauth) { await markRevoked(account.id, error.message); summary.status = "revoked"; summary.message = error.message; return summary; }
        calendarErrors.push(error instanceof Error ? error.message : "Unknown Google error");
        break;
      }

      const seenThisPage = new Set<string>();
      for (const event of pageResult.items ?? []) {
        seenThisPage.add(event.id);
        known?.delete(event.id);
        if (event.status === "cancelled") {
          // Google reports deletions as cancelled events; keep the mirror in step.
          const gone = await db.delete(googleEvents).where(and(eq(googleEvents.accountId, account.id), eq(googleEvents.googleEventId, event.id))).returning({ id: googleEvents.id });
          if (gone.length) removed++;
          continue;
        }
        const times = parseInstant(event);
        const googleUpdatedAt = event.updated ? new Date(event.updated) : null;
        const payload = {
          userId, accountId: account.id, calendarId: calendar.calendarId, googleEventId: event.id,
          recurringEventId: event.recurringEventId ?? null,
          title: event.summary ?? "", description: event.description ?? "", location: event.location ?? "",
          ...times, status: event.status ?? "confirmed", htmlLink: event.htmlLink ?? null,
          organizer: event.organizer?.email ?? event.creator?.email ?? null,
          attendees: event.attendees?.length ?? 0, etag: event.etag ?? null, googleUpdatedAt,
        };
        const [existing] = await db.select({ id: googleEvents.id, googleUpdatedAt: googleEvents.googleUpdatedAt, localDirty: googleEvents.localDirty, taskId: googleEvents.taskId, title: googleEvents.title }).from(googleEvents).where(and(eq(googleEvents.accountId, account.id), eq(googleEvents.googleEventId, event.id))).limit(1);
        if (existing) {
          // Conflict: Folio holds an unpushed edit and Google changed the event too.
          const changedOnGoogle = googleUpdatedAt && (!existing.googleUpdatedAt || googleUpdatedAt.getTime() !== existing.googleUpdatedAt.getTime());
          if (changedOnGoogle && existing.localDirty) {
            summary.conflicts.push({ eventId: event.id, title: payload.title || existing.title, taskId: existing.taskId, reason: "Edited in both Folio and Google Calendar before syncing." });
          }
          await db.update(googleEvents).set({ ...payload, localDirty: changedOnGoogle && existing.localDirty ? existing.localDirty : false, updatedAt: new Date() }).where(eq(googleEvents.id, existing.id));
          updated++;
        } else {
          await db.insert(googleEvents).values(payload).onConflictDoNothing();
          added++;
        }
      }
      if (known) for (const gone of known) {
        // Deleted (or filtered out) on Google since the last full sync.
        await db.delete(googleEvents).where(and(eq(googleEvents.accountId, account.id), eq(googleEvents.calendarId, calendar.calendarId), eq(googleEvents.googleEventId, gone)));
        removed++;
      }
      pageToken = pageResult.nextPageToken;
      nextSyncToken = pageResult.nextSyncToken ?? nextSyncToken;
      if (!pageToken) break;
    }

    if (!calendarErrors.length && nextSyncToken) {
      await db.update(googleCalendars).set({ syncToken: nextSyncToken, lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(googleCalendars.id, calendar.id));
    } else if (calendarErrors.length) {
      await db.update(googleCalendars).set({ lastError: calendarErrors[0], updatedAt: new Date() }).where(eq(googleCalendars.id, calendar.id));
    }
    summary.calendars.push({ calendarId: calendar.calendarId, summary: calendar.summary, added, updated, removed, full, error: calendarErrors[0] });
    summary.added += added; summary.updated += updated; summary.removed += removed;
  }

  // Tidy up events that are no longer on any visible calendar.
  await db.delete(googleEvents).where(and(eq(googleEvents.userId, userId), inArray(googleEvents.calendarId, [""])));

  const failed = summary.calendars.filter((entry) => entry.error);
  if (summary.status !== "revoked") summary.status = failed.length ? (failed.length === summary.calendars.length ? "error" : "partial") : "ok";
  const parts = [`added ${summary.added}`, `updated ${summary.updated}`, `removed ${summary.removed}`];
  summary.message = summary.status === "ok"
    ? `Synced ${summary.calendars.length} calendar${summary.calendars.length === 1 ? "" : "s"} — ${parts.join(", ")}.${summary.conflicts.length ? ` ${summary.conflicts.length} conflict${summary.conflicts.length === 1 ? "" : "s"} need attention.` : ""}`
    : failed.length ? failed[0].error ?? "Google Calendar reported a problem." : "Sync finished with warnings.";
  summary.conflicts.forEach((conflict, index) => { if (index < 20) summary.conflicts[index] = conflict; });

  await db.update(googleAccounts).set({ lastSyncAt: new Date(), lastSyncStatus: summary.status, lastSyncDetail: { calendars: summary.calendars, conflicts: summary.conflicts.slice(0, 25), message: summary.message, syncedAt: summary.syncedAt }, connectionError: summary.status === "revoked" ? summary.message : null, updatedAt: new Date() }).where(eq(googleAccounts.id, account.id));
  const { reconcileGoogleCalendarReminders } = await import("@/lib/reminder-processor");
  await reconcileGoogleCalendarReminders(userId).catch(() => {});
  return summary;
}

/** Reads events from the mirror (never a live Google call), so the calendar renders instantly. */
export async function readEvents(userId: string, from: string, to: string) {
  const rows = await db.select({
    id: googleEvents.id, calendarId: googleEvents.calendarId, googleEventId: googleEvents.googleEventId,
    title: googleEvents.title, description: googleEvents.description, location: googleEvents.location,
    startAt: googleEvents.startAt, endAt: googleEvents.endAt, startDate: googleEvents.startDate, endDate: googleEvents.endDate,
    allDay: googleEvents.allDay, status: googleEvents.status, htmlLink: googleEvents.htmlLink, organizer: googleEvents.organizer,
    attendees: googleEvents.attendees, timezone: googleEvents.timezone, localDirty: googleEvents.localDirty,
    taskId: googleEvents.taskId, summary: googleCalendars.summary, color: googleCalendars.backgroundColor,
  }).from(googleEvents)
    .leftJoin(googleCalendars, and(eq(googleCalendars.accountId, googleEvents.accountId), eq(googleCalendars.calendarId, googleEvents.calendarId)))
    .where(and(
      eq(googleEvents.userId, userId),
      eq(googleEvents.status, "confirmed"),
      // Overlap test that works for both timed and all-day events.
      sql`coalesce(${googleEvents.startDate}, to_char(${googleEvents.startAt}, 'YYYY-MM-DD')) <= ${to}`,
      sql`coalesce(${googleEvents.endDate}, to_char(${googleEvents.endAt}, 'YYYY-MM-DD'), to_char(${googleEvents.startAt}, 'YYYY-MM-DD')) >= ${from}`,
    ))
    .orderBy(googleEvents.startAt, googleEvents.title);
  return rows;
}

export function canWrite(scopes: string[] | null | undefined, writeEnabled: boolean | null) {
  return Boolean(writeEnabled && isWriteGranted(scopes));
}
