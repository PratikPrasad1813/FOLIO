import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { DesktopHandoffClient } from "@/app/desktop-auth/handoff-client";

export const dynamic = "force-dynamic";

export default async function DesktopAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; flow?: string }>;
}) {
  const params = await searchParams;
  if (params.code && /^[a-f0-9]{64}$/.test(params.code)) {
    // Coming directly from desktop OAuth callback! No web session needed or created.
    return <DesktopHandoffClient directCode={params.code} />;
  }

  const user = await currentUser();
  if (!user) redirect("/login?next=/desktop-auth");
  return <DesktopHandoffClient name={user.name} />;
}
