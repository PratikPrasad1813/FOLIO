/**
 * Dual authentication + CORS for the local-first sync endpoints.
 *
 *  - `Authorization: Bearer <token>` — the desktop sync engine. The token is
 *    a regular Folio session token (sha256-hashed in folio_sessions) minted
 *    by /api/auth/desktop/login or /api/auth/desktop/exchange. Bearer
 *    requests carry no ambient cookies, so no CSRF origin check applies.
 *  - Session cookie — the web app. Cookie requests must pass the
 *    same-origin check used by every other mutating Folio endpoint.
 *
 * CORS: the desktop shell loads its UI from the Tauri custom protocol
 * (`tauri://localhost` on macOS/Linux, `http://tauri.localhost` on Windows)
 * and calls the DEPLOYED API cross-origin. The endpoints the engine and the
 * desktop auth flow use answer with a narrow `Access-Control-Allow-Origin`
 * echo limited to those origins (plus localhost for development).
 */

import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { sessions } from "@/db/schema";
import { bearerToken, currentUser, hashToken, sameOrigin, userFromToken, type FolioUser } from "@/lib/auth";

/** Desktop sessions are long-lived (90 days) — the shell stays signed in offline. */
export const DESKTOP_SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 20;

/**
 * Mint a dedicated 90-day Bearer session for a desktop shell. Bounded per
 * account so repeated pairings cannot grow folio_sessions unbounded; the
 * oldest are dropped first.
 */
export async function mintDesktopSessionToken(userId: string): Promise<{ token: string; expiresAt: string }> {
  await ensureSchema();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + DESKTOP_SESSION_MS);

  const existing = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).orderBy(asc(sessions.expiresAt));
  if (existing.length >= MAX_SESSIONS_PER_USER) {
    const stale = existing.slice(0, existing.length - MAX_SESSIONS_PER_USER + 1).map((row) => row.id);
    for (const id of stale) {
      await db.delete(sessions).where(eq(sessions.id, id));
    }
  }

  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function syncUser(request: Request): Promise<FolioUser | null> {
  const header = request.headers.get("authorization");
  if (header) {
    const token = bearerToken(header);
    if (!token) return null;
    return userFromToken(token);
  }
  if (!sameOrigin(request)) return null;
  return currentUser();
}

export function unauthorized(message = "Please sign in to sync your workspace.", request?: Request): Response {
  const headers = { "Cache-Control": "no-store", ...(request ? desktopCorsHeaders(request) : {}) };
  return Response.json({ error: message }, { status: 401, headers });
}

/* ------------------------------------------------------------------ */
/* CORS for the desktop shell                                          */
/* ------------------------------------------------------------------ */

/** Origins allowed to call the desktop/sync endpoints cross-origin. */
const ALLOWED_DESKTOP_ORIGINS: RegExp[] = [
  /^tauri:\/\/localhost$/i, // Tauri v2 custom protocol (macOS, Linux)
  /^https?:\/\/tauri\.localhost$/i, // Tauri v2 on WebView2 (Windows)
  /^https?:\/\/localhost(:\d+)?$/i, // local development (next dev)
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i, // local development (next dev, alt host)
];

export function isAllowedDesktopOrigin(origin: string): boolean {
  return ALLOWED_DESKTOP_ORIGINS.some((pattern) => pattern.test(origin));
}

/** CORS headers for `request`, empty when the caller is not a desktop shell. */
export function desktopCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !isAllowedDesktopOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    // The x-user-ai-* headers carry the person's own AI provider key (BYOK);
    // without them in this list the browser refuses the Folio AI requests
    // before they leave the desktop app and the app reports "offline".
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-user-ai-provider, x-user-ai-key, x-user-ai-model",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** CORS preflight answer (204) — safe to call for any origin. */
export function desktopCorsPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: desktopCorsHeaders(request) });
}

/** `Response.json` with the desktop CORS headers merged in. */
export function corsJson(request: Request, body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...desktopCorsHeaders(request), ...extraHeaders },
  });
}

/**
 * Merge the desktop CORS headers into an existing response, keeping every
 * header (and the streaming body) it already has. A no-op for web requests.
 */
export function applyDesktopCors(request: Request, response: Response): Response {
  const cors = desktopCorsHeaders(request);
  if (!Object.keys(cors).length) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) {
    if (key.toLowerCase() === "vary") {
      const existing = headers.get("Vary");
      headers.set("Vary", existing && !/(^|,\s*)origin(\s*,|$)/i.test(existing) ? `${existing}, ${value}` : existing ?? value);
    } else {
      headers.set(key, value);
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Wrap a route handler so its answers — successes, errors and streams — carry
 * the desktop CORS headers. A handler that fails without catching its own
 * error still answers with a plain JSON message plus the CORS headers, so the
 * desktop app shows the real problem instead of a misleading "offline" notice.
 */
export function withDesktopCors<A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Promise<Response> | Response,
): (request: Request, ...rest: A) => Promise<Response> {
  return async (request: Request, ...rest: A): Promise<Response> => {
    let response: Response;
    try {
      response = await handler(request, ...rest);
    } catch (error) {
      console.error("Route failed without handling its own error:", error);
      response = Response.json(
        { error: "Folio ran into a problem on our side. Your work is safe — please try again in a moment.", code: "SERVER_ERROR" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return applyDesktopCors(request, response);
  };
}
