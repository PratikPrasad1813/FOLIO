"use client";

import { describeError } from "@/lib/friendly-errors";

/**
 * Used only when the root layout itself fails, so nothing else (fonts, theme,
 * global CSS) can be relied on: this screen is fully self-contained.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const friendly = describeError(error);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f6f5f3", color: "#27231e", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        <main role="alert" style={{ maxWidth: 480, background: "#fff", border: "1px solid #e7e3dc", borderRadius: 18, padding: "30px 28px" }}>
          <h1 style={{ margin: "0 0 10px", fontSize: 24 }}>{friendly.title}</h1>
          <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.6 }}>{friendly.message}</p>
          <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.6 }}>Press “Try again”. If that does not help, press “Reload Folio”, or close Folio completely and open it again.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={reset} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid #27231e", background: "#27231e", color: "#fff", font: "inherit", fontWeight: 600, cursor: "pointer" }}>Try again</button>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid #dad6cf", background: "#fff", color: "#27231e", font: "inherit", fontWeight: 600, cursor: "pointer" }}>Reload Folio</button>
          </div>
          {error.digest && <p style={{ marginTop: 18, fontSize: 12, color: "#6b6760" }}>Reference for support: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
