import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts, googleCalendars } from "@/db/schema";
import { getUser, requestOrigin } from "@/lib/auth";
import { decodeIdToken, exchangeCode, googleConfig, isWriteGranted, listCalendars, redirectUri } from "@/lib/google";
import { onGoogleCalendarConnected } from "@/lib/account-events";
import { openToken, sealToken, verifyState } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const COOKIE = "folio_google_oauth";

function bail(request: Request, code: string, message: string) {
  const target = new URL("/calendar", new URL(request.url).origin);
  target.searchParams.set("google", code);
  target.searchParams.set("message", message.slice(0, 200));
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const config = googleConfig();
  if (!config.configured) return bail(request, "not_configured", "Google Calendar isn’t configured on this server.");
  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const stored = verifyState(jar.get(COOKIE)?.value);
  jar.set(COOKIE, "", { path: "/", maxAge: 0 });

  const user = await getUser();
  if (params.get("error")) return bail(request, "cancelled", params.get("error") === "access_denied" ? "You cancelled the Google Calendar connection." : `Google returned an error: ${params.get("error")}`);
  const code = params.get("code");
  if (!code) return bail(request, "missing_code", "Google didn’t return an authorization code.");
  if (!stored || stored.state !== params.get("state")) return bail(request, "state_mismatch", "That connection request expired or didn’t come from Folio. Please try again.");

  try {
    const tokens = await exchangeCode({ code, clientId: config.clientId, clientSecret: config.clientSecret, redirect: redirectUri(request), verifier: String(stored.verifier) });
    const profile = decodeIdToken(tokens.idToken);
    const googleUserId = profile.sub ?? tokens.idToken?.slice(0, 0) ?? crypto.randomUUID();
    const email = profile.email ?? "unknown Google account";
        // Prefer the scopes Google reports; fall back to what we asked for, because some
    // token responses omit the scope field and we must not silently lose access.
    const granted = tokens.scopes.length ? tokens.scopes : Array.isArray(stored.scopes) ? (stored.scopes as string[]) : [];
    const writeGranted = isWriteGranted(granted);
    const now = new Date();

    const [existing] = await db.select().from(googleAccounts).where(eq(googleAccounts.userId, user.id)).limit(1);
    const values = {
      userId: user.id,
      googleUserId,
      email,
      name: profile.name ?? "",
      picture: profile.picture ?? null,
      refreshTokenEnc: sealToken(tokens.refreshToken ?? openToken(existing?.refreshTokenEnc) ?? "") as string,
      accessTokenEnc: sealToken(tokens.accessToken),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      scopes: granted,
      // Only keep a previous write grant when Google didn't report scopes at all;
      // otherwise an explicit re-consent without event access must downgrade us.
      writeEnabled: writeGranted || (tokens.scopes.length === 0 && Boolean(existing?.writeEnabled)),
      connectionError: null,
      revokedAt: null,
      updatedAt: now,
    };
    const accountId = existing
      ? (await db.update(googleAccounts).set(values).where(eq(googleAccounts.id, existing.id)).returning({ id: googleAccounts.id }))[0].id
      : (await db.insert(googleAccounts).values(values).returning({ id: googleAccounts.id }))[0].id;

    // Seed the calendar list immediately so the user can pick a calendar at once.
    try {
      const { authorisedClient } = await import("@/lib/google");
      const live = await listCalendars(await authorisedClient({ accessToken: tokens.accessToken }));
      for (const item of live.items ?? []) {
        const existingCalendar = await db.select({ id: googleCalendars.id }).from(googleCalendars).where(and(eq(googleCalendars.accountId, accountId), eq(googleCalendars.calendarId, item.id))).limit(1);
        const base = { accountId, userId: user.id, calendarId: item.id, summary: item.summaryOverride ?? item.summary ?? item.id, description: item.description ?? "", backgroundColor: item.backgroundColor ?? null, primary: Boolean(item.primary), selected: item.selected ?? Boolean(item.primary), visible: true, updatedAt: now };
        if (existingCalendar.length) await db.update(googleCalendars).set(base).where(eq(googleCalendars.id, existingCalendar[0].id));
        else await db.insert(googleCalendars).values(base);
      }
    } catch { /* A failed listing is fine: "Sync now" seeds the calendar list later. */ }

    if (!existing) {
      await onGoogleCalendarConnected({
        user,
        googleEmail: email,
        writeEnabled: values.writeEnabled,
        appOrigin: requestOrigin(request),
      });
    }

    const target = new URL("/calendar", new URL(request.url).origin);
    target.searchParams.set("google", "connected");
    target.searchParams.set("message", `${email} is now connected to Folio.`);
    return NextResponse.redirect(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn’t complete the Google connection.";
    return bail(request, "exchange_failed", message);
  }
}
