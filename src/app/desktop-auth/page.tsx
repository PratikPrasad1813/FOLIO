import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function DesktopAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const cookieStore = await cookies();
  
  // Find your active session token (checking common session cookie names)
  const sessionToken = 
    cookieStore.get("folio_session")?.value || 
    cookieStore.get("session")?.value ||
    cookieStore.getAll().find(c => c.name.toLowerCase().includes("session") || c.name.toLowerCase().includes("auth"))?.value;

  // If not logged in on Chrome, send to login first, then come back here
  if (!sessionToken) {
    redirect("/login?next=/desktop-auth");
  }

  const desktopUrl = `folio://auth?token=${encodeURIComponent(sessionToken)}`;
  const redirectScript = `window.location.href = ${JSON.stringify(desktopUrl).replace(/</g, "\\u003c")};`;

  return (
    <main>
      <p>Opening Folio…</p>
      <a href={desktopUrl}>Open Folio</a>
      <script dangerouslySetInnerHTML={{ __html: redirectScript }} />
    </main>
  );
}