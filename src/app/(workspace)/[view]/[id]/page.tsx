import { notFound } from "next/navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

// Deep link to a single project: /projects/<id>. The (workspace) layout renders
// the project workspace (or a friendly "not found" state if it was deleted).
export default async function ProjectPage({ params }: { params: Promise<{ view: string; id: string }> }) {
  const { view, id } = await params;
  if (view !== "projects" || !UUID.test(id)) notFound();
  return null;
}
