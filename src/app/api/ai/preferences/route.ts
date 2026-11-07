import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";
import { getAIPreferences, saveAIPreferences, sanitizePreferences } from "@/lib/folio-ai/preferences";
import { MODEL_BY_ID } from "@/lib/folio-ai/models";
import { getLocalModelByWebLLMId } from "@/lib/folio-ai/model-catalog";

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
    // A manual model preference must reference a verified model ID when supplied.
    if (patch.selectedModelId && !MODEL_BY_ID[patch.selectedModelId] && !getLocalModelByWebLLMId(patch.selectedModelId)) {
      return aiJson({ error: "The selected model is not supported by this Folio build." }, 400);
    }
    if (patch.modelPreference && patch.modelPreference !== "automatic" && !patch.selectedModelId) {
      const tier = patch.modelPreference;
      const model = (await import("@/lib/folio-ai/models")).MODEL_BY_TIER[tier as keyof typeof import("@/lib/folio-ai/models").MODEL_BY_TIER];
      if (model) patch.selectedModelId = model.modelId;
    }
    const result = await saveAIPreferences(user.id, patch);
    return aiJson({ preferences: result.preferences, initialized: result.initialized });
  } catch (error) { return aiError(error); }
}