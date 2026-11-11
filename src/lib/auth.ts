import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { cache } from "react";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, DatabaseUnavailableError } from "@/db";
import { authRateLimits, sessions, users } from "@/db/schema";
import { ensureSchema } from "@/db/migrate";
import { DEFAULT_PERSONAL, personalAddress } from "@/lib/personalization";

// Compatible with the opaque folio_session and scrypt format in 8f0069e.
const scryptAsync = promisify(scrypt);
export const SESSION_COOKIE = "folio_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export type FolioUser = typeof users.$inferSelect;
export class AuthenticationError extends Error {
  constructor() { super("Your session has expired. Please sign in again."); }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hash, extra] = stored.split(":");
  if (extra || !/^[a-f0-9]{32}$/i.test(salt || "") || !/^[a-f0-9]{128}$/i.test(hash || "")) return false;
  const key = await scryptAsync(password, salt, 64) as Buffer;
  return timingSafeEqual(Buffer.from(hash, "hex"), key);
}

export async function userFromToken(token: string | undefined): Promise<FolioUser | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  await ensureSchema();
  const [row] = await db.select({ user: users }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return row?.user ?? null;
}
export const currentUser = cache(async (): Promise<FolioUser | null> => userFromToken((await cookies()).get(SESSION_COOKIE)?.value));
/**
 * Like `currentUser`, but reports an unreachable or misconfigured database
 * instead of throwing, so auth pages can render a fix-it notice rather than a
 * hard 500 (see DATABASE_SETUP.md → Troubleshooting).
 */
export async function currentUserSafe(): Promise<{ user: FolioUser | null; dbError: DatabaseUnavailableError | null }> {
  try {
    return { user: await currentUser(), dbError: null };
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return { user: null, dbError: error };
    throw error;
  }
}
export async function getUser(): Promise<FolioUser> {
  const user = await currentUser();
  if (!user) throw new AuthenticationError();
  return user;
}
export async function sessionTokenHash() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}
function cookieOptions(expires: Date) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", expires };
}
export async function createSession(userId: string) {
  await destroySession(); // Never reuse a previous provider's browser session.
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}
export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && /^[a-f0-9]{64}$/.test(token)) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(new Date(0)), maxAge: 0 });
}
export async function renewSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const expiresAt = new Date(Date.now() + SESSION_MS);
  const rows = await db.update(sessions).set({ expiresAt })
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .returning({ id: sessions.id });
  if (!rows.length) return false;
  jar.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  return true;
}
export function publicUser(user: FolioUser) {
  const personal = { ...DEFAULT_PERSONAL, ...user.personal };
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    provider: user.provider,
    weeklyGoal: user.weeklyGoal,
    personal,
    greetingName: personalAddress(user.name, personal),
    onboardingCompleted: Boolean(user.onboardingCompletedAt),
    // The actual email_verified_at value only. Never inferred from the sign-in provider.
    emailVerified: Boolean(user.emailVerifiedAt),
    guideDismissed: Boolean(user.guideDismissedAt),
    hasPassword: Boolean(user.passwordHash),
  };
}
export function requestOrigin(request: Request) {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return new URL(configured).origin;
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol;
  if (host && /^[a-zA-Z0-9.\-\[\]:]+$/.test(host)) return new URL(`${protocol}//${host}`).origin;
  return url.origin;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // SameSite cookies and JSON-only endpoints protect browser requests without Origin.
  try {
    const originUrl = new URL(origin);
    const reqUrl = new URL(request.url);
    const reqOrigin = requestOrigin(request);
    const configuredUrl = reqOrigin ? new URL(reqOrigin) : null;
    if (originUrl.origin === reqOrigin) return true;
    if (originUrl.host === reqUrl.host) return true;
    if (originUrl.host === request.headers.get("host")) return true;
    if (
      configuredUrl &&
      ["localhost", "127.0.0.1"].includes(originUrl.hostname) &&
      ["localhost", "127.0.0.1"].includes(configuredUrl.hostname) &&
      originUrl.port === configuredUrl.port
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
const WORKSPACE_DESTINATION = /^\/(overview|projects|tasks|ideas|calendar|ai|settings)(\/|\?|#|$)/;
export function safeDestination(value: unknown): string {
  if (typeof value !== "string" || value.length > 500 || /[\\\u0000-\u0020]/.test(value) || !WORKSPACE_DESTINATION.test(value)) return "/overview";
  return value;
}
export function signedInDestination(user: FolioUser, next: unknown = "/overview"): string {
  const destination = safeDestination(next);
  return user.onboardingCompletedAt ? destination : `/onboarding?next=${encodeURIComponent(destination)}`;
}
export function requiresOnboarding(user: FolioUser): boolean { return !user.onboardingCompletedAt; }

// Shared database-backed limits work across serverless instances. The key contains no raw IP/email.
export async function allowAuthAttempt(request: Request, purpose = "auth", subject = "") {
  await ensureSchema();
  const ip = request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // Account-specific limits do not depend on a potentially spoofable client IP.
  const key = hashToken(subject ? `${purpose}:account:${subject.toLowerCase()}` : `${purpose}:${ip}:`);
  const resetAt = new Date(Date.now() + 15 * 60_000);
  const [row] = await db.insert(authRateLimits).values({ key, count: 1, resetAt })
    .onConflictDoUpdate({ target: authRateLimits.key, set: {
      count: sql`case when ${authRateLimits.resetAt} < now() then 1 else ${authRateLimits.count} + 1 end`,
      resetAt: sql`case when ${authRateLimits.resetAt} < now() then ${resetAt} else ${authRateLimits.resetAt} end`,
    } }).returning({ count: authRateLimits.count });
  return row.count <= 20;
}
