"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Last-resort boundary for any page: explains the problem in plain English and offers clear next steps. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} />;
}
