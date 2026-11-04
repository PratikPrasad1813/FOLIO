import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

/**
 * Token encryption at rest.
 *
 * Refresh tokens are the long-lived keys to a user's Google account, so they are
 * sealed with AES-256-GCM before touching the database. Ciphertext format:
 *   v1.<iv>.<authTag>.<ciphertext>   (all base64url)
 * The version prefix lets us rotate the key later without a painful migration.
 */

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const SALT = "folio.google.tokens.v1";

function secretMaterial(): string {
  const dedicated = process.env.FOLIO_ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (dedicated && dedicated.length >= 16) return dedicated;
  // No dedicated key configured: derive a stable per-deployment key instead of
  // storing plaintext tokens. Set FOLIO_ENCRYPTION_KEY in production so rotating
  // the database URL doesn't invalidate stored credentials.
  return `${process.env.DATABASE_URL ?? "folio-local"}::folio-token-key`;
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = scryptSync(secretMaterial(), SALT, 32);
  return cachedKey;
}

/** Seals a secret. Returns null for empty input so callers can store nullable columns. */
export function sealToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const sealed = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${iv.toString("base64url")}.${tag.toString("base64url")}.${sealed.toString("base64url")}`;
}

/** Opens a sealed secret. Returns null when absent or undecryptable (e.g. key rotated). */
export function openToken(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered ciphertext: treat as "no token" and force re-auth.
    return null;
  }
}

function signingSecret() {
  return process.env.FOLIO_ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY ?? `${process.env.DATABASE_URL ?? "folio-local"}::folio-csrf`;
}

/**
 * Signed OAuth state payload. Google's `state` parameter plus PKCE verifier both
 * travel in one HttpOnly cookie, so a forged or replayed callback fails closed.
 */
export function signState(data: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
  const mac = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(signed: string | undefined | null): Record<string, unknown> | null {
  if (!signed) return null;
  const [body, mac] = signed.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { ts?: number };
    // 10-minute window: enough to finish consent, short enough to be useless replayed.
    if (!parsed.ts || typeof parsed.ts !== "number" || Date.now() - parsed.ts > 10 * 60 * 1000) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
