import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { DesktopHandoffClient } from "@/app/desktop-auth/handoff-client";

/**
 * Web-side pairing station for the desktop app (reached via
 * `/login?next=/desktop-auth` from the desktop sign-in screen).
 *
 * Once the user has a live browser session, the client component mints a
 * ONE-TIME handoff code via POST /api/auth/desktop/handoff and deep-links
 * back to the shell: `folio://auth?code=<64-hex>`. No raw session token
 * ever travels through a URL.
 */

export const dynamic = "force-dynamic";

export default async function DesktopAuthPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/desktop-auth");
  return <DesktopHandoffClient name={user.name} />;
}
