import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { authFlows, desktopAuthHandoffs } from "@/db/schema";
import { createSession, currentUser, hashToken, sessionTokenHash, signedInDestination } from "@/lib/auth";
import { openToken } from "@/lib/crypto";
import { appOrigin, exchangeProviderCode, isProviderConfigured, resolveOAuthIdentity, type OAuthProvider } from "@/lib/oauth";
import { onAccountCreated, onProviderLinked } from "@/lib/account-events";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const slug = (await params).provider;
  const provider = (slug === "google" || slug === "github") ? slug as OAuthProvider : null;
  const origin = appOrigin(request);
  let linking = false;
  const fail = (message: string) => Response.redirect(`${origin}${linking ? "/settings" : "/login"}?error=${encodeURIComponent(message)}`, 302);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const jar = await cookies();
  const browser = jar.get("folio_oauth_browser")?.value;
  jar.set("folio_oauth_browser", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/oauth", maxAge: 0 });
  if (!provider || !state || !browser || state.length > 128 || browser.length > 128 || !isProviderConfigured(provider)) return fail("That sign-in link expired or didn’t match. Please try again.");
  try {
    // Atomic deletion prevents replay, including cancelled and malformed flows.
    const [flow] = await db.delete(authFlows).where(and(eq(authFlows.stateHash, hashToken(state)), eq(authFlows.browserHash, hashToken(browser)), eq(authFlows.provider, provider), gt(authFlows.expiresAt, new Date()))).returning();
    if (!flow) return fail("That sign-in link expired or didn’t match. Please try again.");
    linking = Boolean(flow.linkUserId);
    if (!code || url.searchParams.has("error")) return fail("Sign-in was cancelled or could not be completed.");
    if (flow.linkUserId && ((await currentUser())?.id !== flow.linkUserId || await sessionTokenHash() !== flow.linkSessionHash)) return fail("Your session changed. Sign in again before linking.");
    const verifier = openToken(flow.verifierEnc);
    if (!verifier) return fail("That sign-in link expired. Please try again.");
    const identity = await exchangeProviderCode(provider, request, code, verifier);
    const user = await resolveOAuthIdentity(identity, flow.linkUserId);
    if (flow.linkUserId) {
      await onProviderLinked({ user, provider, providerEmail: identity.email, appOrigin: origin });
    } else {
      if (flow.desktop) {
        const code = randomBytes(32).toString("hex");
        await db.insert(desktopAuthHandoffs).values({
          tokenHash: hashToken(code),
          userId: user.id,
          destination: signedInDestination(user, flow.returnTo),
          expiresAt: new Date(Date.now() + 2 * 60_000),
        });
        if (!user.welcomeEmailSentAt && Date.now() - new Date(user.createdAt).getTime() < 60_000) {
          await onAccountCreated({ user, appOrigin: origin });
        }
        return Response.redirect(`folio://auth?code=${code}`, 302);
      }
      await createSession(user.id);
      if (!user.welcomeEmailSentAt && Date.now() - new Date(user.createdAt).getTime() < 60_000) {
        await onAccountCreated({ user, appOrigin: origin });
      }
    }
    return Response.redirect(`${origin}${flow.linkUserId ? "/settings" : signedInDestination(user, flow.returnTo)}`, 302);
  } catch (error) {
    return fail(error instanceof Error && /account|provider|email|workspace/i.test(error.message) ? error.message : "Sign-in could not be completed. Please try again.");
  }
}
