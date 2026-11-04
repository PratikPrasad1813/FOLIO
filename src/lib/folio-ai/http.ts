import { AuthenticationError, getUser, sameOrigin } from "@/lib/auth";
import { AIUsageError } from "@/lib/folio-ai/usage";

export async function requireAIUser(request: Request) {
  if (!sameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AIUsageError("This AI request is not allowed.", 403, "forbidden");
  }
  return getUser();
}
export async function parseSmallJson(request: Request, maxBytes = 2_048): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw new AIUsageError("The request is too large.", 413, "payload_too_large");
  const text = await request.text();
  if (text.length > maxBytes) throw new AIUsageError("The request is too large.", 413, "payload_too_large");
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object");
    return body as Record<string, unknown>;
  } catch {
    throw new AIUsageError("Please send valid JSON.", 400, "invalid_json");
  }
}
export function aiJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
export function aiError(error: unknown) {
  if (error instanceof AIUsageError) return aiJson({ error: error.message, code: error.code, ...(error.usage ? { usage: error.usage } : {}) }, error.status);
  if (error instanceof AuthenticationError) return aiJson({ error: error.message, code: "unauthorized" }, 401);
  console.error("Folio AI usage request failed:", error);
  return aiJson({ error: "Folio AI could not sync account usage. Please retry." }, 500);
}
