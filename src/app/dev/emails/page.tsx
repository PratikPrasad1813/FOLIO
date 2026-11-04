import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmailPreviewStudio } from "@/components/email-preview-studio";
import { normalizeAppOrigin } from "@/lib/email/design-system";
import { isEmailDeliveryConfigured } from "@/lib/email/mailer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Email Design System Preview — Folio",
  robots: { index: false, follow: false },
};

export default function EmailPreviewPage() {
  if (process.env.NODE_ENV === "production" && process.env.FOLIO_EMAIL_PREVIEW !== "1") {
    notFound();
  }
  return (
    <EmailPreviewStudio
      defaultOrigin={normalizeAppOrigin()}
      smtpConfigured={isEmailDeliveryConfigured()}
    />
  );
}
