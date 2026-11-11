"use client";

/**
 * Offline-resilient desktop session (the `local_auth` layer).
 *
 * THE CONTRACT (root cause #2 of the offline crashes):
 *
 *   - The signed-in user profile (`id`, `name`, `email`, …) and the Bearer
 *     token are persisted in the `local_auth` table of `folio.db` (SQLite).
 *     SQLite was chosen over localStorage because it is atomic with the
 *     workspace mirror, survives browser-storage clears and cannot be read
 *     by other windows of the app.
 *
 *   - When the desktop app boots, `resolveDesktopBootSession()` ONLY reads
 *     that row. It NEVER pings `/api/auth/session` over the network. If a
 *     cached session exists the user is immediately treated as
 *     authenticated and `/overview` renders — in airplane mode, with Wi-Fi
 *     off, after the token's cloud session was revoked, always.
 *
 *   - The app is NEVER redirected to `/login` while offline. The sign-in
 *     screen only appears when (a) no cached session exists at all, or
 *     (b) the sync engine reports the token expired while ONLINE, or
 *     (c) the user explicitly clicks "Sign out" (which clears local_auth,
 *     wipes the local mirror and stops the sync engine).
 *
 *   - Local data is never destroyed by an auth hiccup: a 401 from the
 *     background engine is surfaced as a subtle "sign in again" prompt
 *     while every offline capability keeps working.
 */

import { useEffect, useState } from "react";
import type { User } from "@/lib/types";
import { isDesktopRuntime } from "@/lib/desktop/runtime";
import { desktopApiUrl } from "@/lib/desktop/api-base";
import {
  clearLocalAuth,
  initLocalDb,
  readLocalAuth,
  setCachedProfile,
  wipeLocalDatabase,
  writeLocalAuth,
} from "@/lib/desktop/local-db";

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export interface DesktopSession {
  user: User;
  token: string;
  /** ISO timestamp — the cloud-side expiry of `token`. */
  expiresAt: string;
}

export type DesktopSessionStatus =
  | { state: "boot" }
  | { state: "authenticated"; session: DesktopSession }
  | { state: "signin"; reason: "fresh" | "signed-out" | "expired" };

export const DESKTOP_SESSION_EVENT = "folio:desktop-session";

/** A session is expired only when its token's own expiry has passed. */
export function isDesktopSessionExpired(session: DesktopSession): boolean {
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) ? Date.now() >= expiresAt : false;
}

/* ------------------------------------------------------------------ */
/* network error classification (silent offline handling)              */
/* ------------------------------------------------------------------ */

/**
 * True for the fetch failures caused by no connectivity ("TypeError:
 * Failed to fetch", DNS failures, aborted requests). These are EXPECTED
 * in an offline-capable app: callers swallow them silently and park the
 * UI in its offline state instead of raising errors or unhandled
 * promise rejections.
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  // fetch() rejects with TypeError on network failure in every engine.
  if (error.name === "TypeError") return true;
  return /failed to fetch|networkerror|network error|load failed|err_name_not_resolved|err_internet_disconnected|err_connection_refused/i.test(error.message);
}

/* ------------------------------------------------------------------ */
/* session persistence                                                 */
/* ------------------------------------------------------------------ */

/** Read the persisted session. Returns null when signed out or corrupted. */
export async function getDesktopSession(): Promise<DesktopSession | null> {
  if (typeof window === "undefined" || !isDesktopRuntime()) return null;
  try {
    await initLocalDb();
    const row = await readLocalAuth();
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.user_json);
    if (!parsed || typeof parsed !== "object" || typeof (parsed as User).id !== "string") return null;
    const user = parsed as User;
    if (!user.id || typeof row.token !== "string" || !row.token) return null;
    return { user, token: row.token, expiresAt: row.expires_at };
  } catch {
    // A corrupt auth row must never brick the shell: treat as signed out.
    return null;
  }
}

/**
 * The boot-time resolution. Reads SQLite only — by design there is NO
 * network call here (see the module contract). `expired` is still returned
 * as a session: the workspace renders locally and the engine surfaces the
 * expired token as a prompt once it sees a live 401.
 */
export async function resolveDesktopBootSession(): Promise<DesktopSession | null> {
  return getDesktopSession();
}

/**
 * Persist a session (sign-in, token refresh, handoff exchange).
 *
 * Account switch: when the incoming user differs from the previously
 * stored one, the whole local mirror + outbox of the old account is wiped
 * BEFORE the new profile is cached — two accounts' rows must never mix.
 */
export async function saveDesktopSession(session: DesktopSession): Promise<void> {
  await initLocalDb();
  const previous = await readLocalAuth();
  if (previous && previous.user_id && previous.user_id !== session.user.id) {
    await wipeLocalDatabase();
  }
  await writeLocalAuth({
    user_id: session.user.id,
    user_json: JSON.stringify(session.user),
    token: session.token,
    expires_at: session.expiresAt,
    updated_at: new Date().toISOString(),
  });
  // Seed/refresh the workspace profile snapshot so the very first render
  // after sign-in already has a user (the sync engine's first pull fills
  // the collections).
  await setCachedProfile(session.user);
  emitSessionChange({ state: "authenticated", session });
}

/* ------------------------------------------------------------------ */
/* sign-in transports                                                  */
/* ------------------------------------------------------------------ */

interface DesktopLoginResponse {
  user?: User;
  token?: string;
  expiresAt?: string;
  error?: string;
}

/** Parse and validate a desktop auth endpoint response into a session. */
function parseSessionPayload(body: DesktopLoginResponse): DesktopSession {
  if (!body.user || typeof body.user.id !== "string") throw new Error(body.error || "The sign-in response was incomplete.");
  if (!body.token || typeof body.token !== "string") throw new Error(body.error || "The sign-in response was missing its token.");
  if (!body.expiresAt || Number.isNaN(Date.parse(body.expiresAt))) throw new Error(body.error || "The sign-in response was missing its expiry.");
  return { user: body.user, token: body.token, expiresAt: body.expiresAt };
}

/** Email + password sign-in against the deployed API (cross-origin, CORS-enabled). */
export async function desktopSignInWithPassword(email: string, password: string): Promise<DesktopSession> {
  const response = await fetch(desktopApiUrl("/api/auth/desktop/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json().catch(() => ({}))) as DesktopLoginResponse;
  if (!response.ok) throw new Error(body.error || "That email and password don’t match. Try again.");
  const session = parseSessionPayload(body);
  await saveDesktopSession(session);
  return session;
}

/**
 * Exchange a one-time handoff code minted by the web app (browser sign-in
 * flow: the user signs in at `<api>/login?next=/desktop-auth`, the page
 * deep-links back `folio://auth?code=<64-hex>`).
 */
export async function desktopExchangeHandoffCode(code: string): Promise<DesktopSession> {
  const response = await fetch(desktopApiUrl("/api/auth/desktop/exchange"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({ code }),
  });
  const body = (await response.json().catch(() => ({}))) as DesktopLoginResponse;
  if (!response.ok) throw new Error(body.error || "This sign-in link expired or was already used.");
  const session = parseSessionPayload(body);
  await saveDesktopSession(session);
  return session;
}

/** Open the deployed sign-in page in the system browser (OAuth etc.). */
export async function openDesktopBrowserSignIn(): Promise<void> {
  const target = `${desktopApiUrl("/login")}?next=${encodeURIComponent("/desktop-auth")}`;
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(target);
}

/* ------------------------------------------------------------------ */
/* sign-out                                                            */
/* ------------------------------------------------------------------ */

/**
 * Explicit sign-out (the ONLY path that ever clears the session):
 *   1. best-effort revoke the token in the cloud (silent when offline),
 *   2. clear local_auth,
 *   3. wipe the local mirror + outbox (never leak into the next account),
 *   4. notify the background sync engine (it stops itself),
 *   5. tell the UI to show the sign-in screen.
 */
export async function desktopSignOut(): Promise<void> {
  const session = await getDesktopSession().catch(() => null);
  if (session) {
    try {
      await fetch(desktopApiUrl("/api/auth/desktop/token"), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.token}` },
        credentials: "omit",
      });
    } catch {
      // Offline revoke: the token expires server-side anyway; signing out
      // must never depend on connectivity.
    }
  }
  try {
    await clearLocalAuth();
  } catch {
    // The row may already be gone; proceed with the mirror wipe regardless.
  }
  try {
    await wipeLocalDatabase();
  } catch {
    // A locked database cannot keep the user signed in either; local_auth
    // was already cleared so the next boot lands on the sign-in screen.
  }
  // The background sync engine listens for this event and stops itself
  // (auth-store must not import sync-engine: the engine imports the store).
  emitSessionChange({ state: "signin", reason: "signed-out" });
}

/* ------------------------------------------------------------------ */
/* change notification (gate + workspace re-render)                    */
/* ------------------------------------------------------------------ */

type SessionListener = (status: Exclude<DesktopSessionStatus, { state: "boot" }>) => void;
const listeners = new Set<SessionListener>();

function emitSessionChange(status: Exclude<DesktopSessionStatus, { state: "boot" }>): void {
  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      // A broken listener must never break the session flow.
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DESKTOP_SESSION_EVENT, { detail: status }));
  }
}

export function subscribeDesktopSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Hydration-safe session hook for the desktop gate.
 *
 * The first render (server AND hydration) is always `{ state: "boot" }`;
 * the real status is resolved inside an effect, so SSR markup and the
 * hydration pass are byte-identical — no mismatch, no Tauri access during
 * render.
 */
export function useDesktopSession(): DesktopSessionStatus {
  const [status, setStatus] = useState<DesktopSessionStatus>({ state: "boot" });

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let cancelled = false;

    void (async () => {
      const session = await resolveDesktopBootSession();
      if (cancelled) return;
      setStatus(
        session
          ? { state: "authenticated", session }
          : { state: "signin", reason: "fresh" },
      );
    })().catch(() => {
      if (!cancelled) setStatus({ state: "signin", reason: "fresh" });
    });

    const unsubscribe = subscribeDesktopSession((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return status;
}
