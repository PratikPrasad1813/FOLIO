"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { describeError, type FriendlyError } from "@/lib/friendly-errors";

/**
 * The one error screen every crash in Folio ends up on.
 *
 * It tells the person, in everyday words:
 *   - what happened,
 *   - that their saved work is safe,
 *   - exactly what to try (in order),
 * and keeps the raw technical text behind a "details" fold for support.
 *
 * Styling uses the shared theme tokens (with fallbacks) so it matches the
 * app in light and dark mode, and works even when only some CSS has loaded.
 */

const STEPS: Record<FriendlyError["kind"], string[]> = {
  offline: ["Check that Wi-Fi or your network cable is connected.", "Press “Try again”.", "Folio keeps working offline in the desktop app — your changes sync when the connection returns."],
  timeout: ["Wait about 30 seconds.", "Press “Try again”.", "If it keeps happening, the server may be restarting. Try again in a few minutes."],
  server: ["Wait about a minute — this is usually temporary.", "Press “Try again”.", "If it is still not working after a few minutes, close Folio and open it again."],
  signin: ["Press “Reload Folio”.", "Sign in again when asked.", "Your projects and tasks are not affected."],
  forbidden: ["Sign out and sign in again.", "Make sure you are using the account that owns this item."],
  missing: ["Press “Go to Overview”.", "Open your projects list and look for the item again."],
  update: ["Press “Reload Folio”.", "If you use the desktop app, close it completely and open it again."],
  unknown: ["Press “Try again”.", "If that does not help, press “Reload Folio”.", "Still stuck? Close Folio completely and open it again."],
};

export function ErrorScreen({
  error,
  reset,
  scope = "page",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** "page" fills the window; "view" sits inside the workspace beside the sidebar. */
  scope?: "page" | "view";
}) {
  const friendly = describeError(error);
  const [copied, setCopied] = useState(false);
  const details = [friendly.technical, error.digest ? `Reference: ${error.digest}` : ""].filter(Boolean).join("\n");

  useEffect(() => {
    // Keep the technical story available to support without showing it as the headline.
    console.error("[folio] screen error:", error);
  }, [error]);

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details || friendly.title);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be unavailable; the text is still visible to select by hand.
    }
  }

  return (
    <main
      role="alert"
      style={{
        minHeight: scope === "page" ? "100vh" : "60vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: scope === "page" ? "var(--background, #f6f5f3)" : "transparent",
        color: "var(--text, #27231e)",
        fontFamily: "var(--font-ui, system-ui, -apple-system, 'Segoe UI', sans-serif)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--surface, #fff)",
          border: "1px solid var(--border, #e7e3dc)",
          borderRadius: 18,
          padding: "30px 28px",
          boxShadow: "var(--shadow-md, 0 20px 50px -24px rgba(0,0,0,.35))",
        }}
      >
        <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--tone-red, #b14c57)" }}>
          Something didn’t work
        </p>
        <h1 style={{ margin: "0 0 10px", fontSize: 24, lineHeight: 1.25, color: "var(--heading, #211f1b)" }}>{friendly.title}</h1>
        <p style={{ margin: "0 0 18px", fontSize: 15, lineHeight: 1.6, color: "var(--text-soft, #4f4b45)" }}>{friendly.message}</p>

        <div style={{ margin: "0 0 20px", padding: "14px 16px", borderRadius: 12, background: "var(--surface-2, #fbfaf8)", border: "1px solid var(--border, #e7e3dc)" }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "var(--heading, #211f1b)" }}>What you can do</p>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.65, color: "var(--text-soft, #4f4b45)" }}>
            {STEPS[friendly.kind].map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button type="button" onClick={reset} style={primaryButton}>Try again</button>
          <button type="button" onClick={() => window.location.reload()} style={secondaryButton}>Reload Folio</button>
          <button type="button" onClick={() => window.location.assign("/overview/")} style={secondaryButton}>Go to Overview</button>
        </div>

        {details && (
          <details style={{ marginTop: 20, fontSize: 13, color: "var(--muted, #6b6760)" }}>
            <summary style={{ cursor: "pointer" }}>Technical details (only needed if you contact support)</summary>
            <pre style={{ margin: "10px 0 8px", padding: 12, borderRadius: 10, background: "var(--surface-3, #f1efeb)", color: "var(--text, #27231e)", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>{details}</pre>
            <button type="button" onClick={copyDetails} style={{ ...secondaryButton, padding: "6px 12px", fontSize: 12 }}>{copied ? "Copied" : "Copy details"}</button>
          </details>
        )}
      </section>
    </main>
  );
}

const primaryButton: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid var(--ink, #27231e)",
  background: "var(--ink, #27231e)",
  color: "var(--on-ink, #fff)",
  font: "inherit",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const secondaryButton: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid var(--border-strong, #dad6cf)",
  background: "var(--surface, #fff)",
  color: "var(--text, #27231e)",
  font: "inherit",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
