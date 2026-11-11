/**
 * POST /api/auth/desktop/handoff — mint a one-time pairing code for the
 * desktop shell from an EXISTING web session.
 *
 * Flow: the desktop sign-in screen opens `<api>/login?next=/desktop-auth`
 * in the system browser. The user signs in there (email, Google or GitHub
 * — the full web surface), lands on /desktop-auth, and this endpoint —
 * called same-origin over that fresh session cookie — inserts a
 * single-use, 5-minute handoff row. The page then deep-links back:
 *
 *     folio://auth?code=<64-hex>
 *
 * and the desktop shell exchanges the code at /api/auth/desktop/exchange.
 *
 * One-time codes (sha256-hashed at rest, consumed on use, short-lived)
 * are used instead of forwarding the raw session token through the URL.
 */

import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { desktopAuthHandoffs } from "@/db/schema";
import { currentUser, hashToken, sameOrigin } from "@/lib/auth";
import { ensureSchema } from "@/db/migrate";
import { safeDestination } from "@/lib/auth";
import { corsJson } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";

const HANDOFF_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  // Same-origin only: this is called by the web app's own /desktop-auth page
  // while the user's browser session is live.
  if (!sameOrigin(request)) {
    return corsJson(request, { error: "This sign-in request could not be verified." }, 403);
  }
  const user = await currentUser();
  if (!user) {
    return corsJson(request, { error: "Please sign in before pairing the desktop app." }, 401);
  }

  let destination = "/overview";
  try {
    const body = (await request.json()) as { destination?: unknown };
    if (body && typeof body === "object") {
      destination = safeDestination(body.destination);
    }
  } catch {
    // No body (or invalid JSON): the default destination applies.
  }

  await ensureSchema();
  const code = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + HANDOFF_MS);
  await db.insert(desktopAuthHandoffs).values({
    tokenHash: hashToken(code),
    userId: user.id,
    destination,
    expiresAt,
  });

  return corsJson(request, { code, expiresAt: expiresAt.toISOString() });
}
