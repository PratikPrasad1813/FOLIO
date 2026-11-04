import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { authIdentities, users } from "@/db/schema";
import { requestOrigin } from "@/lib/auth";

export type OAuthProvider = "google" | "github";
export const OAUTH_PROVIDERS = {
  google: { label: "Google", authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", scope: "openid email profile", clientId: () => process.env.GOOGLE_CLIENT_ID, clientSecret: () => process.env.GOOGLE_CLIENT_SECRET },
  github: { label: "GitHub", authorizeUrl: "https://github.com/login/oauth/authorize", scope: "read:user user:email", clientId: () => process.env.GITHUB_CLIENT_ID, clientSecret: () => process.env.GITHUB_CLIENT_SECRET },
} satisfies Record<OAuthProvider, { label: string; authorizeUrl: string; scope: string; clientId: () => string | undefined; clientSecret: () => string | undefined }>;
export function isProviderConfigured(provider: OAuthProvider) {
  const p = OAUTH_PROVIDERS[provider];
  if (!p.clientId() || !p.clientSecret()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  try { return Boolean((process.env.FOLIO_ENCRYPTION_KEY?.length || 0) >= 32 && process.env.APP_URL && new URL(process.env.APP_URL).protocol === "https:"); }
  catch { return false; }
}
export function configuredProviders() { return { google: isProviderConfigured("google"), github: isProviderConfigured("github") }; }
export const appOrigin = requestOrigin;
export function redirectUri(request: Request, provider: OAuthProvider) { return `${appOrigin(request)}/api/auth/oauth/${provider}/callback`; }
export interface VerifiedIdentity { provider: OAuthProvider; subject: string; email: string; name: string }

export async function exchangeProviderCode(provider: OAuthProvider, request: Request, code: string, verifier: string): Promise<VerifiedIdentity> {
  const p = OAUTH_PROVIDERS[provider];
  if (!isProviderConfigured(provider)) throw new Error("This sign-in provider is not configured.");
  const endpoint = provider === "google" ? "https://oauth2.googleapis.com/token" : "https://github.com/login/oauth/access_token";
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ code, client_id: p.clientId()!, client_secret: p.clientSecret()!, redirect_uri: redirectUri(request, provider), grant_type: "authorization_code", code_verifier: verifier }), cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`${p.label} could not verify this sign-in.`);
  const token = await response.json() as { access_token?: string };
  if (!token.access_token) throw new Error(`${p.label} could not verify this sign-in.`);
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: "application/json", "User-Agent": "folio-workspace" };
  const profileResponse = await fetch(provider === "google" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://api.github.com/user", { headers, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!profileResponse.ok) throw new Error(`Could not read your ${p.label} profile.`);
  if (provider === "google") {
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string };
    if (!profile.sub || !profile.email || profile.email_verified !== true) throw new Error("Google must provide a verified email address.");
    return { provider, subject: profile.sub, email: profile.email.trim().toLowerCase(), name: profile.name || profile.email.split("@")[0] };
  }
  const profile = await profileResponse.json() as { id?: number; name?: string; login?: string };
  // GitHub's public profile.email is not proof of verification. Always use /user/emails.
  const emailsResponse = await fetch("https://api.github.com/user/emails", { headers: { ...headers, Accept: "application/vnd.github+json" }, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!profile.id || !emailsResponse.ok) throw new Error("GitHub must provide a verified email address.");
  const emails = await emailsResponse.json() as { email: string; primary: boolean; verified: boolean }[];
  const email = (emails.find(item => item.primary && item.verified) || emails.find(item => item.verified))?.email;
  if (!email) throw new Error("GitHub must provide a verified email address.");
  return { provider, subject: String(profile.id), email: email.trim().toLowerCase(), name: profile.name || profile.login || email.split("@")[0] };
}

/** Never equate a Neon Auth id with a Folio UUID. Existing cross-provider
 * accounts can only be linked after signing in/recovering that account. */
export async function resolveOAuthIdentity(identity: VerifiedIdentity, linkUserId: string | null) {
  if (!identity.subject || identity.subject.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email) || identity.email.length > 254) throw new Error("The provider did not return a valid verified identity.");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity.email}, 137))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity.provider + ":" + identity.subject}, 138))`);
    const [linked] = await tx.select().from(authIdentities).where(and(eq(authIdentities.provider, identity.provider), eq(authIdentities.subject, identity.subject))).limit(1);
    if (linked) {
      if (linkUserId && linked.userId !== linkUserId) throw new Error("This provider is already linked to another workspace.");
      const [user] = await tx.select().from(users).where(eq(users.id, linked.userId)).limit(1);
      if (!user) throw new Error("This identity has no workspace.");
      return user;
    }
    if (linkUserId) {
      const [user] = await tx.select().from(users).where(eq(users.id, linkUserId)).limit(1);
      if (!user || user.email.toLowerCase() !== identity.email) throw new Error("The provider's verified email must match your Folio email to link accounts.");
      const [other] = await tx.select().from(authIdentities).where(and(eq(authIdentities.userId, user.id), eq(authIdentities.provider, identity.provider))).limit(1);
      if (other) throw new Error("A different account for this provider is already linked.");
      await tx.insert(authIdentities).values({ userId: user.id, provider: identity.provider, subject: identity.subject, email: identity.email });
      if (!user.emailVerifiedAt) {
        const [verifiedUser] = await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id)).returning();
        if (verifiedUser) return verifiedUser;
      }
      return user;
    }
    const [existing] = await tx.select().from(users).where(eq(users.email, identity.email)).limit(1);
    if (existing) {
      // Initial Folio OAuth stored only the provider and email. Recover that
      // exact legacy provider once, but never automatically merge other providers.
      const [prior] = await tx.select().from(authIdentities).where(and(eq(authIdentities.userId, existing.id), eq(authIdentities.provider, identity.provider))).limit(1);
      if (existing.provider !== identity.provider || prior) throw new Error("An account already uses this email. Sign in or recover it first, then link this provider in Settings.");
      await tx.insert(authIdentities).values({ userId: existing.id, provider: identity.provider, subject: identity.subject, email: identity.email });
      if (!existing.emailVerifiedAt) {
        const [verifiedExisting] = await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, existing.id)).returning();
        if (verifiedExisting) return verifiedExisting;
      }
      return existing;
    }
    const [created] = await tx.insert(users).values({ name: identity.name.slice(0, 80), email: identity.email, provider: identity.provider, emailVerifiedAt: new Date() }).returning();
    await tx.insert(authIdentities).values({ userId: created.id, provider: identity.provider, subject: identity.subject, email: identity.email });
    return created;
  });
}
