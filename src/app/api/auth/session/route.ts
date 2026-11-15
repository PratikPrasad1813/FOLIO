import { renewSession, sameOrigin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Folio blocked that request because it did not come from the Folio app. Please reload the page and try again." }, { status: 403 });
  if (!await renewSession()) return Response.json({ error: "Please sign in again." }, { status: 401 });
  return Response.json({ ok: true });
}
