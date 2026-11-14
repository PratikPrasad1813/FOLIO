"use client";

/**
 * Desktop fetch bridge — the missing transport layer for the static shell.
 *
 * ROOT CAUSE THIS FIXES (the "A little pause" crash on every view except
 * /overview): the static export has no Next.js server, yet dozens of
 * workspace components call `fetch("/api/...")` with a RELATIVE URL. Inside
 * the Tauri shell that resolves against `http://tauri.localhost` — the asset
 * protocol happily answers with the 404/HTML fallback and HTTP 200, so the
 * caller parses `{}`, renders `undefined.length` and the route crashes into
 * the app-wide error boundary.
 *
 * THE CONTRACT (installed once, at module scope, before any effect runs):
 *   - Relative `/api/...` requests are rewritten to the deployed Folio API
 *     (`desktopApiUrl`) — the same origin every desktop endpoint already
 *     expects cross-origin.
 *   - The desktop's Bearer token is attached automatically, so cloud routes
 *     that accept it authenticate without any component changes.
 *   - Absolute URLs, fonts, and other static assets pass through untouched.
 *   - On the web runtime this module does nothing at all.
 *
 * Token plumbing lives in auth-store (`setDesktopFetchAuthToken`) so the
 * header follows sign-in / boot / sign-out without a fetch-site-wide
 * refactor.
 */

import { desktopApiUrl } from "@/lib/desktop/api-base";
import { isDesktopRuntime } from "@/lib/desktop/runtime";

let authToken: string | null = null;

/** Called by auth-store whenever the local session is read, saved or cleared. */
export function setDesktopFetchAuthToken(token: string | null): void {
  authToken = token;
}

const BRIDGE_FLAG = "__folioFetchBridgeInstalled";

export function installDesktopFetchBridge(): void {
  if (typeof window === "undefined" || !isDesktopRuntime()) return;
  const marker = window as typeof window & { [BRIDGE_FLAG]?: boolean };
  if (marker[BRIDGE_FLAG]) return;
  marker[BRIDGE_FLAG] = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Only RELATIVE /api paths are redirected. Anything absolute (the sync
    // engine, OAuth endpoints, avatars) or a plain asset (fonts, icons) is
    // forwarded untouched.
    const rawUrl =
      typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const isRelative = !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(rawUrl);
    if (!isRelative || !rawUrl.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    const target = desktopApiUrl(rawUrl);
    const headers = new Headers(
      init?.headers ?? (typeof input === "object" && !(input instanceof URL) ? input.headers : undefined),
    );
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

    if (typeof input === "object" && !(input instanceof URL)) {
      // Preserve method/body/flags of a Request input, retarget its URL.
      return originalFetch(new Request(target, input), { ...init, headers });
    }
    return originalFetch(target, { ...init, headers });
  };
}
