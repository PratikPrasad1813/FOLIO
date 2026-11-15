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

import { useEffect, useState, type ReactNode } from "react";
import { saveDesktopSession, useDesktopSession } from "@/lib/desktop/auth-store";
import { getSyncEngine, useSyncStatus } from "@/lib/desktop/sync-engine";
import { DesktopSignIn } from "@/components/desktop/desktop-signin";
import { Onboarding } from "@/components/onboarding";
import { DEFAULT_PERSONAL } from "@/lib/personalization";
import type { AIPreferences } from "@/lib/folio-ai/types";

export function DesktopSessionGate({ children }: { children?: ReactNode }) {
  const session = useDesktopSession();
  const syncStatus = useSyncStatus();
  const [reauthToken, setReauthToken] = useState<string | null>(null);
  const [bootStalled, setBootStalled] = useState(false);
  const authExpired = syncStatus.state === "auth-expired";
  const token = session.state === "authenticated" ? session.session.token : null;
  // "Sign in again" only applies to the token that expired: after a fresh
  // sign-in (new token) the earlier click is automatically forgotten.
  const reauthRequested = authExpired && token !== null && reauthToken === token;

  // Launch trigger for the background engine: it starts exactly once per
  // session token (its own `started` flag is idempotent) and never blocks this
  // render — the workspace paints from SQLite while the first cycle runs.
  // Keyed on the token so signing in again (new token, engine stopped by the
  // session change) always brings syncing back.
  useEffect(() => {
    if (token) getSyncEngine()?.start();
  }, [token]);

  // If opening the local workspace takes unusually long, say so instead of
  // showing a splash screen forever.
  useEffect(() => {
    if (session.state !== "boot") return;
    const timer = window.setTimeout(() => setBootStalled(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [session.state]);

  // Neutral splash for the boot phase (and the server render).
  if (session.state === "boot") return <DesktopBootSplash stalled={bootStalled} />;

  if (session.state === "signin") {
    return <DesktopSignIn reason={session.reason} />;
  }

  // The engine saw a live 401 (only possible while ONLINE). The user chose to
  // sign in again: show the sign-in card. Until then the workspace stays fully
  // usable (a banner explains why syncing is paused), so a stray 401 can never
  // throw anyone out of their own work.
  if (reauthRequested) {
    return <DesktopSignIn reason="expired" cachedEmail={session.session.user.email} />;
  }

  if (session.state === "authenticated" && !session.session.user.onboardingCompleted) {
    const tz = (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null) || "UTC";
    const personal = { ...DEFAULT_PERSONAL, ...session.session.user.personal };
    // Literal (not DEFAULT_AI_PREFERENCES): importing that constant here
    // would pull the server db module into the desktop client bundle.
    const assistant: AIPreferences = {
      assistantName: "Folio AI",
      presentation: "neutral",
      style: "calm",
      modelPreference: "automatic",
      selectedModelId: null,
    };
    return (
      <Onboarding
        initial={{
          user: { ...session.session.user, personal },
          personal,
          timezone: session.session.user.timezone || tz,
          notificationsEnabled: true,
          quietHoursEnabled: false,
          assistant,
          onboardingStep: 0,
          onboardingCompleted: false,
          linkedProviders: [],
        }}
        next="/overview"
        desktopToken={session.session.token}
        onComplete={async (updatedUser) => {
          await saveDesktopSession({
            ...session.session,
            user: { ...session.session.user, ...updatedUser, personal: { ...DEFAULT_PERSONAL, ...updatedUser.personal }, onboardingCompleted: true },
          });
        }}
      />
    );
  }

  return (
    <>
      {authExpired && (
        <div className="desktop-reauth-banner" role="alert">
          <style>{desktopSplashCss}</style>
          <span>
            <strong>Your Folio sign-in has expired.</strong> Everything you do is still saved on this computer, but it is not being backed up online until you sign in again.
          </span>
          <button type="button" onClick={() => setReauthToken(token)}>Sign in again</button>
        </div>
      )}
      {children}
    </>
  );
}

function DesktopBootSplash({ stalled }: { stalled: boolean }) {
  return (
    <div className="desktop-boot-splash" role="status" aria-label="Opening your workspace">
      <style>{desktopSplashCss}</style>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export uses plain images */}
      <img src="/folio-icon.png" alt="" width={52} height={52} className="boot-mark" draggable={false} />
      <p>Opening your workspace…</p>
      {stalled && (
        <>
          <p className="boot-help">
            This is taking longer than usual. Folio is reading the data stored on this computer. If nothing changes in a moment, close Folio completely and open it again. Your work is not lost.
          </p>
          <button type="button" className="boot-reload" onClick={() => window.location.reload()}>Try again</button>
        </>
      )}
    </div>
  );
}

const desktopSplashCss = `
.desktop-boot-splash{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  background:var(--bg-app,#f6f5f4);color:var(--text-muted,#6b675f);font:500 13px/1.4 var(--font-ui,system-ui,sans-serif)}
[data-theme="dark"] .desktop-boot-splash{background:var(--bg-app,#08090a);color:var(--text-muted,#a5a09a)}
.desktop-boot-splash .boot-mark{width:52px;height:52px;border-radius:13px;box-shadow:0 10px 24px -8px rgba(90,78,205,.45);animation:folio-boot-pulse 1.1s ease-in-out infinite}
.desktop-boot-splash p{margin:0}
.desktop-boot-splash .boot-help{max-width:420px;text-align:center;line-height:1.55}
.desktop-boot-splash .boot-reload{margin-top:4px;padding:8px 16px;border-radius:9px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;cursor:pointer}
.desktop-reauth-banner{position:fixed;z-index:2000;left:50%;top:10px;transform:translateX(-50%);display:flex;gap:14px;align-items:center;max-width:min(760px,calc(100vw - 24px));
  padding:10px 14px;border-radius:12px;background:#fff7e6;color:#5c3d00;border:1px solid #f0c36d;box-shadow:0 10px 30px -12px rgba(0,0,0,.35);font:500 13px/1.45 var(--font-ui,system-ui,sans-serif)}
[data-theme="dark"] .desktop-reauth-banner{background:#2a2110;color:#f3d9a0;border-color:#6b5320}
.desktop-reauth-banner button{flex:none;padding:7px 13px;border-radius:8px;border:0;background:#5a4ecd;color:#fff;font:inherit;font-weight:600;cursor:pointer}
@keyframes folio-boot-pulse{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.07);opacity:1}}
`;
