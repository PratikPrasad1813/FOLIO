import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { authIdentities, folioAiPreferences, notificationPreferences, users } from "@/db/schema";
import { getOrCreatePreferences, recomputeUserRelativeReminders } from "@/lib/reminder-processor";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notifications";
import { DEFAULT_AI_PREFERENCES, getAIPreferences, sanitizePreferences } from "@/lib/folio-ai/preferences";
import { DEFAULT_PERSONAL, ONBOARDING_STEPS, ONBOARDING_VERSION, validatePersonal } from "@/lib/personalization";
import { isValidTimezone } from "@/lib/timezone";
import { publicUser } from "@/lib/auth";

export async function readProfile(user: typeof users.$inferSelect) {
  const [notifications, assistant, identities] = await Promise.all([
    getOrCreatePreferences(user.id), getAIPreferences(user.id),
    db.select({ provider: authIdentities.provider }).from(authIdentities).where(eq(authIdentities.userId, user.id)),
  ]);
  return { user: publicUser(user), personal: { ...DEFAULT_PERSONAL, ...user.personal }, timezone: notifications.timezone,
    notificationsEnabled: notifications.enabled, quietHoursEnabled: notifications.quietHoursEnabled,
    assistant: assistant.preferences, onboardingStep: user.onboardingStep, onboardingCompleted: Boolean(user.onboardingCompletedAt),
    linkedProviders: identities.map(item => item.provider),
  };
}
export async function updateProfile(userId: string, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Please send a valid profile update.");
  const body = raw as Record<string, unknown>;
  const allowed = ["name","weeklyGoal","personal","timezone","notificationsEnabled","quietHoursEnabled","assistant","step","complete","firstAction","skipSetup","guideDismissed"];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error("Unknown profile field.");
  const personalPatch = body.personal === undefined ? {} : validatePersonal(body.personal);
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80 || /[\u0000-\u001f]/.test(body.name))) throw new Error("Please enter a name using 1–80 characters.");
  if (body.weeklyGoal !== undefined && (typeof body.weeklyGoal !== "number" || !Number.isInteger(body.weeklyGoal) || body.weeklyGoal < 1 || body.weeklyGoal > 200)) throw new Error("Your weekly goal must be between 1 and 200.");
  if (body.timezone !== undefined && !isValidTimezone(body.timezone)) throw new Error("Choose a valid IANA timezone.");
  for (const key of ["notificationsEnabled","quietHoursEnabled","complete","skipSetup","guideDismissed"]) if (body[key] !== undefined && typeof body[key] !== "boolean") throw new Error("Invalid preference value.");
  if (body.step !== undefined && (typeof body.step !== "number" || !Number.isInteger(body.step) || body.step < 0 || body.step >= ONBOARDING_STEPS.length)) throw new Error("Invalid onboarding step.");
  let assistantPatch = {};
  if (body.assistant !== undefined) {
    if (!body.assistant || typeof body.assistant !== "object" || Array.isArray(body.assistant)) throw new Error("Invalid assistant preferences.");
    const input = body.assistant as Record<string, unknown>;
    if (Object.keys(input).some(key => !["assistantName","presentation","style"].includes(key))) throw new Error("Set model selection from Folio AI settings.");
    assistantPatch = sanitizePreferences(input);
  }
  const result = await db.transaction(async tx => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!before) throw new Error("Your account is unavailable.");
    const step = body.step as number | undefined;
    if (!before.onboardingCompletedAt && step !== undefined && step > before.onboardingStep + 1) throw new Error("Please complete this step before continuing.");
    // Two paths complete onboarding: the setup flow finishing its last step, or
    // the user's first successfully created workspace item (which may happen at
    // any point during setup, for example creating a project straight from the
    // first-time dashboard). `firstAction` marks the second path and is only
    // sent after the server has confirmed the creation.
    if (body.complete && body.firstAction !== true && body.skipSetup !== true && !before.onboardingCompletedAt && before.onboardingStep < ONBOARDING_STEPS.length - 1) {
      throw new Error("Please finish the setup steps first.");
    }
    const personal = { ...DEFAULT_PERSONAL, ...before.personal, ...personalPatch };
    if (personal.gender !== "self") personal.genderDescription = null;
    const [updated] = await tx.update(users).set({
      ...(body.name !== undefined ? { name: (body.name as string).trim() } : {}),
      ...(body.weeklyGoal !== undefined ? { weeklyGoal: body.weeklyGoal as number } : {}),
      personal,
      ...(step !== undefined ? { onboardingStep: step } : body.skipSetup ? { onboardingStep: ONBOARDING_STEPS.length - 1 } : {}),
      ...(body.complete ? { onboardingCompletedAt: before.onboardingCompletedAt || new Date(), onboardingVersion: ONBOARDING_VERSION } : {}),
      ...(body.guideDismissed !== undefined ? { guideDismissedAt: body.guideDismissed ? (before.guideDismissedAt || new Date()) : null } : {}),
    }).where(eq(users.id, userId)).returning();
    const [existing] = await tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1);
    const notificationPatch = {
      ...(typeof body.timezone === "string" ? { timezone: body.timezone, timezoneAutoDetected: true } : {}),
      ...(typeof body.notificationsEnabled === "boolean" ? { enabled: body.notificationsEnabled } : {}),
      ...(typeof body.quietHoursEnabled === "boolean" ? { quietHoursEnabled: body.quietHoursEnabled } : {}),
    };
    await tx.insert(notificationPreferences).values({ userId, ...DEFAULT_NOTIFICATION_PREFERENCES, ...notificationPatch }).onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...notificationPatch, updatedAt: new Date() } });
    if (Object.keys(assistantPatch).length) await tx.insert(folioAiPreferences).values({ userId, ...DEFAULT_AI_PREFERENCES, ...assistantPatch }).onConflictDoUpdate({ target: folioAiPreferences.userId, set: { ...assistantPatch, updatedAt: new Date() } });
    return { user: updated, timezoneChanged: typeof body.timezone === "string" && body.timezone !== existing?.timezone };
  });
  if (result.timezoneChanged && typeof body.timezone === "string") await recomputeUserRelativeReminders(userId, body.timezone);
  return readProfile(result.user);
}
