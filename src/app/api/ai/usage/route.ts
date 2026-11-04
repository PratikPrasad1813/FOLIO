import { aiError, aiJson, requireAIUser } from "@/lib/folio-ai/http";
import { readAIUsage } from "@/lib/folio-ai/usage";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireAIUser(request);
    const usage = await readAIUsage(user.id);
    return aiJson({ usage });
  } catch (error) { return aiError(error); }
}
