"use client";

/**
 * Client-side session gate for the desktop workspace layout.
 *
 * In the desktop build there is no Next.js server to run the classic
 * cookie-redirect layout — the whole shell is a static bundle. This gate
 * replaces that server gate with a LOCAL one:
 *
 *   boot      → neutral splash (identical on the server render and during
 *               hydration — the hydration contract that previously broke)
 *   signin    → the desktop sign-in card (no cached session exists, the
 *               user signed out, or the token expired while online)
 *   ready     → the workspace, rendered IMMEDIATELY from local SQLite
 *
 * It never pings `/api/auth/session`: the boot decision is made purely
 * from the cached `local_auth` row, so airplane-mode boots land straight
 * in the workspace.
 */

import { useEffect, type ReactNode } from "react";
import { useDesktopSession } from "@/lib/desktop/auth-store";
import { getSyncEngine, useSyncStatus } from "@/lib/desktop/sync-engine";
import { DesktopSignIn } from "@/components/desktop/desktop-signin";

export function DesktopSessionGate({ children }: { children?: ReactNode }) {
  const session = useDesktopSession();
  const syncStatus = useSyncStatus();

  // Launch trigger for the background engine: it starts exactly once per
  // session (its own `started` flag is idempotent) and never blocks this
  // render — the workspace paints from SQLite while the first cycle runs.
  useEffect(() => {
    if (session.state === "authenticated") getSyncEngine()?.start();
  }, [session.state]);

  // Neutral splash for the boot phase (and the server render).
  if (session.state === "boot") return <DesktopBootSplash />;

  if (session.state === "signin") {
    return <DesktopSignIn reason={session.reason} />;
  }

  // The engine saw a live 401 (only possible while ONLINE): offer a
  // re-auth. Local data stays intact and offline editing keeps working.
  if (syncStatus.state === "auth-expired") {
    return <DesktopSignIn reason="expired" cachedEmail={session.session.user.email} />;
  }

  return <>{children}</>;
}

function DesktopBootSplash() {
  return (
    <div className="desktop-boot-splash" role="status" aria-label="Opening your workspace">
      <style>{desktopSplashCss}</style>
      <span className="boot-mark" aria-hidden="true">✳</span>
      <p>Opening your workspace…</p>
    </div>
  );
}

const desktopSplashCss = `
.desktop-boot-splash{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  background:var(--bg-app,#f6f5f4);color:var(--text-muted,#6b675f);font:500 13px/1.4 var(--font-ui,system-ui,sans-serif)}
[data-theme="dark"] .desktop-boot-splash{background:var(--bg-app,#08090a);color:var(--text-muted,#a5a09a)}
.desktop-boot-splash .boot-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;
  font-size:22px;color:#fff;background:linear-gradient(135deg,#7c6cf0,#5a8bd4);animation:folio-boot-pulse 1.1s ease-in-out infinite}
.desktop-boot-splash p{margin:0}
@keyframes folio-boot-pulse{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.07);opacity:1}}
`;
