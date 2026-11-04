import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { configuredProviders } from "@/lib/oauth";
import AuthLanding from "@/components/auth-landing";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getUser();
  if (user) redirect("/overview");
  const params = await searchParams;
  const raw = params.auth_error;
  const authError = typeof raw === "string" ? raw.slice(0, 400) : Array.isArray(raw) && typeof raw[0] === "string" ? raw[0].slice(0, 400) : "";
  return <AuthLanding providers={configuredProviders()} initialError={authError}/>;
}
