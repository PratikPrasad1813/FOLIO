import { AIUsageError, finishAIReservation, renewAIReservation } from "@/lib/folio-ai/usage";
import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAIUser(request);
    const { id } = await context.params;
    if (!UUID.test(id)) throw new AIUsageError("Invalid usage reservation.", 400, "invalid_reservation_id");
    const body = await parseSmallJson(request);
    if (Object.keys(body).some(key => key !== "outcome") || !["completed", "failed", "cancelled", "heartbeat"].includes(String(body.outcome))) {
      throw new AIUsageError("Invalid generation outcome.", 400, "invalid_outcome");
    }
    if (body.outcome === "heartbeat") {
      const renewed = await renewAIReservation(user.id, id);
      return aiJson(renewed);
    }
    const result = await finishAIReservation(user.id, id, body.outcome as "completed" | "failed" | "cancelled");
    return aiJson(result);
  } catch (error) { return aiError(error); }
}
