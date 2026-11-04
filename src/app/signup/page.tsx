import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, safeDestination, signedInDestination } from "@/lib/auth";
import { AuthScreen } from "@/components/auth-screen";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your next chapter — Folio", robots: { index: false, follow: false } };
export default async function Signup({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams; const next = safeDestination(params.next);
  const user = await currentUser(); if (user) redirect(signedInDestination(user, next));
  return <AuthScreen mode="signup" next={next}/>;
}
