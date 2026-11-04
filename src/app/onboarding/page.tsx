import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, safeDestination } from "@/lib/auth";
import { readProfile } from "@/lib/profile-service";
import { Onboarding } from "@/components/onboarding";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Make yourself at home — Folio", robots: { index: false, follow: false } };
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await currentUser(); const next = safeDestination((await searchParams).next);
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (user.onboardingCompletedAt) redirect(next);
  return <Onboarding initial={await readProfile(user)} next={next}/>;
}
