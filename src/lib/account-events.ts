import type { FolioUser } from "@/lib/auth";
import { personalAddress } from "@/lib/personalization";
import { deliverNotification, getOrCreatePreferences } from "@/lib/reminder-processor";
import {
  buildCalendarConnectedEmail,
  buildPasswordChangedEmail,
  buildProviderLinkedEmail,
} from "@/lib/email/templates";
import { sendRenderedEmail, sendWelcomeEmailOnce, type EmailSendResult } from "@/lib/email/mailer";

export async function onAccountCreated(options: {
  user: FolioUser;
  appOrigin: string;
}): Promise<{ emailResult: EmailSendResult }> {
  const { user, appOrigin } = options;
  const greetingName = personalAddress(user.name, user.personal);

  try {
    const prefs = await getOrCreatePreferences(user.id);
    await deliverNotification(user.id, prefs, {
      category: "system",
      type: "system_info",
      title: greetingName && greetingName !== "there" ? `Welcome to Folio, ${greetingName}` : "Welcome to your Folio workspace",
      description: "Your workspace starts calm and clutter-free. Create your first project whenever you are ready, or tailor your rhythm in Settings.",
      entityType: "settings",
      entityId: null,
      metadata: {
        systemKind: "welcome",
        actionLabel: "Review preferences",
      },
      dedupeKey: `system:welcome:${user.id}`,
      sourceType: "account",
      sourceId: user.id,
    });
  } catch (error) {
    console.error("Welcome notification could not be recorded:", error instanceof Error ? error.name : "Error");
  }

  const emailResult = await sendWelcomeEmailOnce({ userId: user.id, appOrigin });
  return { emailResult };
}

export async function onEmailVerified(options: { user: FolioUser }): Promise<void> {
  const { user } = options;
  try {
    const prefs = await getOrCreatePreferences(user.id);
    await deliverNotification(user.id, prefs, {
      category: "system",
      type: "system_info",
      title: "Email address verified",
      description: `${user.email} is confirmed for account recovery and sign-in protection.`,
      entityType: "settings",
      entityId: null,
      metadata: {
        systemKind: "verification",
        actionLabel: "Account settings",
      },
      dedupeKey: `security:email-verified:${user.id}:${user.email.toLowerCase()}`,
      sourceType: "account",
      sourceId: user.id,
    });
  } catch (error) {
    console.error("Verification notification could not be recorded:", error instanceof Error ? error.name : "Error");
  }
}

export async function onPasswordChanged(options: {
  user: FolioUser;
  appOrigin: string;
  changedAt?: Date;
}): Promise<{ emailResult: EmailSendResult }> {
  const { user, appOrigin } = options;
  const now = options.changedAt ?? new Date();
  const minuteBucket = Math.floor(now.getTime() / 60_000);

  try {
    const prefs = await getOrCreatePreferences(user.id);
    await deliverNotification(user.id, prefs, {
      category: "system",
      type: "system_info",
      title: "Your password was updated",
      description: "Previous browser sessions were signed out automatically to keep your workspace private.",
      entityType: "settings",
      entityId: null,
      metadata: {
        systemKind: "security",
        actionLabel: "Review account",
      },
      dedupeKey: `security:password-changed:${user.id}:${minuteBucket}`,
      sourceType: "account",
      sourceId: user.id,
    });
  } catch (error) {
    console.error("Password update notification could not be recorded:", error instanceof Error ? error.name : "Error");
  }

  const rendered = buildPasswordChangedEmail({
    name: user.name,
    email: user.email,
    changedAt: now,
    appOrigin,
  });
  const emailResult = await sendRenderedEmail(user.email, rendered);
  return { emailResult };
}

export async function onProviderLinked(options: {
  user: FolioUser;
  provider: "google" | "github";
  providerEmail: string;
  appOrigin: string;
}): Promise<{ emailResult: EmailSendResult }> {
  const { user, provider, providerEmail, appOrigin } = options;
  const providerLabel = provider === "google" ? "Google" : "GitHub";

  try {
    const prefs = await getOrCreatePreferences(user.id);
    await deliverNotification(user.id, prefs, {
      category: "system",
      type: "system_info",
      title: `${providerLabel} sign-in connected`,
      description: `You can now sign in to Folio with ${providerLabel} (${providerEmail}).`,
      entityType: "settings",
      entityId: null,
      metadata: {
        systemKind: "security",
        actionLabel: "Sign-in settings",
      },
      dedupeKey: `security:provider-linked:${user.id}:${provider}`,
      sourceType: "account",
      sourceId: user.id,
    });
  } catch (error) {
    console.error("Provider link notification could not be recorded:", error instanceof Error ? error.name : "Error");
  }

  const rendered = buildProviderLinkedEmail({
    name: user.name,
    email: user.email,
    provider,
    providerEmail,
    appOrigin,
  });
  const emailResult = await sendRenderedEmail(user.email, rendered);
  return { emailResult };
}

export async function onGoogleCalendarConnected(options: {
  user: FolioUser;
  googleEmail: string;
  writeEnabled: boolean;
  appOrigin: string;
}): Promise<{ emailResult: EmailSendResult }> {
  const { user, googleEmail, writeEnabled, appOrigin } = options;

  try {
    const prefs = await getOrCreatePreferences(user.id);
    await deliverNotification(user.id, prefs, {
      category: "system",
      type: "system_info",
      title: "Google Calendar connected",
      description: `${googleEmail} is now synced with Folio (${writeEnabled ? "read & event creation" : "read-only"}).`,
      entityType: "settings",
      entityId: null,
      metadata: {
        systemKind: "integration",
        actionLabel: "Manage integration",
      },
      dedupeKey: `integration:google-calendar:${user.id}:${googleEmail.toLowerCase()}`,
      sourceType: "integration",
      sourceId: user.id,
    });
  } catch (error) {
    console.error("Calendar integration notification could not be recorded:", error instanceof Error ? error.name : "Error");
  }

  const rendered = buildCalendarConnectedEmail({
    name: user.name,
    email: user.email,
    googleEmail,
    writeEnabled,
    appOrigin,
  });
  const emailResult = await sendRenderedEmail(user.email, rendered);
  return { emailResult };
}
