import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";
import { ACTION_BY_ID, ActionValidationError, validateActionPlan } from "@/lib/folio-ai/actions";
import { executeAIActions } from "@/lib/folio-ai/action-executor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireAIUser(request);
    const body = await parseSmallJson(request, 32_768);
    if (Object.keys(body).some(key => !["actions", "confirm", "rationale"].includes(key))) {
      return aiJson({ error: "Only validated action plans are accepted. Prompts stay in your browser." }, 400);
    }
    let actions: { id: string; params: Record<string, unknown> }[];
    try {
      actions = validateActionPlan(body.actions);
    } catch (error) {
      if (error instanceof ActionValidationError) return aiJson({ error: error.message }, 400);
      return aiJson({ error: "The action plan could not be validated." }, 400);
    }
    const requiresConfirmation = actions.some(entry => ACTION_BY_ID[entry.id]?.confirmation !== "none");
    if (requiresConfirmation && body.confirm !== true) {
      return aiJson({
        requiresConfirmation: true,
        actions: actions.map(entry => ({ id: entry.id, label: ACTION_BY_ID[entry.id].label, confirmation: ACTION_BY_ID[entry.id].confirmation, params: entry.params })),
      }, 409);
    }
    const results = await executeAIActions(user, actions, request);
    return aiJson({ results });
  } catch (error) { return aiError(error); }
}