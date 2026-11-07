import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsChapterContent, chapters, type ChapterId } from "../docs-content";

type ChapterPageProps = {
  params: Promise<{ chapter: string }>;
};

function isChapterId(value: string): value is ChapterId {
  return chapters.some((chapter) => chapter.id === value);
}

export function generateStaticParams() {
  return chapters.map((chapter) => ({ chapter: chapter.id }));
}

export async function generateMetadata({ params }: ChapterPageProps): Promise<Metadata> {
  const { chapter: chapterId } = await params;
  const chapter = chapters.find((item) => item.id === chapterId);
  if (!chapter) return { title: "Chapter not found · Folio Docs" };
  return {
    title: `${chapter.title.replace(/^\d+\.\s*/, "")} · Folio Docs`,
    description: `Folio documentation: ${chapter.sections.map(([, title]) => title).join(", ")}.`,
  };
}

export default async function DocumentationChapterPage({ params }: ChapterPageProps) {
  const { chapter: chapterId } = await params;
  if (!isChapterId(chapterId)) notFound();
  return <DocsChapterContent chapterId={chapterId} />;
}
