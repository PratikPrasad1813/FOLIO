import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Workspace from "@/components/workspace";
import { currentUser, safeDestination } from "@/lib/auth";
import { DesktopSessionGate } from "@/components/desktop/desktop-session-gate";

/**
 * Desktop builds (NEXT_PUBLIC_DESKTOP_BUILD=1 → static export) have no
 * Next.js server at runtime, so the classic server-side session redirect
 * cannot run. The client-side DesktopSessionGate replaces it: it reads the
 * cached local_auth session, renders the workspace instantly from local
 * SQLite and NEVER bounces to /login while offline. On the web the server
 * flow below is untouched.
 */
/** Build-time flag: `npm run build:desktop` sets NEXT_PUBLIC_DESKTOP_BUILD=1. */
export const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_DESKTOP_BUILD === "1";

// No `export const dynamic` here — it must be a static string literal, and
// the two builds need opposite behaviour:
//   - WEB: the headers()/currentUser() calls below opt the whole route into
//     dynamic rendering automatically (Next 15+ semantic).
//   - DESKTOP: the build-flag branch below touches no dynamic API, so the
//     layout prerenders statically into out/.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  if (IS_DESKTOP_BUILD) {
    return <DesktopSessionGate><Workspace>{children}</Workspace></DesktopSessionGate>;
  }

  const destination = safeDestination((await headers()).get("x-folio-destination"));
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(destination)}`);
  if (!user.onboardingCompletedAt) redirect(`/onboarding?next=${encodeURIComponent(destination)}`);
  const preference = user.personal?.theme || "system";
  const selected = ["light", "dark", "system"].includes(preference) ? preference : "system";
  const boot = `(function(){var p=${JSON.stringify(selected)};var t=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=p;document.documentElement.style.colorScheme=t;})();`;
  return <><script dangerouslySetInnerHTML={{ __html: boot }}/><Workspace>{children}</Workspace></>;
}
