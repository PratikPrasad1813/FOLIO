import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import {
  folioAiConversations,
  folioAiDailyUsage,
  folioAiMessages,
  folioAiTasks,
  folioAiUsageReservations,
} from "@/db/schema";
import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import { AIUsageError, readAIUsage, reserveAIMessage } from "@/lib/folio-ai/usage";
import type { AIActionResult, AIReservation, AITaskRecord, AITaskStatus, AIUsage } from "@/lib/folio-ai/types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const USER_LOCK_SALT = 71_042;

async function lockUser(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, ${USER_LOCK_SALT}))`);
}

export function mapTaskRow(row: typeof folioAiTasks.$inferSelect): AITaskRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    generationId: row.generationId,
    reservationId: row.reservationId ?? null,
    userMessageId: row.userMessageId ?? null,
    assistantMessageId: row.assistantMessageId ?? null,
    prompt: row.prompt,
    modelId: row.modelId,
    status: row.status as AITaskStatus,
    stage: row.stage,
    partialContent: row.partialContent,
    tokenCount: row.tokenCount,
    usageTokenCount: row.usageTokenCount,
    plan: (row.plan as AITaskRecord["plan"]) ?? null,
    results: (row.results as AIActionResult[] | null) ?? null,
    errorMessage: row.errorMessage ?? null,
    startedAt: row.startedAt.toISOString(),
    heartbeatAt: row.heartbeatAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function deriveTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}

/**
 * Detects any queued or running tasks whose worker has stopped sending heartbeats
 * (or whose tab worker was unloaded on page refresh) and transitions them cleanly
 * to `failed`, preserving any partial output and releasing their usage reservation.
 * Never claims a task is running when its worker has stopped.
 */
export async function reconcileStaleAITasks(
  userId: string,
  options: { interruptTaskIds?: string[]; now?: Date } = {},
): Promise<AITaskRecord[]> {
  await ensureSchema();
  const now = options.now ?? new Date();
  const staleCutoff = new Date(now.getTime() - FOLIO_AI_CONFIG.staleTaskTimeoutMilliseconds);
  const explicitIds = (options.interruptTaskIds ?? []).filter(id =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  );

  return db.transaction(async tx => {
    await lockUser(tx, userId);
    const staleCondition = explicitIds.length
      ? or(lte(folioAiTasks.heartbeatAt, staleCutoff), inArray(folioAiTasks.id, explicitIds))
      : lte(folioAiTasks.heartbeatAt, staleCutoff);

    const staleTasks = await tx
      .select()
      .from(folioAiTasks)
      .where(
        and(
          eq(folioAiTasks.userId, userId),
          inArray(folioAiTasks.status, ["queued", "running"]),
          staleCondition,
        ),
      )
      .for("update");

    if (!staleTasks.length) return [];

    const reconciled: AITaskRecord[] = [];
    for (const task of staleTasks) {
      const wasExplicitReload = explicitIds.includes(task.id);
      const stage = task.partialContent.trim()
        ? "Worker stopped · partial response saved"
        : "Worker stopped before completion";
      const errorMessage = wasExplicitReload
        ? "Generation was interrupted when the page reloaded. Any partial output was saved and your daily allowance was not charged. You can resume or retry below."
        : "The AI worker stopped responding before completion. Any partial output was saved and your daily allowance was not charged. You can resume or retry below.";

      const [updatedTask] = await tx
        .update(folioAiTasks)
        .set({
          status: "failed",
          stage,
          errorMessage,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(folioAiTasks.id, task.id))
        .returning();

      if (task.assistantMessageId) {
        await tx
          .update(folioAiMessages)
          .set({
            content: task.partialContent,
            generationStatus: "error",
          })
          .where(and(eq(folioAiMessages.id, task.assistantMessageId), eq(folioAiMessages.userId, userId)));
      } else {
        await tx
          .update(folioAiMessages)
          .set({
            content: task.partialContent,
            generationStatus: "error",
          })
          .where(
            and(
              eq(folioAiMessages.userId, userId),
              eq(folioAiMessages.generationId, task.generationId),
              eq(folioAiMessages.role, "assistant"),
            ),
          );
      }

      if (task.reservationId) {
        const [resRow] = await tx
          .select()
          .from(folioAiUsageReservations)
          .where(and(eq(folioAiUsageReservations.id, task.reservationId), eq(folioAiUsageReservations.userId, userId)))
          .for("update");
        if (resRow && resRow.status === "reserved") {
          await tx
            .update(folioAiUsageReservations)
            .set({ status: "failed" })
            .where(eq(folioAiUsageReservations.id, resRow.id));
          await tx
            .update(folioAiDailyUsage)
            .set({
              reservedTokenCount: sql`greatest(${folioAiDailyUsage.reservedTokenCount} - ${resRow.reservedTokenCount}, 0)`,
              usedTokenCount: sql`${folioAiDailyUsage.usedTokenCount} + ${resRow.usedTokenCount}`,
              updatedAt: now,
            })
            .where(
              and(
                eq(folioAiDailyUsage.userId, userId),
                eq(folioAiDailyUsage.usageDate, resRow.usageDate),
              ),
            );
        }
      }

      if (updatedTask) reconciled.push(mapTaskRow(updatedTask));
    }

    return reconciled;
  });
}

export interface CreateAITaskInput {
  generationId: string;
  conversationId?: string | null;
  prompt: string;
  modelId?: string;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  resumeTaskId?: string | null;
  keepPartial?: boolean;
}

export interface CreateAITaskResult {
  task: AITaskRecord;
  conversation: typeof folioAiConversations.$inferSelect;
  reservation: AIReservation;
  usage: AIUsage;
  reused: boolean;
}

export async function createOrReuseAITask(
  userId: string,
  input: CreateAITaskInput,
  now = new Date(),
): Promise<CreateAITaskResult> {
  await reconcileStaleAITasks(userId, { now });

  // 1. Check if a task with this generationId already exists (idempotency on retry/reconnect).
  const [existingTask] = await db
    .select()
    .from(folioAiTasks)
    .where(and(eq(folioAiTasks.userId, userId), eq(folioAiTasks.generationId, input.generationId)))
    .limit(1);

  if (existingTask) {
    const [conversation] = await db
      .select()
      .from(folioAiConversations)
      .where(and(eq(folioAiConversations.id, existingTask.conversationId), eq(folioAiConversations.userId, userId)))
      .limit(1);
    const usage = await readAIUsage(userId, now);
    const reservation: AIReservation = {
      id: existingTask.reservationId ?? existingTask.id,
      generationId: existingTask.generationId,
      usageDate: usage.usageDate,
      expiresAt: new Date(now.getTime() + FOLIO_AI_CONFIG.reservationLeaseMilliseconds).toISOString(),
    };
    return {
      task: mapTaskRow(existingTask),
      conversation,
      reservation,
      usage,
      reused: true,
    };
  }

  // 2. Reserve account usage slot (atomic & idempotent by generationId).
  const reserveResult = await reserveAIMessage(userId, input.generationId, input.prompt.length, now);
  if (reserveResult.alreadyCompleted) {
    throw new AIUsageError(
      "This message was already accounted for. Start a new message to continue.",
      409,
      "already_completed",
      reserveResult.usage,
    );
  }

  const modelId = (input.modelId || FOLIO_AI_CONFIG.modelId).slice(0, 120);

  return db.transaction(async tx => {
    await lockUser(tx, userId);

    // Re-check inside lock in case of concurrent retry
    const [raceTask] = await tx
      .select()
      .from(folioAiTasks)
      .where(and(eq(folioAiTasks.userId, userId), eq(folioAiTasks.generationId, input.generationId)))
      .limit(1);
    if (raceTask) {
      const [conv] = await tx
        .select()
        .from(folioAiConversations)
        .where(eq(folioAiConversations.id, raceTask.conversationId))
        .limit(1);
      return {
        task: mapTaskRow(raceTask),
        conversation: conv,
        reservation: reserveResult.reservation,
        usage: reserveResult.usage,
        reused: true,
      };
    }

    // 3. Resolve or create the owning conversation
    let conversation: typeof folioAiConversations.$inferSelect | undefined;
    if (input.conversationId) {
      const [found] = await tx
        .select()
        .from(folioAiConversations)
        .where(and(eq(folioAiConversations.id, input.conversationId), eq(folioAiConversations.userId, userId)))
        .for("update")
        .limit(1);
      conversation = found;
    }
    if (!conversation) {
      const [createdConv] = await tx
        .insert(folioAiConversations)
        .values({
          userId,
          title: deriveTitle(input.prompt),
          messageCount: 0,
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      conversation = createdConv;
    }

    // 4. Handle resume / retry of an existing task in-place without duplicating messages
    if (input.resumeTaskId) {
      const [priorTask] = await tx
        .select()
        .from(folioAiTasks)
        .where(
          and(
            eq(folioAiTasks.id, input.resumeTaskId),
            eq(folioAiTasks.userId, userId),
            eq(folioAiTasks.conversationId, conversation.id),
          ),
        )
        .for("update")
        .limit(1);

      if (priorTask) {
        const preservedContent = input.keepPartial ? priorTask.partialContent : "";
        const preservedTokens = input.keepPartial ? priorTask.tokenCount : 0;
        const stage = input.keepPartial && preservedContent
          ? "Resuming from saved checkpoint…"
          : "Queued · preparing workspace context…";

        if (priorTask.assistantMessageId) {
          await tx
            .update(folioAiMessages)
            .set({
              content: preservedContent,
              generationId: input.generationId,
              generationStatus: null,
              plan: null,
              results: null,
            })
            .where(and(eq(folioAiMessages.id, priorTask.assistantMessageId), eq(folioAiMessages.userId, userId)));
        }

        const [resumed] = await tx
          .update(folioAiTasks)
          .set({
            generationId: input.generationId,
            reservationId: reserveResult.reservation.id,
            modelId,
            status: "queued",
            stage,
            partialContent: preservedContent,
            tokenCount: preservedTokens,
            usageTokenCount: 0,
            plan: null,
            results: null,
            errorMessage: null,
            startedAt: now,
            heartbeatAt: now,
            completedAt: null,
            updatedAt: now,
          })
          .where(eq(folioAiTasks.id, priorTask.id))
          .returning();

        await tx
          .update(folioAiConversations)
          .set({ lastMessageAt: now, updatedAt: now })
          .where(eq(folioAiConversations.id, conversation.id));

        return {
          task: mapTaskRow(resumed),
          conversation: { ...conversation, lastMessageAt: now, updatedAt: now },
          reservation: reserveResult.reservation,
          usage: reserveResult.usage,
          reused: false,
        };
      }
    }

    // 5. Insert user message (idempotent by primary key) and initial assistant message row
    let userMsgId = input.userMessageId || undefined;
    const [insertedUserMsg] = await tx
      .insert(folioAiMessages)
      .values({
        ...(userMsgId ? { id: userMsgId } : {}),
        userId,
        conversationId: conversation.id,
        role: "user",
        content: input.prompt,
        generationId: null,
        generationStatus: null,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (insertedUserMsg) userMsgId = insertedUserMsg.id;

    const assistantCreatedAt = new Date(now.getTime() + 1);
    let assistantMsgId = input.assistantMessageId || undefined;
    const [insertedAssistantMsg] = await tx
      .insert(folioAiMessages)
      .values({
        ...(assistantMsgId ? { id: assistantMsgId } : {}),
        userId,
        conversationId: conversation.id,
        role: "assistant",
        content: "",
        generationId: input.generationId,
        generationStatus: null,
        createdAt: assistantCreatedAt,
      })
      .onConflictDoUpdate({
        target: [folioAiMessages.userId, folioAiMessages.generationId],
        set: { generationStatus: null },
      })
      .returning();
    if (insertedAssistantMsg) assistantMsgId = insertedAssistantMsg.id;

    const addedCount = (insertedUserMsg ? 1 : 0) + (insertedAssistantMsg ? 1 : 0);
    const nextTitle =
      conversation.title === "New conversation" ? deriveTitle(input.prompt) : conversation.title;
    const [updatedConv] = await tx
      .update(folioAiConversations)
      .set({
        title: nextTitle,
        messageCount: conversation.messageCount + addedCount,
        lastMessageAt: assistantCreatedAt,
        updatedAt: assistantCreatedAt,
      })
      .where(eq(folioAiConversations.id, conversation.id))
      .returning();

    const [createdTask] = await tx
      .insert(folioAiTasks)
      .values({
        userId,
        conversationId: conversation.id,
        generationId: input.generationId,
        reservationId: reserveResult.reservation.id,
        userMessageId: userMsgId ?? null,
        assistantMessageId: assistantMsgId ?? null,
        prompt: input.prompt,
        modelId,
        status: "queued",
        stage: "Queued · preparing workspace context…",
        partialContent: "",
        tokenCount: 0,
        usageTokenCount: 0,
        startedAt: now,
        heartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      task: mapTaskRow(createdTask),
      conversation: updatedConv ?? conversation,
      reservation: reserveResult.reservation,
      usage: reserveResult.usage,
      reused: false,
    };
  });
}

export interface UpdateAITaskInput {
  status?: AITaskStatus;
  stage?: string;
  partialContent?: string;
  tokenCount?: number;
  usageTokens?: number;
  plan?: { actions: { id: string; params: Record<string, unknown> }[] } | null;
  results?: AIActionResult[] | null;
  errorMessage?: string | null;
}

export interface UpdateAITaskResult {
  task: AITaskRecord;
  usage: AIUsage;
  cancelled: boolean;
}

export async function updateAITaskProgress(
  userId: string,
  taskId: string,
  patch: UpdateAITaskInput,
  now = new Date(),
): Promise<UpdateAITaskResult> {
  await ensureSchema();

  return db.transaction(async tx => {
    await lockUser(tx, userId);

    const [task] = await tx
      .select()
      .from(folioAiTasks)
      .where(and(eq(folioAiTasks.id, taskId), eq(folioAiTasks.userId, userId)))
      .for("update")
      .limit(1);

    if (!task) {
      throw new AIUsageError("AI task was not found.", 404, "task_not_found");
    }

    // Never allow an out-of-order late heartbeat (running/queued) to overwrite a
    // task that has already reached a terminal or waiting state.
    if (
      (task.status === "cancelled" ||
        task.status === "completed" ||
        task.status === "waiting" ||
        task.status === "failed") &&
      (patch.status === "running" || patch.status === "queued")
    ) {
      const usage = await readUsageInTx(tx, userId, now);
      return { task: mapTaskRow(task), usage, cancelled: task.status === "cancelled" };
    }

    const nextStatus: AITaskStatus = patch.status ?? (task.status as AITaskStatus);
    const nextPartialContent =
      patch.partialContent !== undefined &&
      (patch.partialContent.length >= task.partialContent.length ||
        nextStatus === "completed" ||
        nextStatus === "waiting")
        ? patch.partialContent
        : task.partialContent;
    const nextTokenCount =
      typeof patch.tokenCount === "number" && Number.isFinite(patch.tokenCount)
        ? Math.max(task.tokenCount, Math.floor(patch.tokenCount))
        : task.tokenCount;
    const nextUsageTokenCount =
      typeof patch.usageTokens === "number" && Number.isFinite(patch.usageTokens)
        ? Math.min(
            FOLIO_AI_CONFIG.maxReservedTokensPerGeneration,
            Math.max(task.usageTokenCount, Math.floor(patch.usageTokens)),
          )
        : task.usageTokenCount;
    const nextPlan = patch.plan !== undefined ? patch.plan : (task.plan as AITaskRecord["plan"]);
    const nextResults = patch.results !== undefined ? patch.results : (task.results as AIActionResult[] | null);
    const nextStage =
      patch.stage?.trim() ||
      (nextStatus === "completed"
        ? "Completed"
        : nextStatus === "waiting"
          ? "Action plan ready · waiting for review"
          : nextStatus === "cancelled"
            ? "Cancelled by user"
            : nextStatus === "failed"
              ? "Execution failed"
              : task.stage);

    const isTerminalOrWaiting =
      nextStatus === "completed" ||
      nextStatus === "waiting" ||
      nextStatus === "failed" ||
      nextStatus === "cancelled";

    // Handle reservation lease renewal or finalization
    if (task.reservationId) {
      const [resRow] = await tx
        .select()
        .from(folioAiUsageReservations)
        .where(and(eq(folioAiUsageReservations.id, task.reservationId), eq(folioAiUsageReservations.userId, userId)))
        .for("update")
        .limit(1);

      if (resRow) {
        if (!isTerminalOrWaiting && resRow.status === "reserved") {
          // Heartbeat: extend the reservation lease so long-running tasks never expire mid-flight
          const renewedExpiry = new Date(now.getTime() + FOLIO_AI_CONFIG.reservationLeaseMilliseconds);
          await tx
            .update(folioAiUsageReservations)
            .set({
              expiresAt: renewedExpiry,
              usedTokenCount: Math.min(resRow.reservedTokenCount, nextUsageTokenCount),
            })
            .where(eq(folioAiUsageReservations.id, resRow.id));
        } else if (isTerminalOrWaiting && resRow.status === "reserved") {
          const resOutcome =
            nextStatus === "completed" || nextStatus === "waiting"
              ? "completed"
              : nextStatus === "cancelled"
                ? "cancelled"
                : "failed";
          const usedTokens = Math.max(
            resRow.usedTokenCount,
            Math.min(resRow.reservedTokenCount, nextUsageTokenCount),
          );
          await tx
            .update(folioAiUsageReservations)
            .set({
              status: resOutcome,
              usedTokenCount: usedTokens,
              completedAt: resOutcome === "completed" ? now : null,
            })
            .where(eq(folioAiUsageReservations.id, resRow.id));

          await tx
            .insert(folioAiDailyUsage)
            .values({ userId, usageDate: resRow.usageDate })
            .onConflictDoNothing({ target: [folioAiDailyUsage.userId, folioAiDailyUsage.usageDate] });

          await tx
            .update(folioAiDailyUsage)
            .set({
              reservedTokenCount: sql`greatest(${folioAiDailyUsage.reservedTokenCount} - ${resRow.reservedTokenCount}, 0)`,
              usedTokenCount: sql`${folioAiDailyUsage.usedTokenCount} + ${usedTokens}`,
              updatedAt: now,
            })
            .where(
              and(
                eq(folioAiDailyUsage.userId, userId),
                eq(folioAiDailyUsage.usageDate, resRow.usageDate),
              ),
            );
        }
      }
    }

    const completedAt =
      nextStatus === "completed" || nextStatus === "failed" || nextStatus === "cancelled"
        ? task.completedAt ?? now
        : null;

    const [updatedTask] = await tx
      .update(folioAiTasks)
      .set({
        status: nextStatus,
        stage: nextStage,
        partialContent: nextPartialContent,
        tokenCount: nextTokenCount,
        usageTokenCount: nextUsageTokenCount,
        plan: nextPlan ?? null,
        results: nextResults ?? null,
        errorMessage:
          nextStatus === "failed"
            ? patch.errorMessage || task.errorMessage || "Generation could not be completed."
            : null,
        heartbeatAt: now,
        completedAt,
        updatedAt: now,
      })
      .where(eq(folioAiTasks.id, task.id))
      .returning();

    // Sync the assistant message in folio_ai_messages so conversation history
    // always reflects the latest partial or final output across refreshes.
    const msgStatus =
      nextStatus === "completed" || nextStatus === "waiting"
        ? "complete"
        : nextStatus === "cancelled"
          ? "cancelled"
          : nextStatus === "failed"
            ? "error"
            : null;

    const messageUpdate = {
      content: nextPartialContent,
      generationStatus: msgStatus,
      plan: nextPlan ?? null,
      results: nextResults ?? null,
    };

    if (task.assistantMessageId) {
      await tx
        .update(folioAiMessages)
        .set(messageUpdate)
        .where(and(eq(folioAiMessages.id, task.assistantMessageId), eq(folioAiMessages.userId, userId)));
    } else {
      await tx
        .update(folioAiMessages)
        .set(messageUpdate)
        .where(
          and(
            eq(folioAiMessages.userId, userId),
            eq(folioAiMessages.generationId, task.generationId),
            eq(folioAiMessages.role, "assistant"),
          ),
        );
    }

    await tx
      .update(folioAiConversations)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(folioAiConversations.id, task.conversationId));

    const usage = await readUsageInTx(tx, userId, now);
    return {
      task: mapTaskRow(updatedTask),
      usage,
      cancelled: nextStatus === "cancelled",
    };
  });
}

async function readUsageInTx(tx: Tx, userId: string, now: Date): Promise<AIUsage> {
  const date = now.toISOString().slice(0, 10);
  const resetAt = new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000).toISOString();
  await tx
    .insert(folioAiDailyUsage)
    .values({ userId, usageDate: date })
    .onConflictDoNothing({ target: [folioAiDailyUsage.userId, folioAiDailyUsage.usageDate] });
  const [row] = await tx
    .select()
    .from(folioAiDailyUsage)
    .where(and(eq(folioAiDailyUsage.userId, userId), eq(folioAiDailyUsage.usageDate, date)))
    .limit(1);
  const usedTokens = row?.usedTokenCount ?? 0;
  const reservedTokens = row?.reservedTokenCount ?? 0;
  const limit = FOLIO_AI_CONFIG.dailyTokenLimit;
  return {
    plan: "free",
    modelId: FOLIO_AI_CONFIG.modelId,
    usageDate: date,
    usedPercent: Math.min(100, Math.round(((usedTokens + reservedTokens) / limit) * 100)),
    limitReached: limit - usedTokens - reservedTokens < FOLIO_AI_CONFIG.maxReservedTokensPerGeneration,
    resetAt,
  };
}

export async function listConversationTasks(
  userId: string,
  conversationId: string,
  options: { interruptTaskIds?: string[]; now?: Date } = {},
): Promise<AITaskRecord[]> {
  await reconcileStaleAITasks(userId, options);
  const rows = await db
    .select()
    .from(folioAiTasks)
    .where(and(eq(folioAiTasks.userId, userId), eq(folioAiTasks.conversationId, conversationId)))
    .orderBy(asc(folioAiTasks.createdAt))
    .limit(200);
  return rows.map(mapTaskRow);
}

export async function getAITaskById(
  userId: string,
  taskId: string,
  options: { interruptTaskIds?: string[]; now?: Date } = {},
): Promise<AITaskRecord | null> {
  await reconcileStaleAITasks(userId, options);
  const [row] = await db
    .select()
    .from(folioAiTasks)
    .where(and(eq(folioAiTasks.id, taskId), eq(folioAiTasks.userId, userId)))
    .limit(1);
  return row ? mapTaskRow(row) : null;
}

export async function listActiveUserAITasks(
  userId: string,
  options: { interruptTaskIds?: string[]; now?: Date } = {},
): Promise<AITaskRecord[]> {
  await reconcileStaleAITasks(userId, options);
  const rows = await db
    .select()
    .from(folioAiTasks)
    .where(
      and(
        eq(folioAiTasks.userId, userId),
        inArray(folioAiTasks.status, ["queued", "running", "waiting"]),
      ),
    )
    .orderBy(desc(folioAiTasks.updatedAt))
    .limit(20);
  return rows.map(mapTaskRow);
}
