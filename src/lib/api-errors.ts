/**
 * Shared "something went wrong on our side" responses for API routes.
 *
 * Three rules every route follows when its catch block is reached:
 *
 *  0. A missing or expired sign-in is never a server problem: answer HTTP 401
 *     with the sign-in message so the app sends the person to the sign-in page.
 *  1. If the failure means "the database cannot be reached right now" (a Neon
 *     cold start, a dropped connection, a timeout — including raw driver
 *     errors that were never wrapped), answer HTTP 503 with a plain sentence
 *     and a Retry-After header. Clients treat 503 as "try again shortly", never
 *     as "your data is gone" or "you were signed out".
 *  2. Anything else is a real bug: answer HTTP 500 with the route's own plain
 *     message. The technical detail goes to the server log only.
 *
 * Messages are written for people, not developers: they say what happened,
 * whether the user's work is safe, and what to do next.
 */

import { DatabaseUnavailableError, isConnectionFailure } from "@/db";
import { AuthenticationError } from "@/lib/auth";

/** The classified outage error when `error` means the database is unreachable, otherwise null. */
export function databaseOutage(error: unknown): DatabaseUnavailableError | null {
  if (error instanceof DatabaseUnavailableError) return error;
  if (isConnectionFailure(error)) {
    const wrapped = new DatabaseUnavailableError(
      "Folio could not reach its PostgreSQL database.",
      "Check that the database is running and that DATABASE_URL is correct (npm run db:check).",
      error,
    );
    return wrapped;
  }
  return null;
}

export interface ApiFailureOptions {
  /** Extra response headers (for example the desktop CORS headers). */
  headers?: Record<string, string>;
}

/**
 * Build the JSON response for a failed request.
 * @param error           whatever the catch block caught
 * @param fallbackMessage plain-English message used for non-outage failures (HTTP 500)
 */
export function apiFailure(error: unknown, fallbackMessage: string, options: ApiFailureOptions = {}): Response {
  const headers = { "Cache-Control": "no-store", ...options.headers };
  if (error instanceof AuthenticationError) {
    return Response.json({ error: error.message, code: "UNAUTHENTICATED" }, { status: 401, headers });
  }
  const outage = databaseOutage(error);
  if (outage) {
    console.error("Database unavailable:", error instanceof Error ? error.message : error);
    return Response.json({ error: outage.userMessage, code: "DATABASE_UNAVAILABLE" }, { status: 503, headers: { ...headers, "Retry-After": "20" } });
  }
  return Response.json({ error: fallbackMessage, code: "SERVER_ERROR" }, { status: 500, headers });
}
