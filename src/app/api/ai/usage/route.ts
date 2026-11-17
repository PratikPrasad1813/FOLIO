import { desktopCorsPreflight, withDesktopCors } from "@/lib/sync-auth";
import { aiError, aiJson, requireAIUser } from "@/lib/folio-ai/http";
import { readAIUsage } from "@/lib/folio-ai/usage";

export const dynamic = "force-dynamic";
async function handleGET(request: Request) {
  try {
    const user = await requireAIUser(request);
    const usage = await readAIUsage(user.id);
    return aiJson({ usage });
  } catch (error) { return aiError(error); }
}

/* Desktop app access: Bearer sign-in plus CORS (see src/lib/sync-auth.ts). */
export const GET = withDesktopCors(handleGET);
export function OPTIONS(request: Request): Response { return desktopCorsPreflight(request); }
