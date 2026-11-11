"use client";

import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { desktopExchangeHandoffCode, isNetworkError } from "@/lib/desktop/auth-store";

/**
 * Deep-link bridge for desktop sign-in (local shell edition).
 *
 * The user finishes signing in inside the SYSTEM BROWSER (the deployed
 * web app at `<api>/login?next=/desktop-auth` — email, Google or GitHub).
 * The web page mints a one-time handoff code and deep-links back:
 *
 *     folio://auth?code=<64-hex>
 *
 * This listener exchanges the code against the deployed API
 * (`/api/auth/desktop/exchange`, absolute URL + CORS) and persists the
 * returned user + 90-day Bearer token in `local_auth`. The session-gate
 * picks up the `folio:desktop-session` event and swaps to the workspace —
 * no navigation, no reload, no flash.
 *
 * Offline resilience: network failures are swallowed silently (a handoff
 * code cannot be exchanged without internet; the user simply stays on the
 * sign-in screen).
 */

export function DesktopDeepLinkListener() {
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const handledCodes = new Set<string>();

    const exchangeCode = async (code: string) => {
      if (handledCodes.has(code)) return;
      handledCodes.add(code);
      try {
        await desktopExchangeHandoffCode(code);
        // Success: auth-store already emitted the session event; the
        // session gate renders the workspace by itself.
      } catch (error) {
        // A network failure while offline is expected and silent; only a
        // definitive server rejection is worth surfacing (the sign-in
        // screen keeps its own error area).
        if (!isNetworkError(error) && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("folio:desktop-handoff-error", {
            detail: { message: error instanceof Error ? error.message : "Desktop sign-in could not be completed." },
          }));
        }
      }
    };

    const handleUrls = (urls: string[]) => {
      for (const rawUrl of urls) {
        try {
          const url = new URL(rawUrl);
          const code = url.searchParams.get("code");
          if (url.protocol === "folio:" && url.hostname === "auth" && code && /^[a-f0-9]{64}$/.test(code)) {
            void exchangeCode(code);
          }
        } catch {
          // A malformed deep link is ignored — it can never carry a
          // valid handoff code, and must not disturb the shell.
        }
      }
    };

    void (async () => {
      const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
      unlisten = await onOpenUrl(handleUrls);
      if (disposed) {
        unlisten();
        return;
      }
      const currentUrls = await getCurrent();
      if (currentUrls) handleUrls(currentUrls);
    })().catch(() => {
      // The deep-link plugin being unavailable (or the promise rejecting
      // during teardown) is never fatal: password sign-in still works.
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return null;
}
