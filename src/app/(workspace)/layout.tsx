import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Workspace from "@/components/workspace";
import { currentUser, safeDestination } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const destination = safeDestination((await headers()).get("x-folio-destination"));
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(destination)}`);
  if (!user.onboardingCompletedAt) redirect(`/onboarding?next=${encodeURIComponent(destination)}`);
  const preference = user.personal?.theme || "system";
  const selected = ["light", "dark", "system"].includes(preference) ? preference : "system";
  const boot = `(function(){var p=${JSON.stringify(selected)};var t=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=p;document.documentElement.style.colorScheme=t;})();`;
  return <><script dangerouslySetInnerHTML={{ __html: boot }}/><Workspace>{children}</Workspace></>;
}
