import { notFound } from "next/navigation";
const VIEWS = ["overview", "projects", "tasks", "ideas", "calendar", "ai", "settings"];
export const dynamic = "force-dynamic";
export default async function WorkspaceViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!VIEWS.includes(view)) notFound();
  return null;
}
