import { AuthenticationError, requireUser, sameOrigin } from "@/lib/auth";
import { SearchInputError, objectInput } from "@/lib/search-types";

export const privateJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });

/** Resolve identity from Folio's existing session system; never from input. */
export async function searchUser(request: Request) {
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
export function searchError(error: unknown) {
  if (error instanceof AuthenticationError) return privateJson({ error: error.message }, 401);
  if (error instanceof SearchInputError) return privateJson({ error: error.message }, error.status);
  console.error("Search request failed:", error);
  return privateJson({ error: "We couldn’t complete that request. Please try again." }, 500);
}
