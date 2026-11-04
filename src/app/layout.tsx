import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./polish.css";
import "./auth.css";

export const metadata: Metadata = {
  title: "folio — A little clarity. A lot of possibility.",
  description: "A thoughtful personal workspace for your projects, tasks, and next big ideas. A little more organized. A little more you.",
  applicationName: "folio",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
