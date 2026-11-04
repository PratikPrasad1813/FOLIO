import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import { allowAuthAttempt, hashPassword, hashToken, requestOrigin, sameOrigin, type FolioUser } from "@/lib/auth";
import { buildPasswordResetEmail } from "@/lib/email/templates";
import { isEmailDeliveryConfigured, isRoutableEmail, sendRenderedEmail } from "@/lib/email/mailer";
import { onPasswordChanged } from "@/lib/account-events";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  try {
    const body = await request.json();
    if (!await allowAuthAttempt(request, "recovery")) return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    const origin = requestOrigin(request);

    if (body.action === "request") {
      if (!isEmailDeliveryConfigured()) {
        return Response.json({ error: "Password recovery is temporarily unavailable. Please try again later." }, { status: 503 });
      }
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
      }
      if (!await allowAuthAttempt(request, "recovery-email", email)) {
        return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
      }
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (user && isRoutableEmail(email)) {
        const token = randomBytes(32).toString("hex");
        await db.insert(passwordResets).values({
          tokenHash: hashToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + 30 * 60_000),
        });
        const rendered = buildPasswordResetEmail({
          name: user.name,
          email: user.email,
          token,
          expiresInMinutes: 30,
          appOrigin: origin,
        });
        await sendRenderedEmail(user.email, rendered);
      }
      return Response.json({ ok: true, message: "If the address belongs to an account, a recovery link will be sent." });
    }

    if (body.action === "reset") {
      const token = typeof body.token === "string" ? body.token : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!/^[a-f0-9]{64}$/.test(token) || password.length < 8 || password.length > 128) {
        return Response.json({ error: "Use a valid recovery link and a password of 8–128 characters." }, { status: 400 });
      }
      const passwordHash = await hashPassword(password);
      const updatedUser = await db.transaction(async (tx): Promise<FolioUser | null> => {
        const [reset] = await tx
          .delete(passwordResets)
          .where(and(eq(passwordResets.tokenHash, hashToken(token)), gt(passwordResets.expiresAt, new Date())))
          .returning();
        if (!reset) return null;
        const [updated] = await tx
          .update(users)
          // A reset proves control of the password only. It never changes email_verified_at.
          .set({ passwordHash })
          .where(eq(users.id, reset.userId))
          .returning();
        await tx.delete(sessions).where(eq(sessions.userId, reset.userId));
        await tx.delete(passwordResets).where(eq(passwordResets.userId, reset.userId));
        return updated ?? null;
      });
      if (!updatedUser) {
        return Response.json({ error: "This recovery link is invalid or expired. Request a new one." }, { status: 400 });
      }
      await onPasswordChanged({ user: updatedUser, appOrigin: origin });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown recovery action." }, { status: 400 });
  } catch {
    return Response.json({ error: "Could not complete recovery. Please try again." }, { status: 500 });
  }
}
