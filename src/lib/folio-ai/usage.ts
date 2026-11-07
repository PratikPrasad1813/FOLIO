import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ensureSchema } from "@/db/migrate";
import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import type { AIReservation, AIUsage } from "@/lib/folio-ai/types";

export class AIUsageError extends Error {
  constructor(message: string, public status: number, public code: string, public usage?: AIUsage) {
    super(message);
    this.name = "AIUsageError";
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const DAILY_TOKEN_LIMIT = FOLIO_AI_CONFIG.dailyTokenLimit;
const RESERVED_TOKEN_COUNT = FOLIO_AI_CONFIG.maxReservedTokensPerGeneration;
const USER_LOCK_SALT = 71_042;
const utcDate = (date = new Date()) => date.toISOString().slice(0, 10);
const nextUtcReset = (date: string) => new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000).toISOString();

async function lockUser(tx: Tx, userId: string) {
  // Transaction lock makes reserve/release/complete atomic across tabs and
  // serverless instances. Collisions only serialize unrelated users.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, ${USER_LOCK_SALT}))`);
}
async function ensureDailyRow(tx: Tx, userId: string, date: string) {
  await tx.insert(schema.folioAiDailyUsage).values({ userId, usageDate: date })
    .onConflictDoNothing({ target: [schema.folioAiDailyUsage.userId, schema.folioAiDailyUsage.usageDate] });
}
async function expireReservations(tx: Tx, userId: string, now: Date) {
  const expired = await tx.select({
    usageDate: schema.folioAiUsageReservations.usageDate,
    reservedTokenCount: schema.folioAiUsageReservations.reservedTokenCount,
    usedTokenCount: schema.folioAiUsageReservations.usedTokenCount,
  })
    .from(schema.folioAiUsageReservations)
    .where(and(eq(schema.folioAiUsageReservations.userId, userId), eq(schema.folioAiUsageReservations.status, "reserved"), lte(schema.folioAiUsageReservations.expiresAt, now)))
    .for("update");
  if (!expired.length) return;
  await tx.update(schema.folioAiUsageReservations).set({ status: "expired" })
    .where(and(eq(schema.folioAiUsageReservations.userId, userId), eq(schema.folioAiUsageReservations.status, "reserved"), lte(schema.folioAiUsageReservations.expiresAt, now)));
  const totals = new Map<string, { reservedTokens: number; usedTokens: number }>();
  for (const item of expired) {
    const total = totals.get(item.usageDate) ?? { reservedTokens: 0, usedTokens: 0 };
    total.reservedTokens += item.reservedTokenCount;
    total.usedTokens += item.usedTokenCount;
    totals.set(item.usageDate, total);
  }
  for (const [usageDate, total] of totals) {
    await ensureDailyRow(tx, userId, usageDate);
    await tx.update(schema.folioAiDailyUsage)
      .set({
        reservedTokenCount: sql`greatest(${schema.folioAiDailyUsage.reservedTokenCount} - ${total.reservedTokens}, 0)`,
        usedTokenCount: sql`${schema.folioAiDailyUsage.usedTokenCount} + ${total.usedTokens}`,
        updatedAt: now,
      })
      .where(and(eq(schema.folioAiDailyUsage.userId, userId), eq(schema.folioAiDailyUsage.usageDate, usageDate)));
  }
}
interface UsageSummary {
  usage: AIUsage;
  usedTokens: number;
  reservedTokens: number;
  available: number;
}

async function summary(tx: Tx, userId: string, date: string): Promise<UsageSummary> {
  await ensureDailyRow(tx, userId, date);
  const [row] = await tx.select().from(schema.folioAiDailyUsage)
    .where(and(eq(schema.folioAiDailyUsage.userId, userId), eq(schema.folioAiDailyUsage.usageDate, date))).limit(1).for("update");
  const usedTokens = row?.usedTokenCount ?? 0;
  const reservedTokens = row?.reservedTokenCount ?? 0;
  const available = Math.max(0, DAILY_TOKEN_LIMIT - usedTokens - reservedTokens);
  return {
    usage: {
      plan: "free",
      modelId: FOLIO_AI_CONFIG.modelId,
      usageDate: date,
      usedPercent: Math.min(100, Math.round(((usedTokens + reservedTokens) / DAILY_TOKEN_LIMIT) * 100)),
      limitReached: available < RESERVED_TOKEN_COUNT,
      resetAt: nextUtcReset(date),
    },
    usedTokens,
    reservedTokens,
    available,
  };
}

export async function readAIUsage(userId: string, now = new Date()): Promise<AIUsage> {
  await ensureSchema();
  const date = utcDate(now);
  return db.transaction(async tx => {
    await lockUser(tx, userId);
    await expireReservations(tx, userId, now);
    return (await summary(tx, userId, date)).usage;
  });
}

export interface ReserveResult { reservation: AIReservation; usage: AIUsage; alreadyCompleted: boolean; reused: boolean }
interface ReserveFailure { failure: { message: string; status: number; code: string }; usage: AIUsage }

export async function reserveAIMessage(userId: string, generationId: string, _inputCharacters: number, now = new Date()): Promise<ReserveResult> {
  await ensureSchema();
  const date = utcDate(now);
  const outcome = await db.transaction(async (tx: Tx) => {
    await lockUser(tx, userId);
    // Commit timeout cleanup even if this request is later denied.
    await expireReservations(tx, userId, now);
    const [existing] = await tx.select().from(schema.folioAiUsageReservations)
      .where(and(eq(schema.folioAiUsageReservations.userId, userId), eq(schema.folioAiUsageReservations.generationId, generationId))).limit(1).for("update");
    const usage = await summary(tx, userId, date);
    if (existing?.status === "completed") {
      return { reservation: { id: existing.id, generationId, usageDate: existing.usageDate, expiresAt: existing.expiresAt.toISOString() }, usage: usage.usage, alreadyCompleted: true, reused: true } as ReserveResult;
    }
    if (existing?.status === "reserved" && existing.expiresAt > now) {
      return { reservation: { id: existing.id, generationId, usageDate: existing.usageDate, expiresAt: existing.expiresAt.toISOString() }, usage: usage.usage, alreadyCompleted: false, reused: true } as ReserveResult;
    }
    if (existing) return { failure: { message: "This generation request has expired or was already closed. Start a new message.", status: 409, code: "reservation_closed" }, usage: usage.usage } as ReserveFailure;
    if (usage.usedTokens + usage.reservedTokens + RESERVED_TOKEN_COUNT > DAILY_TOKEN_LIMIT) {
      return { failure: { message: "There isn’t enough of your daily Folio AI usage allowance for this request. It resets at the displayed time. You can continue using the rest of Folio normally.", status: 429, code: "daily_token_limit_reached" }, usage: usage.usage } as ReserveFailure;
    }
    const expiresAt = new Date(now.getTime() + FOLIO_AI_CONFIG.reservationLeaseMilliseconds);
    const [reservation] = await tx.insert(schema.folioAiUsageReservations).values({
      userId,
      generationId,
      usageDate: date,
      reservedTokenCount: RESERVED_TOKEN_COUNT,
      usedTokenCount: 0,
      expiresAt,
      status: "reserved",
    }).returning();
    await tx.update(schema.folioAiDailyUsage)
      .set({ reservedTokenCount: sql`${schema.folioAiDailyUsage.reservedTokenCount} + ${RESERVED_TOKEN_COUNT}`, updatedAt: now })
      .where(and(eq(schema.folioAiDailyUsage.userId, userId), eq(schema.folioAiDailyUsage.usageDate, date)));
    return {
      reservation: { id: reservation.id, generationId, usageDate: date, expiresAt: expiresAt.toISOString() },
      usage: {
        ...usage.usage,
        usedPercent: Math.min(100, Math.round(
          ((usage.usedTokens + usage.reservedTokens + RESERVED_TOKEN_COUNT) / DAILY_TOKEN_LIMIT) * 100,
        )),
        limitReached: usage.available - RESERVED_TOKEN_COUNT < RESERVED_TOKEN_COUNT,
      },
      alreadyCompleted: false,
      reused: false,
    } as ReserveResult;
  });
  if ("failure" in outcome) throw new AIUsageError(outcome.failure.message, outcome.failure.status, outcome.failure.code, outcome.usage);
  return outcome;
}

interface FinishSuccess { usage: AIUsage; idempotent: boolean }
interface FinishFailure { failure: { message: string; status: number; code: string }; usage?: AIUsage }
export async function finishAIReservation(
  userId: string,
  reservationId: string,
  outcome: "completed" | "failed" | "cancelled",
  usedTokens?: number,
  now = new Date(),
): Promise<FinishSuccess> {
  await ensureSchema();
  const date = utcDate(now);
  const result = await db.transaction(async (tx: Tx) => {
    await lockUser(tx, userId);
    await expireReservations(tx, userId, now);
    const [reservation] = await tx.select().from(schema.folioAiUsageReservations)
      .where(and(eq(schema.folioAiUsageReservations.userId, userId), eq(schema.folioAiUsageReservations.id, reservationId))).limit(1).for("update");
    if (!reservation) return { failure: { message: "AI generation reservation was not found.", status: 404, code: "reservation_not_found" } } as FinishFailure;
    if (reservation.status === "completed") {
      if (outcome !== "completed") return { failure: { message: "A completed response cannot be changed to an interrupted generation.", status: 409, code: "already_completed" } } as FinishFailure;
      return { usage: (await summary(tx, userId, date)).usage, idempotent: true } as FinishSuccess;
    }
    if (reservation.status !== "reserved" || reservation.expiresAt <= now) {
      return { failure: { message: "The AI generation reservation expired. Check usage and try again.", status: 409, code: "reservation_expired" }, usage: (await summary(tx, userId, date)).usage } as FinishFailure;
    }
    const settledTokens = Math.max(0, Math.min(
      reservation.reservedTokenCount,
      Math.floor(usedTokens ?? reservation.usedTokenCount),
    ));
    await tx.update(schema.folioAiUsageReservations).set({
      status: outcome,
      usedTokenCount: settledTokens,
      completedAt: outcome === "completed" ? now : null,
    })
      .where(and(eq(schema.folioAiUsageReservations.userId, userId), eq(schema.folioAiUsageReservations.id, reservationId), eq(schema.folioAiUsageReservations.status, "reserved")));
    await ensureDailyRow(tx, userId, reservation.usageDate);
    await tx.update(schema.folioAiDailyUsage).set({
      reservedTokenCount: sql`greatest(${schema.folioAiDailyUsage.reservedTokenCount} - ${reservation.reservedTokenCount}, 0)`,
      usedTokenCount: sql`${schema.folioAiDailyUsage.usedTokenCount} + ${settledTokens}`,
      updatedAt: now,
    })
      .where(and(eq(schema.folioAiDailyUsage.userId, userId), eq(schema.folioAiDailyUsage.usageDate, reservation.usageDate)));
    return { usage: (await summary(tx, userId, date)).usage, idempotent: false } as FinishSuccess;
  });
  if ("failure" in result) throw new AIUsageError(result.failure.message, result.failure.status, result.failure.code, result.usage);
  return result;
}

/**
 * Extends the lease on an active reservation while a long-running AI task is
 * still actively heartbeating, so tasks running longer than 3 or 10 minutes
 * never lose their reserved slot mid-execution.
 */
export async function renewAIReservation(userId: string, reservationId: string, now = new Date()): Promise<{ reservation: AIReservation; usage: AIUsage }> {
  await ensureSchema();
  const date = utcDate(now);
  const outcome = await db.transaction(async (tx: Tx) => {
    await lockUser(tx, userId);
    const [reservation] = await tx.select().from(schema.folioAiUsageReservations)
      .where(and(eq(schema.folioAiUsageReservations.userId, userId), eq(schema.folioAiUsageReservations.id, reservationId))).limit(1).for("update");
    if (!reservation) {
      return { failure: { message: "AI generation reservation was not found.", status: 404, code: "reservation_not_found" } } as FinishFailure;
    }
    if (reservation.status !== "reserved") {
      return { failure: { message: `Cannot renew a ${reservation.status} reservation.`, status: 409, code: "reservation_closed" }, usage: (await summary(tx, userId, date)).usage } as FinishFailure;
    }
    const expiresAt = new Date(now.getTime() + FOLIO_AI_CONFIG.reservationLeaseMilliseconds);
    await tx.update(schema.folioAiUsageReservations)
      .set({ expiresAt })
      .where(and(eq(schema.folioAiUsageReservations.userId, userId), eq(schema.folioAiUsageReservations.id, reservationId)));
    const usage = (await summary(tx, userId, date)).usage;
    return {
      reservation: {
        id: reservation.id,
        generationId: reservation.generationId,
        usageDate: reservation.usageDate,
        expiresAt: expiresAt.toISOString(),
      },
      usage,
    };
  });
  if ("failure" in outcome) throw new AIUsageError(outcome.failure.message, outcome.failure.status, outcome.failure.code, outcome.usage);
  return outcome;
}
