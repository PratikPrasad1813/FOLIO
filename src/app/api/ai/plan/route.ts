import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";
import { executeWorkspaceAI, requireBYOKConfig } from "@/lib/folio-ai/byok-service";
import { AIUsageError } from "@/lib/folio-ai/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Structured BYOK planning endpoint.
 *
 * POST { prompt } with the user's own credentials in request headers
 * (x-user-ai-key / x-user-ai-provider / x-user-ai-model). Returns a validated
 * workspace plan: { intent, project, tasks[], summary }. The server holds no
 * provider key of its own and returns 400 `api_key_required` when the headers
 * are missing.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAIUser(request);
    const body = await parseSmallJson(request, 16_000);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (prompt.length < 3 || prompt.length > FOLIO_AI_CONFIG.maxInputCharacters) {
      throw new AIUsageError("Describe what you would like to plan in a few words.", 400, "invalid_prompt");
    }
    const config = requireBYOKConfig(request);
    const plan = await executeWorkspaceAI(prompt, config);
    return aiJson({ result: plan, provider: config.provider, model: config.model });
  } catch (error) {
    return aiError(error);
  }
}
