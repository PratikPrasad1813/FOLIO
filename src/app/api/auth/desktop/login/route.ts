/**
 * POST /api/auth/desktop/login — cross-origin email + password sign-in for
 * the LOCAL desktop shell.
 *
 * The desktop webview loads a bundled static frontend whose origin is the
 * Tauri custom protocol (`tauri://localhost` / `http://tauri.localhost`), so
 * it can neither send the web app's session cookie nor satisfy its
 * same-origin CSRF check. This endpoint is the desktop-native transport:
 *
 *   - CORS-restricted to the Tauri webview origins (+ localhost dev),
 *   - rate-limited exactly like the web login (per-IP and per-account),
 *   - verified against the same scrypt password hashes as /api/auth,
 *   - answered with the public profile PLUS a dedicated 90-day Bearer
 *     token that the shell persists in its `local_auth` SQLite table.
 *
 * No cookie is set: cross-site cookies would be third-party and blocked
 * anyway, and the desktop shell authorizes exclusively via Bearer.
 */

import { eq } from "drizzle-orm";
import { db, DatabaseUnavailableError } from "@/db";
import { users } from "@/db/schema";
import { allowAuthAttempt, publicUser, verifyPassword } from "@/lib/auth";
import { corsJson, desktopCorsPreflight, mintDesktopSessionToken } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";

const DUMMY_HASH = "00000000000000000000000000000000:" + "0".repeat(128);

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsJson(request, { error: "A JSON body with email and password is required." }, 400);
  }
  const email = body && typeof body === "object" && typeof (body as { email?: unknown }).email === "string"
    ? (body as { email: string }).email.trim().toLowerCase()
    : "";
  const password = body && typeof body === "object" && typeof (body as { password?: unknown }).password === "string"
    ? (body as { password: string }).password
    : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return corsJson(request, { error: "Please enter a valid email address." }, 400);
  }
  if (password.length < 8 || password.length > 128) {
    return corsJson(request, { error: "Use a password between 8 and 128 characters." }, 400);
  }

  try {
    // Same shared rate limits as the web login: per-IP and per-account.
    if (!await allowAuthAttempt(request, "credentials") || !await allowAuthAttempt(request, "credentials-email", email)) {
      return corsJson(request, { error: "Too many attempts. Please try again in 15 minutes." }, 429);
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user && !user.passwordHash) {
      return corsJson(request, { error: "This account was created via social login without a password. Please sign in using an account with a password or register a new desktop account." }, 401);
    }
    const valid = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !user.passwordHash || !valid) {
      return corsJson(request, { error: "That email and password don’t match. Please try again." }, 401);
    }

    const { token, expiresAt } = await mintDesktopSessionToken(user.id);
    return corsJson(request, { user: publicUser(user), token, expiresAt });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      return corsJson(request, { error: `${error.message} ${error.hint}`.trim() }, 503);
    }
    console.error("Desktop login failed:", error instanceof Error ? error.name : "error");
    return corsJson(request, { error: "We couldn’t complete that request. Please try again." }, 500);
  }
}
