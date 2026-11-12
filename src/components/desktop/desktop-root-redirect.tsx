"use client";

/**
 * Root-page redirect for the desktop bundle.
 *
 * `tauri.conf.json` opens the app at `index.html` (the `/` route of the
 * static export). On the web, `/` is the marketing landing page — useful
 * there, noise in a desktop app. In desktop builds this client component
 * swaps `/` for the workspace entry (`/overview`) on first paint.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/ui";

export function DesktopRootRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/overview");
  }, [router]);
  return (
    <div className="desktop-boot-splash" role="status" aria-label="Opening Folio">
      <style>{`
.desktop-boot-splash{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  background:var(--bg-app,#f6f5f4);color:var(--text-muted,#6b675f);font:500 13px/1.4 var(--font-ui,system-ui,sans-serif)}
[data-theme="dark"] .desktop-boot-splash{background:var(--bg-app,#08090a);color:var(--text-muted,#a5a09a)}
.desktop-boot-splash .boot-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;overflow:hidden;
  animation:folio-boot-pulse 1.1s ease-in-out infinite}
.desktop-boot-splash p{margin:0}
@keyframes folio-boot-pulse{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.07);opacity:1}}
`}</style>
      <span className="boot-mark" aria-hidden="true"><LogoMark size={30} /></span>
      <p>Opening Folio…</p>
    </div>
  );
}
