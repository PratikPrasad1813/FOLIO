import type { Metadata } from "next";
import { getDesktopDownload } from "@/lib/desktop-downloads";
import { DownloadGuide } from "./download-guide";

type DownloadPageProps = {
  searchParams: Promise<{ package?: string | string[] }>;
};

export const metadata: Metadata = {
  title: "Thank you for choosing Folio",
  description: "Download Folio and follow the steps to install it on your computer.",
  robots: { index: false, follow: true },
};

export default async function DownloadPage({ searchParams }: DownloadPageProps) {
  const params = await searchParams;
  const packageId = Array.isArray(params.package) ? params.package[0] : params.package;
  const download = getDesktopDownload(packageId);

  return <DownloadGuide download={download} />;
}
