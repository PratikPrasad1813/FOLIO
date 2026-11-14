/**
 * POST /api/auth/desktop/register — cross-origin user registration for
 * the LOCAL desktop shell.
 *
 * Allows creating a Folio account directly from the desktop app without
 * opening an external browser or creating a web session cookie.
 */

import { db, DatabaseUnavailableError } from "@/db";
import { users } from "@/db/schema";
import { allowAuthAttempt, hashPassword, publicUser, requestOrigin } from "@/lib/auth";
import { corsJson, desktopCorsPreflight, mintDesktopSessionToken } from "@/lib/sync-auth";
import { onAccountCreated } from "@/lib/account-events";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsJson(request, { error: "A JSON body with name, email, and password is required." }, 400);
  }

  const name = body && typeof body === "object" && typeof (body as { name?: unknown }).name === "string"
    ? (body as { name: string }).name.trim().slice(0, 80)
    : "";
  const email = body && typeof body === "object" && typeof (body as { email?: unknown }).email === "string"
    ? (body as { email: string }).email.trim().toLowerCase()
    : "";
  const password = body && typeof body === "object" && typeof (body as { password?: unknown }).password === "string"
    ? (body as { password: string }).password
    : "";

  if (!name) {
    return corsJson(request, { error: "Please enter your name." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return corsJson(request, { error: "Please enter a valid email address." }, 400);
  }
  if (password.length < 8 || password.length > 128) {
    return corsJson(request, { error: "Use a password between 8 and 128 characters." }, 400);
  }

  try {
    if (!await allowAuthAttempt(request, "credentials") || !await allowAuthAttempt(request, "credentials-email", email)) {
      return corsJson(request, { error: "Too many attempts. Please try again in 15 minutes." }, 429);
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({
        name,
        email,
        passwordHash,
        provider: "email",
        onboardingCompletedAt: new Date(),
        onboardingStep: 10,
      })
      .onConflictDoNothing({ target: users.email })
      .returning();

    if (!user) {
      return corsJson(request, { error: "An account with this email already exists. Please sign in." }, 409);
    }

    const { token, expiresAt } = await mintDesktopSessionToken(user.id);

    try {
      await onAccountCreated({ user, appOrigin: requestOrigin(request) });
    } catch (e) {
      console.warn("Desktop welcome event notice:", e instanceof Error ? e.name : "error");
    }

    return corsJson(request, { user: publicUser(user), token, expiresAt }, 201);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      return corsJson(request, { error: `${error.message} ${error.hint}`.trim() }, 503);
    }
    console.error("Desktop register failed:", error instanceof Error ? error.name : "error");
    return corsJson(request, { error: "We couldn’t create your account. Please try again." }, 500);
  }
}
