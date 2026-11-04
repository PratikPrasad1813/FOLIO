import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readProfile } from "@/lib/profile-service";
import { Onboarding } from "@/components/onboarding";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Make it yours — Folio preferences", robots: { index: false, follow: false } };
export default async function PreferencesPage() {
  const user = await currentUser(); if (!user) redirect("/login?next=/settings");
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  return <Onboarding initial={await readProfile(user)} next="/settings" editing/>;
}
