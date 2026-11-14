import { notFound } from "next/navigation";

const VIEWS = ["overview", "projects", "tasks", "ideas", "calendar", "ai", "settings"];

/**
 * Desktop builds are static exports: every workspace view is prerendered at
 * build time (generateStaticParams) so the Tauri shell serves them from local
 * assets at 0ms. The web build keeps its dynamic, server-authenticated flow
 * (no generateStaticParams — see the note below).
 */
export const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_DESKTOP_BUILD === "1";

// No `export const dynamic`: build-desktop.mjs stashes any route that declares
// it, and the two builds need opposite behaviour.
//
// DYNAMIC_SERVER_USAGE POST-MORTEM: on the web this module must NOT export
// `generateStaticParams` at all — not even one that returns `[]`. An empty
// array tells Next.js to prerender each path on first visit (ISR), and the
// parent (workspace) layout reads headers()/cookies() for the session check.
// Those dynamic APIs throw DYNAMIC_SERVER_USAGE inside an ISR render, so
// /overview, /projects, … crashed with a 500 and showed error.tsx. Without
// `generateStaticParams`, the web route stays fully dynamic (server-rendered
// per request); only the static desktop export prerenders the views.
export const generateStaticParams = IS_DESKTOP_BUILD
  ? () => VIEWS.map((view) => ({ view }))
  : undefined;

export default async function WorkspaceViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!VIEWS.includes(view)) notFound();
  return null;
}
