import { notFound } from "next/navigation";

const VIEWS = ["overview", "projects", "tasks", "ideas", "calendar", "ai", "settings"];

/**
 * Desktop builds are static exports: every workspace view is prerendered at
 * build time (generateStaticParams) so the Tauri shell serves them from local
 * assets at 0ms. The web build keeps its dynamic, server-authenticated flow.
 */
export const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_DESKTOP_BUILD === "1";

// No `export const dynamic`: the parent layout decides — dynamic on the web
// (it reads headers/cookies), statically prerendered in the desktop export.

export function generateStaticParams() {
  return IS_DESKTOP_BUILD ? VIEWS.map((view) => ({ view })) : [];
}

export default async function WorkspaceViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!VIEWS.includes(view)) notFound();
  return null;
}
