import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailVerifications, users } from "@/db/schema";
import {
  AuthenticationError,
  allowAuthAttempt,
  getUser,
  hashToken,
  requestOrigin,
  sameOrigin,
  type FolioUser,
} from "@/lib/auth";
import { buildEmailVerificationEmail } from "@/lib/email/templates";
import { isEmailDeliveryConfigured, isRoutableEmail, sendRenderedEmail } from "@/lib/email/mailer";
import { onEmailVerified } from "@/lib/account-events";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "Please send valid JSON." }, { status: 400 });

    if (!await allowAuthAttempt(request, "email-verify")) {
      return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }

    if (body.action === "request") {
      let user: FolioUser;
      try {
        user = await getUser();
      } catch (err) {
        return Response.json(
          { error: err instanceof AuthenticationError ? err.message : "Please sign in to verify your email." },
          { status: 401 },
        );
      }

      if (user.emailVerifiedAt) {
        return Response.json({
          ok: true,
          sent: false,
          alreadyVerified: true,
          message: "Your email address is already verified.",
        });
      }

      if (!isEmailDeliveryConfigured()) {
        return Response.json(
          {
            error: "Email verification is temporarily unavailable. Please try again later.",
            code: "unconfigured",
          },
          { status: 503 },
        );
      }

      if (!isRoutableEmail(user.email)) {
        return Response.json(
          { error: "This account uses a reserved placeholder address that cannot receive email." },
          { status: 400 },
        );
      }

      if (!await allowAuthAttempt(request, "email-verify-account", user.email)) {
        return Response.json({ error: "Too many verification requests. Please wait 15 minutes." }, { status: 429 });
      }

      const token = randomBytes(32).toString("hex");
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);

      await db.delete(emailVerifications).where(eq(emailVerifications.userId, user.id));
      await db.insert(emailVerifications).values({
        tokenHash,
        userId: user.id,
        email: user.email.toLowerCase(),
        expiresAt,
      });

      const rendered = buildEmailVerificationEmail({
        name: user.name,
        email: user.email,
        token,
        expiresInHours: 24,
        appOrigin: requestOrigin(request),
      });

      const result = await sendRenderedEmail(user.email, rendered);
      if (!result.sent) {
        await db.delete(emailVerifications).where(eq(emailVerifications.tokenHash, tokenHash)).catch(() => {});
        return Response.json(
          {
            error: "We couldn’t deliver the verification email right now. Please try again shortly.",
            code: "delivery_failed",
          },
          { status: 502 },
        );
      }

      return Response.json({
        ok: true,
        sent: true,
        message: `A 24-hour verification link was sent to ${user.email}.`,
      });
    }

    if (body.action === "confirm") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!/^[a-f0-9]{64}$/.test(token)) {
        return Response.json(
          {
            code: "invalid",
            error: "This verification link is invalid. Sign in to request a fresh verification link from Settings.",
          },
          { status: 400 },
        );
      }

      const tokenHash = hashToken(token);
      const outcome = await db.transaction(async (tx): Promise<
        | { status: "verified"; user: FolioUser }
        | { status: "expired" }
        | { status: "invalid" }
      > => {
        const [record] = await tx
          .delete(emailVerifications)
          .where(eq(emailVerifications.tokenHash, tokenHash))
          .returning();

        if (!record) return { status: "invalid" };
        if (record.expiresAt.getTime() <= Date.now()) {
          return { status: "expired" };
        }

        const [updated] = await tx
          .update(users)
          .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
          .where(and(eq(users.id, record.userId), eq(sql`lower(${users.email})`, record.email.toLowerCase())))
          .returning();

        if (!updated) return { status: "invalid" };
        await tx.delete(emailVerifications).where(eq(emailVerifications.userId, updated.id));
        return { status: "verified", user: updated };
      });

      if (outcome.status === "expired") {
        return Response.json(
          {
            code: "expired",
            error: "This verification link has expired after 24 hours. Sign in to Folio Settings to send a fresh link.",
          },
          { status: 400 },
        );
      }

      if (outcome.status === "invalid") {
        return Response.json(
          {
            code: "invalid",
            error: "This verification link is invalid or has already been used.",
          },
          { status: 400 },
        );
      }

      await onEmailVerified({ user: outcome.user });
      return Response.json({
        ok: true,
        email: outcome.user.email,
        message: `${outcome.user.email} is now verified.`,
      });
    }

    return Response.json({ error: "Unknown verification action." }, { status: 400 });
  } catch {
    return Response.json({ error: "Could not complete email verification. Please try again." }, { status: 500 });
  }
}
