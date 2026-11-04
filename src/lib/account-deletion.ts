import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activities,
  authFlows,
  authIdentities,
  emailVerifications,
  folioAiConversations,
  folioAiDailyUsage,
  folioAiMessages,
  folioAiPreferences,
  folioAiTasks,
  folioAiUsageReservations,
  googleAccounts,
  googleCalendars,
  googleEvents,
  ideas,
  milestones,
  notificationPreferences,
  notifications,
  passwordResets,
  projects,
  recentSearches,
  reminderDeliveries,
  savedFilters,
  sessions,
  subtasks,
  taskReminders,
  tasks,
  users,
} from "@/db/schema";
import { destroySession, verifyPassword, type FolioUser } from "@/lib/auth";
import { openToken } from "@/lib/crypto";
import { revokeToken } from "@/lib/google";

export class DeletionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeletionInputError";
  }
}

export class DeletionAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeletionAuthError";
  }
}

export interface AccountDeletionInput {
  user: FolioUser;
  confirmation: unknown;
  password?: unknown;
}

export interface AccountDeletionResult {
  ok: boolean;
  message: string;
}

/**
 * Permanently and securely deletes a user account and all owned workspace records.
 *
 * Requirements enforced:
 * - Server-verified identity: uses authenticated `user` object directly, never client-supplied IDs.
 * - Re-authentication: if the user has a password (`passwordHash`), the current password must match.
 * - Explicit intention confirmation: the user must type their exact email address or "delete my account".
 * - External token revocation: revokes Google OAuth tokens if connected.
 * - Transaction integrity: all user-owned records are deleted in dependency order inside a single database transaction.
 * - Data isolation: only records where `userId = user.id` are deleted; other users' records are strictly untouched.
 * - Session invalidation: deletes all database sessions and clears the HTTP-only session cookie.
 */
export async function deleteUserAccount(
  input: AccountDeletionInput,
): Promise<AccountDeletionResult> {
  const { user, confirmation, password } = input;

  if (!user || !user.id || !user.email) {
    throw new DeletionAuthError("Please sign in to delete your account.");
  }

  // 1. Validate confirmation phrase
  const normConf = typeof confirmation === "string" ? confirmation.trim().toLowerCase() : "";
  const normEmail = user.email.trim().toLowerCase();
  const isConfirmed = normConf === normEmail || normConf === "delete my account";

  if (!isConfirmed) {
    throw new DeletionInputError(
      `Please enter your email address (${user.email}) or "delete my account" to confirm deletion.`,
    );
  }

  // 2. Re-authenticate: verify current password if user has a password set
  if (user.passwordHash) {
    const rawPassword = typeof password === "string" ? password : "";
    if (!rawPassword) {
      throw new DeletionAuthError(
        "Please enter your current password to confirm account deletion.",
      );
    }
    const isPasswordValid = await verifyPassword(rawPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new DeletionAuthError(
        "The password you entered is incorrect. Account deletion was cancelled.",
      );
    }
  }

  // 3. Best-effort external token revocation (Google Calendar)
  try {
    const [account] = await db
      .select({ refreshTokenEnc: googleAccounts.refreshTokenEnc })
      .from(googleAccounts)
      .where(eq(googleAccounts.userId, user.id))
      .limit(1);

    if (account?.refreshTokenEnc) {
      const refreshToken = openToken(account.refreshTokenEnc);
      if (refreshToken) {
        await revokeToken(refreshToken).catch(() => {});
      }
    }
  } catch {
    // Non-blocking: failure to revoke external tokens must not block user account deletion
  }

  // 4. Atomic database deletion across all 25 user-owned tables
  await db.transaction(async (tx) => {
    // Child tables of tasks, calendar events, and AI conversations
    await tx.delete(subtasks).where(eq(subtasks.userId, user.id));
    await tx.delete(taskReminders).where(eq(taskReminders.userId, user.id));
    await tx.delete(googleEvents).where(eq(googleEvents.userId, user.id));
    await tx.delete(googleCalendars).where(eq(googleCalendars.userId, user.id));
    await tx.delete(googleAccounts).where(eq(googleAccounts.userId, user.id));

    // Folio AI records
    await tx.delete(folioAiTasks).where(eq(folioAiTasks.userId, user.id));
    await tx.delete(folioAiMessages).where(eq(folioAiMessages.userId, user.id));
    await tx.delete(folioAiConversations).where(eq(folioAiConversations.userId, user.id));
    await tx.delete(folioAiUsageReservations).where(eq(folioAiUsageReservations.userId, user.id));
    await tx.delete(folioAiDailyUsage).where(eq(folioAiDailyUsage.userId, user.id));
    await tx.delete(folioAiPreferences).where(eq(folioAiPreferences.userId, user.id));

    // Notifications and reminders
    await tx.delete(reminderDeliveries).where(eq(reminderDeliveries.userId, user.id));
    await tx.delete(notifications).where(eq(notifications.userId, user.id));
    await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, user.id));

    // Workspace core
    await tx.delete(activities).where(eq(activities.userId, user.id));
    await tx.delete(tasks).where(eq(tasks.userId, user.id));
    await tx.delete(milestones).where(eq(milestones.userId, user.id));
    await tx.delete(projects).where(eq(projects.userId, user.id));
    await tx.delete(ideas).where(eq(ideas.userId, user.id));
    await tx.delete(recentSearches).where(eq(recentSearches.userId, user.id));
    await tx.delete(savedFilters).where(eq(savedFilters.userId, user.id));

    // Authentication and verification records
    await tx.delete(authIdentities).where(eq(authIdentities.userId, user.id));
    await tx.delete(authFlows).where(eq(authFlows.linkUserId, user.id));
    await tx.delete(passwordResets).where(eq(passwordResets.userId, user.id));
    await tx.delete(emailVerifications).where(eq(emailVerifications.userId, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));

    // Finally delete the user row itself
    await tx.delete(users).where(eq(users.id, user.id));
  });

  // 5. Invalidate the session cookie
  try {
    await destroySession();
  } catch {
    // Cookie clearing is best-effort on server actions / routes
  }

  return {
    ok: true,
    message: "Your account and all associated workspace data have been permanently deleted.",
  };
}
