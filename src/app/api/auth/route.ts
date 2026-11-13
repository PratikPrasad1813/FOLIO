import { eq } from "drizzle-orm";
import { db, DatabaseUnavailableError } from "@/db";
import { users } from "@/db/schema";
import { allowAuthAttempt, createSession, destroySession, requireUser, hashPassword, publicUser, requestOrigin, sameOrigin, signedInDestination, verifyPassword } from "@/lib/auth";
import { onAccountCreated } from "@/lib/account-events";
export const dynamic = "force-dynamic";
const DUMMY_HASH = "00000000000000000000000000000000:" + "0".repeat(128);
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!await allowAuthAttempt(request, "credentials") || !await allowAuthAttempt(request, "credentials-email", email)) return Response.json({ error: "Too many attempts. Please try again in 15 minutes." }, { status: 429 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    if (password.length < 8 || password.length > 128) return Response.json({ error: "Use a password between 8 and 128 characters." }, { status: 400 });
    if (body.action === "register") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
      if (!name) return Response.json({ error: "Please enter your name." }, { status: 400 });
      const passwordHash = await hashPassword(password);
      const [user] = await db.insert(users).values({ name, email, passwordHash, provider: "email" }).onConflictDoNothing({ target: users.email }).returning();
      if (!user) return Response.json({ error: "An account with this email already exists. Sign in or recover your account." }, { status: 409 });
      await createSession(user.id);
      const { emailResult } = await onAccountCreated({ user, appOrigin: requestOrigin(request) });
      return Response.json({ user: publicUser(user), destination: signedInDestination(user, body.next), welcomeEmailSent: emailResult.sent });
    }
    if (body.action !== "login") return Response.json({ error: "Unknown authentication action." }, { status: 400 });
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const valid = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !user.passwordHash || !valid) return Response.json({ error: "That email and password don’t match. Try again or recover your account." }, { status: 401 });
    await createSession(user.id);
    return Response.json({ user: publicUser(user), destination: signedInDestination(user, body.next) });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      console.error("Authentication request failed: database unavailable");
      return Response.json({ error: `${error.message} ${error.hint}`.trim() }, { status: 503 });
    }
    console.error("Authentication request failed", error instanceof Error ? error.name : "error");
    return Response.json({ error: "We couldn’t complete that request. Please try again." }, { status: 500 });
  }
}
export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  try {
    const user = await requireUser();
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : user.name;
    const weeklyGoal = body.weeklyGoal === undefined ? user.weeklyGoal : Number(body.weeklyGoal);
    if (!name || !Number.isInteger(weeklyGoal) || weeklyGoal < 1 || weeklyGoal > 100) return Response.json({ error: "Enter a name and a weekly goal between 1 and 100." }, { status: 400 });
    const [updated] = await db.update(users).set({ name, weeklyGoal }).where(eq(users.id, user.id)).returning();
    return Response.json({ user: publicUser(updated) });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return Response.json({ error: `${error.message} ${error.hint}`.trim() }, { status: 503 });
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  await destroySession();
  return Response.json({ ok: true });
}
