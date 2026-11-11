/**
 * POST /api/auth/desktop/token — mint a dedicated sync token for a desktop
 * shell from an existing WEB (cookie) session.
 *
 * Used by the remote webview flow and any web surface that needs to pair a
 * long-lived engine token while a cookie session is live. The local desktop
 * shell (which has no cookies) uses /api/auth/desktop/login and
 * /api/auth/desktop/exchange instead.
 *
 * DELETE /api/auth/desktop/token — revoke the presented Bearer token
 * (called by the desktop shell on explicit sign-out; failures are expected
 * and harmless while offline — the token expires server-side anyway).
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { currentUser, hashToken, sameOrigin } from "@/lib/auth";
import { corsJson, mintDesktopSessionToken } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return corsJson(request, { error: "This sign-in request could not be verified." }, 403);
  }
  const user = await currentUser();
  if (!user) {
    return corsJson(request, { error: "Please sign in before pairing the desktop app." }, 401);
  }

  const { token, expiresAt } = await mintDesktopSessionToken(user.id);
  return corsJson(request, { token, expiresAt }, 200);
}

export async function DELETE(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]+)$/i.exec(header.trim());
  if (!match) {
    return corsJson(request, { error: "A Bearer token is required to revoke it." }, 400);
  }
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(match[1])));
  return corsJson(request, { ok: true });
}
