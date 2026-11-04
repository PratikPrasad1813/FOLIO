import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { READ_SCOPES, WRITE_SCOPES, authorizationUrl, googleConfig, newVerifier, redirectUri } from "@/lib/google";
import { signState } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const COOKIE = "folio_google_oauth";

/**
 * Starts the OAuth consent flow. This is always a *separate* authorization from
 * sign-in: Folio requests read-only calendar access first, and only asks for
 * event write access when the user explicitly opts in (`?write=1`).
 */
export async function GET(request: Request) {
  const config = googleConfig();
  if (!config.configured) {
    return NextResponse.json({
      error: "Google Calendar isn’t configured on this server yet.",
      hint: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then add this redirect URI in Google Cloud Console → Credentials.",
      redirectUri: redirectUri(request),
    }, { status: 503 });
  }
  await getUser(); // make sure a Folio session exists before handing out a consent URL
  const url = new URL(request.url);
  const write = url.searchParams.get("write") === "1";
  const upgrade = url.searchParams.get("upgrade") === "1";
  const state = crypto.randomUUID();
  const verifier = newVerifier();
  const requested = write ? WRITE_SCOPES : READ_SCOPES;
  const signed = signState({ state, verifier, write, upgrade, scopes: requested, ts: Date.now() });

  const jar = await cookies();
  jar.set(COOKIE, signed, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });

  const target = authorizationUrl({
    clientId: config.clientId,
    redirect: redirectUri(request),
    scopes: requested,
    state,
    verifier,
    upgrade,
  });
  return NextResponse.redirect(target);
}
