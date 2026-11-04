import { AIUsageError, reserveAIMessage, readAIUsage } from "@/lib/folio-ai/usage";
import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  try {
    const user = await requireAIUser(request);
    const body = await parseSmallJson(request);
    if (Object.keys(body).some(key => !["generationId", "inputCharacters"].includes(key))) throw new AIUsageError("Only usage metadata may be sent. Prompts stay in your browser.", 400, "invalid_fields");
    if (typeof body.generationId !== "string" || !UUID.test(body.generationId)) throw new AIUsageError("Invalid generation identifier.", 400, "invalid_generation_id");
    if (typeof body.inputCharacters !== "number" || !Number.isInteger(body.inputCharacters) || body.inputCharacters < 1) throw new AIUsageError("Enter a message before sending it.", 400, "empty_input");
    if (body.inputCharacters > FOLIO_AI_CONFIG.maxInputCharacters) throw new AIUsageError(`Messages are limited to ${FOLIO_AI_CONFIG.maxInputCharacters.toLocaleString()} characters.`, 413, "input_too_long");
    const result = await reserveAIMessage(user.id, body.generationId, body.inputCharacters);
    return aiJson(result, result.reused ? 200 : 201);
  } catch (error) { return aiError(error); }
}
export async function GET(request: Request) {
  try {
    const user = await requireAIUser(request);
    return aiJson({ usage: await readAIUsage(user.id) });
  } catch (error) { return aiError(error); }
}
