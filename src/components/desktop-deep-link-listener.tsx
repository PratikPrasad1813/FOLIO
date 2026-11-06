"use client";

import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";

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
        const response = await fetch("/api/auth/desktop/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await response.json() as { destination?: string; error?: string };
        if (!response.ok || !data.destination) {
          throw new Error(data.error || "Desktop sign-in could not be completed.");
        }
        window.location.assign(data.destination);
      } catch (error) {
        console.error("Desktop sign-in exchange failed.", error);
        window.location.assign(`/login?error=${encodeURIComponent("Desktop sign-in could not be completed. Please try again.")}`);
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
        } catch (error) {
          console.error("Could not parse a Folio sign-in link.", error);
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
    })().catch((error: unknown) => {
      console.error("Could not initialize Folio deep-link handling.", error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return null;
}
