import { getUser, sameOrigin } from "@/lib/auth";
import { GoogleError } from "@/lib/google";
import { syncAccount } from "@/lib/calendar-sync";

export const dynamic = "force-dynamic";

/**
 * Manual sync. Incremental by default (Google sync token); `?full=1` forces a
 * full resync, which is also how an expired token recovers on its own.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const user = await getUser();
  const full = new URL(request.url).searchParams.get("full") === "1";
  try {
    const summary = await syncAccount(user.id, { full });
    return Response.json({ summary });
  } catch (error) {
    if (error instanceof GoogleError && error.needsReauth) return Response.json({ error: error.message, needsReauth: true }, { status: 401 });
    console.error("Google Calendar sync failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Couldn’t sync with Google Calendar right now." }, { status: 502 });
  }
}
