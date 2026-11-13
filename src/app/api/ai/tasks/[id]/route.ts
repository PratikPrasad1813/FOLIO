import { requireUser } from "@/lib/auth";
import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";
import { getAITaskById, updateAITaskProgress } from "@/lib/folio-ai/tasks-service";
import { AI_TASK_STATUSES, type AIActionResult, type AITaskStatus } from "@/lib/folio-ai/types";
import { AIUsageError } from "@/lib/folio-ai/usage";
import { SearchInputError } from "@/lib/search-types";
import { maxReservedTokensForModel } from "@/lib/folio-ai/config";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_MAX = 64_000;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new SearchInputError("Invalid task ID.");
    const task = await getAITaskById(user.id, id);
    if (!task) throw new SearchInputError("AI task not found.", 404);
    return aiJson({ task });
  } catch (error) {
    return aiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAIUser(request);
    const { id } = await context.params;
    if (!UUID.test(id)) throw new SearchInputError("Invalid task ID.");
    const task = await getAITaskById(user.id, id);
    if (!task) throw new SearchInputError("AI task not found.", 404);

    const body = await parseSmallJson(request, 200_000);
    const allowedKeys = [
      "status",
      "stage",
      "partialContent",
      "tokenCount",
      "usageTokens",
      "plan",
      "results",
      "errorMessage",
    ];
    if (Object.keys(body).some(key => !allowedKeys.includes(key))) {
      throw new AIUsageError("Unexpected field in AI task update.", 400, "invalid_fields");
    }

    let status: AITaskStatus | undefined;
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !AI_TASK_STATUSES.includes(body.status as AITaskStatus)) {
        throw new AIUsageError("Invalid AI task status.", 400, "invalid_status");
      }
      status = body.status as AITaskStatus;
    }

    let stage: string | undefined;
    if (body.stage !== undefined) {
      if (typeof body.stage !== "string" || body.stage.length > 240) {
        throw new SearchInputError("Task stage description is invalid.");
      }
      stage = body.stage.trim();
    }

    let partialContent: string | undefined;
    if (body.partialContent !== undefined) {
      if (typeof body.partialContent !== "string" || body.partialContent.length > CONTENT_MAX) {
        throw new SearchInputError("Task content exceeds the maximum allowed size.");
      }
      partialContent = body.partialContent;
    }

    let tokenCount: number | undefined;
    if (body.tokenCount !== undefined) {
      if (typeof body.tokenCount !== "number" || !Number.isFinite(body.tokenCount) || body.tokenCount < 0) {
        throw new SearchInputError("Invalid token count.");
      }
      tokenCount = Math.floor(body.tokenCount);
    }

    let usageTokens: number | undefined;
    if (body.usageTokens !== undefined) {
      if (typeof body.usageTokens !== "number" || !Number.isSafeInteger(body.usageTokens) || body.usageTokens < 0 || body.usageTokens > maxReservedTokensForModel(task.modelId)) {
        throw new SearchInputError("Invalid local token usage.");
      }
      usageTokens = body.usageTokens;
    }

    let plan: { actions: { id: string; params: Record<string, unknown> }[] } | null | undefined;
    if (body.plan !== undefined) {
      if (body.plan !== null && (typeof body.plan !== "object" || Array.isArray(body.plan))) {
        throw new SearchInputError("Invalid action plan.");
      }
      plan = body.plan as { actions: { id: string; params: Record<string, unknown> }[] } | null;
    }

    let results: AIActionResult[] | null | undefined;
    if (body.results !== undefined) {
      if (body.results !== null && (!Array.isArray(body.results) || body.results.length > 25)) {
        throw new SearchInputError("Invalid action results.");
      }
      results = body.results as AIActionResult[] | null;
    }

    let errorMessage: string | null | undefined;
    if (body.errorMessage !== undefined) {
      if (body.errorMessage !== null && typeof body.errorMessage !== "string") {
        throw new SearchInputError("Invalid error message.");
      }
      errorMessage = typeof body.errorMessage === "string" ? body.errorMessage.slice(0, 400) : null;
    }

    const updated = await updateAITaskProgress(user.id, id, {
      status,
      stage,
      partialContent,
      tokenCount,
      usageTokens,
      plan,
      results,
      errorMessage,
    });

    return aiJson(updated);
  } catch (error) {
    return aiError(error);
  }
}
