import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { desktopAuthHandoffs } from "@/db/schema";
import { createSession, hashToken, sameOrigin } from "@/lib/auth";
import { ensureSchema } from "@/db/migrate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This sign-in request could not be verified." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid sign-in code is required." }, { status: 400 });
  }
  const code = typeof body === "object" && body !== null && "code" in body
    ? body.code
    : null;
  if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code)) {
    return NextResponse.json({ error: "A valid sign-in code is required." }, { status: 400 });
  }

  await ensureSchema();
  const [handoff] = await db.delete(desktopAuthHandoffs)
    .where(and(
      eq(desktopAuthHandoffs.tokenHash, hashToken(code)),
      gt(desktopAuthHandoffs.expiresAt, new Date()),
    ))
    .returning({ userId: desktopAuthHandoffs.userId, destination: desktopAuthHandoffs.destination });
  if (!handoff) {
    return NextResponse.json({ error: "This sign-in code expired or was already used." }, { status: 401 });
  }

  await createSession(handoff.userId);
  return NextResponse.json({ destination: handoff.destination });
}
