import { AuthenticationError, bearerToken, requireUser, sameOrigin, userFromToken } from "@/lib/auth";
import { desktopCorsHeaders } from "@/lib/sync-auth";
import { databaseOutage } from "@/lib/api-errors";
import { SearchInputError, objectInput } from "@/lib/search-types";

/**
 * JSON response with the desktop CORS headers merged in when the caller is
 * the Tauri shell (no-op for same-origin web requests).
 */
export const privateJson = (data: unknown, status = 200, request?: Request) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", ...(request ? desktopCorsHeaders(request) : {}) } });

/**
 * Resolve identity for the search/browse/filter endpoints:
 *   - `Authorization: Bearer <token>` — the desktop shell (90-day session
 *     minted by the desktop auth flow). Bearer requests carry no ambient
 *     cookies, so no CSRF origin check applies.
 *   - The Folio session cookie — the web app (same-origin only).
 */
export async function searchUser(request: Request) {
  const header = request.headers.get("authorization");
  if (header) {
    const token = bearerToken(header);
    if (!token) throw new SearchInputError("Please sign in again.", 401);
    const user = await userFromToken(token);
    if (!user) throw new SearchInputError("Please sign in again.", 401);
    return user;
  }
  if (!sameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") throw new SearchInputError("This request is not allowed.", 403);
  return requireUser();
}

export async function readSearchBody(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 16_384) throw new SearchInputError("Request is too large.", 413);
  const text = await request.text();
  if (text.length > 16_384) throw new SearchInputError("Request is too large.", 413);
  try { return objectInput(JSON.parse(text)); }
  catch (error) { if (error instanceof SearchInputError) throw error; throw new SearchInputError("Please send valid JSON."); }
}

export function searchError(error: unknown, request?: Request) {
  if (error instanceof AuthenticationError) return privateJson({ error: error.message }, 401, request);
  if (error instanceof SearchInputError) return privateJson({ error: error.message }, error.status, request);
  console.error("Search request failed:", error);
  const outage = databaseOutage(error);
  if (outage) return privateJson({ error: outage.userMessage, code: "DATABASE_UNAVAILABLE" }, 503, request);
  return privateJson({ error: "Folio couldn’t finish that search. Please try again in a moment." }, 500, request);
}
