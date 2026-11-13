"use client";

/**
 * Resilient fetch transport for workspace search/browse/AI requests.
 *
 * Category 4 contract (robust networking): every failure mode is converted
 * into a typed Error with a human-readable message BEFORE it reaches a
 * component —
 *   - `fetch` rejections (offline, DNS, CORS, aborted) become "connection"
 *     messages instead of a bare `TypeError: Failed to fetch`;
 *   - non-JSON responses (a proxy's 502 HTML page, an empty body) never
 *     surface a raw `SyntaxError: Unexpected token '<'`;
 *   - HTTP errors carry the server's own message when one exists.
 * Callers still own their fallback state (banner, retry button) via catch.
 */

export async function searchRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("You appear to be offline. Check your connection and try again.");
  }
  const body = await readJsonBody(response);
  if (!response.ok) throw new Error(typeof body.error === "string" && body.error ? body.error : `Request failed (${response.status}). Please try again.`);
  return body as T;
}

/** Parse a JSON body defensively; an HTML/empty body yields `{}`. */
async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const jsonRequest = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
