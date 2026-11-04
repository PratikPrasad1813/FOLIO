import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, safeDestination, signedInDestination } from "@/lib/auth";
import { AuthScreen } from "@/components/auth-screen";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome back — Folio", robots: { index: false, follow: false } };
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams; const next = safeDestination(params.next);
  const user = await currentUser(); if (user) redirect(signedInDestination(user, next));
  const error = typeof params.error === "string" ? params.error.slice(0, 240) : "";
  return <AuthScreen mode="login" next={next} error={error}/>;
}
