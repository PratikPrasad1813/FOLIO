import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

// Run against a local/test Neon database and a running Folio server. Only two
// uniquely named temporary users are created; finally removes those exact IDs.
const BASE = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const userIds = [];
let checks = 0;
const assertEqual = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const assertOk = (value, label) => { assert.ok(value, label); checks++; };
async function createAccount(label) {
  const email = `folio-ai-usage-test-${randomUUID()}@example.invalid`;
  const { rows: [user] } = await db.execute(sql`insert into folio_users (name, email, provider) values (${label}, ${email}, 'test') returning id`);
  userIds.push(user.id);
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.execute(sql`insert into folio_sessions (user_id, token_hash, expires_at) values (${user.id}, ${tokenHash}, now() + interval '1 day')`);
  return { id: user.id, token };
}
async function request(path, token, method = "GET", body, origin = BASE) {
  const response = await fetch(`${BASE}${path}`, { method, headers: { Origin: origin, ...(token ? { Cookie: `folio_session=${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function reserve(token, generationId = randomUUID(), inputCharacters = 17) {
  return request("/api/ai/usage/reservations", token, "POST", { generationId, inputCharacters });
}
async function finish(token, reservationId, outcome, usedTokens) {
  return request(`/api/ai/usage/reservations/${reservationId}`, token, "PATCH", { outcome, ...(usedTokens === undefined ? {} : { usedTokens }) });
}

try {
  assertEqual((await fetch(`${BASE}/api/health`)).status, 200, "Start the Folio preview before running tests");
  const a = await createAccount("AI usage integration A");
  const sessionTokenA2 = randomBytes(32).toString("hex");
  await db.execute(sql`insert into folio_sessions (user_id, token_hash, expires_at) values (${a.id}, ${createHash("sha256").update(sessionTokenA2).digest("hex")}, now() + interval '1 day')`);
  const b = await createAccount("AI usage integration B");
  const userA = await request("/api/ai/usage", a.token);
  assertEqual(userA.status, 200, "Authenticated usage route");
  assertEqual(userA.body.usage.plan, "free", "Free plan returned");
  assertEqual(userA.body.usage.usedPercent, 0, "Fresh account sees percentage-only usage");
  assertOk(!["usedTokens", "reservedTokens", "available", "completed", "reserved", "limit"].some(key => key in userA.body.usage), "Usage API never exposes token totals or remaining amounts");
  const expectedReset = new Date(Date.parse(`${userA.body.usage.usageDate}T00:00:00.000Z`) + 86_400_000).toISOString();
  assertEqual(userA.body.usage.resetAt, expectedReset, "Reset is next UTC midnight calculated by the server");
  assertEqual((await request("/api/ai/usage", `${randomBytes(32).toString("hex")}invalid`)).status, 401, "Invalid sessions fail closed");
  assertEqual((await request("/api/ai/usage/reservations", a.token, "POST", { generationId: randomUUID(), inputCharacters: 0 })).status, 400, "Empty prompt rejected");
  assertEqual((await request("/api/ai/usage/reservations", a.token, "POST", { generationId: randomUUID(), inputCharacters: 4001 })).status, 413, "Oversized input rejected");
  assertEqual((await request("/api/ai/usage/reservations", a.token, "POST", { generationId: randomUUID(), inputCharacters: 12, prompt: "MUST NEVER BE SENT" })).status, 400, "Usage API refuses prompt text");
  assertEqual((await request("/api/ai/usage/reservations", a.token, "POST", { generationId: "not-a-uuid", inputCharacters: 12 })).status, 400, "Generation id validated");
  assertEqual((await request("/api/ai/usage", a.token, "GET", undefined, "https://attacker.invalid")).status, 403, "Cross-origin usage reads rejected");

  // A retry with the same generation id reuses one slot. Another account cannot
  // release the reservation, and a failed provider response charges only
  // the tokens it consumed.
  const idempotencyKey = randomUUID();
  const first = await reserve(a.token, idempotencyKey);
  assertEqual(first.status, 201, "First generation reserves a slot");
  const repeat = await reserve(a.token, idempotencyKey);
  assertEqual(repeat.status, 200, "Repeated reserve is idempotent");
  assertEqual(repeat.body.reused, true, "Retry returns the same reservation");
  assertEqual(repeat.body.reservation.id, first.body.reservation.id, "Retry does not create a second slot");
  assertEqual((await request(`/api/ai/usage/reservations/${first.body.reservation.id}`, b.token, "PATCH", { outcome: "completed" })).status, 404, "Another account cannot finalize a reservation");
  const failed = await finish(a.token, first.body.reservation.id, "failed", 3200);
  assertEqual(failed.body.usage.usedPercent, 32, "Failed generation accounts for tokens already consumed");
  assertOk(!("usedTokens" in failed.body.usage), "Settled token count remains private");

  const cancelledReservation = await reserve(a.token);
  const cancelled = await finish(a.token, cancelledReservation.body.reservation.id, "cancelled");
  assertEqual(cancelled.body.usage.usedPercent, 32, "Cancellation releases unused reservation capacity");

  // Stale browser tabs have a lease; the next usage read releases expired slots.
  const expiredReservation = await reserve(a.token);
  await db.execute(sql`update folio_ai_usage_reservations set expires_at = now() - interval '1 second' where id = ${expiredReservation.body.reservation.id} and user_id = ${a.id}`);
  const afterExpiry = await request("/api/ai/usage", a.token);
  assertOk(afterExpiry.body.usage.usedPercent >= 32, "Expired reservations are reaped without exposing reserved token counts");
  assertEqual((await finish(a.token, expiredReservation.body.reservation.id, "completed")).status, 409, "Expired generation cannot later consume usage");

  // Two different sessions for the same account race for the final slot.
  const usageDate = userA.body.usage.usageDate;
  await db.execute(sql`insert into folio_ai_daily_usage (user_id, usage_date, completed_message_count, reserved_message_count, used_token_count, reserved_token_count) values (${a.id}, ${usageDate}, 0, 0, 5904, 0) on conflict (user_id, usage_date) do update set completed_message_count = 0, reserved_message_count = 0, used_token_count = 5904, reserved_token_count = 0`);
  const [raceA, raceB] = await Promise.all([reserve(a.token), reserve(sessionTokenA2)]);
  const accepted = [raceA, raceB].filter(result => (result.status === 201 || result.status === 200) && !result.body.alreadyCompleted);
  const limited = [raceA, raceB].filter(result => result.status === 429);
  assertEqual(accepted.length, 1, "Atomic cross-request lock permits only one final slot");
  assertEqual(limited.length, 1, "Concurrent request receives the account limit response");
  const finalSlot = accepted[0].body.reservation;
  const usageFromOtherSession = await request("/api/ai/usage", sessionTokenA2);
  assertEqual(usageFromOtherSession.body.usage.usedPercent, 100, "Reserved capacity is reflected as a percentage across sessions");
  const completed = await finish(a.token, finalSlot.id, "completed", 3000);
  assertEqual(completed.body.usage.usedPercent, 89, "Completion settles actual provider token usage");
  assertEqual((await finish(a.token, finalSlot.id, "completed")).body.idempotent, true, "Completion retries are idempotent");
  assertEqual((await request("/api/ai/usage", a.token)).body.usage.usedPercent, 89, "Duplicate completion cannot inflate daily percentage");
  assertEqual((await reserve(a.token)).status, 429, "Daily allowance enforces reservation capacity based on token usage");
  assertEqual((await request("/api/ai/usage", b.token)).body.usage.usedPercent, 0, "Different user's account counter remains isolated");
  console.log("✓ Reservation retries, failure/cancellation, expiry, cross-user isolation, and account-wide concurrent sessions");

  // Prior UTC date is not trusted as today's usage period. Isolate the current
  // day's test counter from the already-verified limit case on this disposable user.
  await db.execute(sql`update folio_ai_daily_usage set completed_message_count = 0, reserved_message_count = 0, used_token_count = 0, reserved_token_count = 0 where user_id = ${a.id} and usage_date = ${usageDate}`);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await db.execute(sql`insert into folio_ai_daily_usage (user_id, usage_date, completed_message_count, reserved_message_count, used_token_count, reserved_token_count) values (${a.id}, ${yesterday}, 0, 0, 10000, 0) on conflict (user_id, usage_date) do update set completed_message_count = 0, reserved_message_count = 0, used_token_count = 10000, reserved_token_count = 0`);
  const currentDay = (await request("/api/ai/usage", a.token)).body.usage;
  assertEqual(currentDay.usageDate, new Date().toISOString().slice(0, 10), "UTC day is derived server side");
  assertEqual(currentDay.usedPercent, 0, "Yesterday's allowance does not affect today's percentage");
  console.log("✓ UTC reset policy verified");
  console.log(`PASS: ${checks} Neon-backed usage assertions.`);
} finally {
  for (const id of userIds) await db.execute(sql`delete from folio_users where id = ${id}`);
  await pool.end();
}
