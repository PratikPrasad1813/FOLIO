import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserSafe, safeDestination, signedInDestination } from "@/lib/auth";
import { AuthScreen } from "@/components/auth-screen";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your next chapter — Folio", robots: { index: false, follow: false } };
export default async function Signup({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams; const next = safeDestination(params.next);
  const { user, dbError } = await currentUserSafe(); if (user) redirect(signedInDestination(user, next));
  // A misconfigured DATABASE_URL renders the sign-up screen with a fix-it
  // notice instead of crashing the page (DATABASE_SETUP.md → Troubleshooting).
  if (dbError) return <AuthScreen mode="signup" next={next} error={`${dbError.message} ${dbError.hint}`}/>;
  return <AuthScreen mode="signup" next={next}/>;
}
