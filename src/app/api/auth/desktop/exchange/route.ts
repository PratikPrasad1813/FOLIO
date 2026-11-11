/**
 * POST /api/auth/desktop/exchange — complete a desktop sign-in by consuming
 * a one-time handoff code minted by /api/auth/desktop/handoff (or by the
 * OAuth callback for `?desktop=1` flows).
 *
 * Called by the LOCAL desktop shell (Tauri webview origin), hence:
 *   - CORS-restricted to the Tauri webview origins (+ localhost dev),
 *   - no cookie is created — the response carries the public profile and a
 *     dedicated 90-day Bearer token the shell stores in `local_auth`.
 *
 * The code row is deleted atomically with its consumption: replaying a
 * used (or expired) code can never mint a second token.
 */

import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { desktopAuthHandoffs, users } from "@/db/schema";
import { hashToken, publicUser } from "@/lib/auth";
import { ensureSchema } from "@/db/migrate";
import { corsJson, desktopCorsPreflight, mintDesktopSessionToken } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsJson(request, { error: "A valid sign-in code is required." }, 400);
  }
  const code = body && typeof body === "object" && "code" in body
    ? (body as { code: unknown }).code
    : null;
  if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code)) {
    return corsJson(request, { error: "A valid sign-in code is required." }, 400);
  }

  await ensureSchema();
  const [handoff] = await db.delete(desktopAuthHandoffs)
    .where(and(
      eq(desktopAuthHandoffs.tokenHash, hashToken(code)),
      gt(desktopAuthHandoffs.expiresAt, new Date()),
    ))
    .returning({ userId: desktopAuthHandoffs.userId, destination: desktopAuthHandoffs.destination });
  if (!handoff) {
    return corsJson(request, { error: "This sign-in code expired or was already used." }, 401);
  }

  const [user] = await db.select().from(users).where(eq(users.id, handoff.userId)).limit(1);
  if (!user) {
    return corsJson(request, { error: "This account no longer exists." }, 401);
  }

  const { token, expiresAt } = await mintDesktopSessionToken(user.id);
  return corsJson(request, {
    user: publicUser(user),
    token,
    expiresAt,
    destination: handoff.destination,
  });
}
