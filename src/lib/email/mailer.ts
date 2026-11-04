import nodemailer from "nodemailer";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { buildWelcomeEmail, type RenderedEmail } from "@/lib/email/templates";

export interface EmailSendResult {
  sent: boolean;
  skipped?: "unconfigured" | "unroutable" | "already_sent" | "missing_user";
  error?: string;
}

export interface EmailTransportLike {
  sendMail: (mail: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }) => Promise<unknown>;
  close?: () => void;
}

let customTransportFactory: (() => EmailTransportLike) | null = null;

/** Used only by automated test suites to inspect or simulate SMTP behavior safely. */
export function setEmailTransportFactoryForTests(factory: (() => EmailTransportLike) | null) {
  customTransportFactory = factory;
}

export function isEmailDeliveryConfigured(): boolean {
  if (customTransportFactory) return true;
  const smtpUrl = process.env.SMTP_URL?.trim();
  const smtpFrom = process.env.SMTP_FROM?.trim();
  if (!smtpUrl || !smtpFrom) return false;
  if (process.env.NODE_ENV === "production") {
    try {
      return Boolean(process.env.APP_URL && new URL(process.env.APP_URL).protocol === "https:");
    } catch {
      return false;
    }
  }
  return true;
}

export function isRoutableEmail(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) return false;
  if (
    normalized.endsWith("@example.invalid") ||
    normalized.endsWith("@neon-auth.invalid") ||
    (!customTransportFactory && normalized.endsWith("@example.test"))
  ) {
    return false;
  }
  return true;
}

export async function sendRenderedEmail(to: string, rendered: RenderedEmail): Promise<EmailSendResult> {
  const recipient = to.trim().toLowerCase();
  if (!isEmailDeliveryConfigured()) {
    return { sent: false, skipped: "unconfigured" };
  }
  if (!isRoutableEmail(recipient)) {
    return { sent: false, skipped: "unroutable" };
  }

  const from = process.env.SMTP_FROM?.trim() || "Folio <no-reply@folio.local>";
  const transport: EmailTransportLike = customTransportFactory
    ? customTransportFactory()
    : nodemailer.createTransport({ url: process.env.SMTP_URL!.trim(), requireTLS: true });

  try {
    await transport.sendMail({
      from,
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    return { sent: true };
  } catch (error) {
    console.error(`Email delivery (${rendered.id}) failed:`, error instanceof Error ? error.name : "TransportError");
    return { sent: false, error: "Email could not be delivered right now." };
  } finally {
    try {
      transport.close?.();
    } catch {
      // Transport cleanup should never throw into application flows.
    }
  }
}

/**
 * Sends the Welcome email strictly once per persisted Folio user, and only
 * after the user record exists in PostgreSQL. If SMTP fails, rolls back the
 * claim so delivery state is never misrepresented.
 */
export async function sendWelcomeEmailOnce(options: {
  userId: string;
  appOrigin: string;
}): Promise<EmailSendResult> {
  const [user] = await db.select().from(users).where(eq(users.id, options.userId)).limit(1);
  if (!user) return { sent: false, skipped: "missing_user" };
  if (user.welcomeEmailSentAt) return { sent: false, skipped: "already_sent" };
  if (!isEmailDeliveryConfigured()) return { sent: false, skipped: "unconfigured" };
  if (!isRoutableEmail(user.email)) return { sent: false, skipped: "unroutable" };

  const claimedAt = new Date();
  const [claimed] = await db
    .update(users)
    .set({ welcomeEmailSentAt: claimedAt })
    .where(and(eq(users.id, user.id), isNull(users.welcomeEmailSentAt)))
    .returning({ id: users.id });

  if (!claimed) return { sent: false, skipped: "already_sent" };

  const rendered = buildWelcomeEmail({
    name: user.name,
    email: user.email,
    appOrigin: options.appOrigin,
    provider: user.provider,
    weeklyGoal: user.weeklyGoal,
    workUses: user.personal?.workUses ?? null,
  });

  const outcome = await sendRenderedEmail(user.email, rendered);
  if (!outcome.sent) {
    await db
      .update(users)
      .set({ welcomeEmailSentAt: null })
      .where(eq(users.id, user.id))
      .catch(() => {});
  }
  return outcome;
}
