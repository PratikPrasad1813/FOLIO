import { getUser } from "@/lib/auth";
import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";
import {
  createOrReuseAITask,
  listActiveUserAITasks,
  listConversationTasks,
} from "@/lib/folio-ai/tasks-service";
import { AIUsageError } from "@/lib/folio-ai/usage";
import { SearchInputError } from "@/lib/search-types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const user = await getUser();
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId");
    const interruptedParam = url.searchParams.get("interrupted") || "";
    const interruptTaskIds = interruptedParam
      .split(",")
      .map(s => s.trim())
      .filter(id => UUID.test(id));

    if (conversationId) {
      if (!UUID.test(conversationId)) throw new SearchInputError("Invalid conversation ID.");
      const tasks = await listConversationTasks(user.id, conversationId, { interruptTaskIds });
      return aiJson({ tasks });
    }

    const tasks = await listActiveUserAITasks(user.id, { interruptTaskIds });
    return aiJson({ tasks });
  } catch (error) {
    return aiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAIUser(request);
    const body = await parseSmallJson(request, 64_000);

    const allowedKeys = [
      "generationId",
      "conversationId",
      "prompt",
      "modelId",
      "userMessageId",
      "assistantMessageId",
      "resumeTaskId",
      "keepPartial",
    ];
    if (Object.keys(body).some(key => !allowedKeys.includes(key))) {
      throw new AIUsageError("Unexpected field in AI task request.", 400, "invalid_fields");
    }

    const generationId = typeof body.generationId === "string" ? body.generationId.trim() : "";
    if (!UUID.test(generationId)) {
      throw new AIUsageError("Invalid generation identifier.", 400, "invalid_generation_id");
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      throw new AIUsageError("Enter a message before sending it.", 400, "empty_input");
    }
    if (prompt.length > FOLIO_AI_CONFIG.maxInputCharacters) {
      throw new AIUsageError(
        `Messages are limited to ${FOLIO_AI_CONFIG.maxInputCharacters.toLocaleString()} characters.`,
        413,
        "input_too_long",
      );
    }

    const conversationId =
      typeof body.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim()
        : null;
    if (conversationId && !UUID.test(conversationId)) {
      throw new SearchInputError("Invalid conversation ID.");
    }

    const userMessageId =
      typeof body.userMessageId === "string" && UUID.test(body.userMessageId)
        ? body.userMessageId
        : null;
    const assistantMessageId =
      typeof body.assistantMessageId === "string" && UUID.test(body.assistantMessageId)
        ? body.assistantMessageId
        : null;
    const resumeTaskId =
      typeof body.resumeTaskId === "string" && UUID.test(body.resumeTaskId)
        ? body.resumeTaskId
        : null;
    const keepPartial = body.keepPartial === true;
    const modelId =
      typeof body.modelId === "string" && body.modelId.trim()
        ? body.modelId.trim().slice(0, 120)
        : FOLIO_AI_CONFIG.modelId;

    const result = await createOrReuseAITask(user.id, {
      generationId,
      conversationId,
      prompt,
      modelId,
      userMessageId,
      assistantMessageId,
      resumeTaskId,
      keepPartial,
    });

    return aiJson(result, result.reused ? 200 : 201);
  } catch (error) {
    return aiError(error);
  }
}
