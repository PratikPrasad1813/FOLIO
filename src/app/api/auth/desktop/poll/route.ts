/**
 * GET /api/auth/desktop/poll?flow=<flowId>
 *
 * Allows the desktop shell to automatically pick up an OAuth sign-in
 * completed in the system browser without relying exclusively on the
 * OS protocol handler.
 */

import { and, gt, like } from "drizzle-orm";
import { db } from "@/db";
import { desktopAuthHandoffs } from "@/db/schema";
import { corsJson, desktopCorsPreflight } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request): Promise<Response> {
  return desktopCorsPreflight(request);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const flowId = url.searchParams.get("flow");
  if (!flowId || !/^[a-zA-Z0-9_-]{16,64}$/.test(flowId)) {
    return corsJson(request, { error: "A valid flow identifier is required." }, 400);
  }

  const prefix = `flow:${flowId}:`;
  const [handoff] = await db
    .select({ destination: desktopAuthHandoffs.destination })
    .from(desktopAuthHandoffs)
    .where(and(
      like(desktopAuthHandoffs.destination, `${prefix}%`),
      gt(desktopAuthHandoffs.expiresAt, new Date())
    ))
    .limit(1);

  if (!handoff) {
    return corsJson(request, { ready: false });
  }

  const code = handoff.destination.slice(prefix.length);
  return corsJson(request, { ready: true, code });
}
