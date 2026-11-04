import { notFound, redirect } from "next/navigation";
import Workspace from "@/components/workspace";
import { getUser } from "@/lib/auth";

const views = ["overview", "projects", "tasks", "ideas", "calendar", "settings"];

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!views.includes(view)) notFound();
  const user = await getUser();
  if (!user) redirect("/");
  return <Workspace/>;
}
