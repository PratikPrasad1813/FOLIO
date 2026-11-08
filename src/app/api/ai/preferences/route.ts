import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";
import { getAIPreferences, saveAIPreferences, sanitizePreferences } from "@/lib/folio-ai/preferences";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireAIUser(request);
    const result = await getAIPreferences(user.id);
    return aiJson({ preferences: result.preferences, initialized: result.initialized });
  } catch (error) { return aiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAIUser(request);
    const body = await parseSmallJson(request);
    let patch: ReturnType<typeof sanitizePreferences>;
    try {
      patch = sanitizePreferences(body);
    } catch (error) {
      return aiJson({ error: error instanceof Error ? error.message : "Invalid preferences." }, 400);
    }
    const result = await saveAIPreferences(user.id, patch);
    return aiJson({ preferences: result.preferences, initialized: result.initialized });
  } catch (error) { return aiError(error); }
}