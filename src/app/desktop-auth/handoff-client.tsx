"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Logo } from "@/components/ui";

/**
 * Mint a one-time desktop pairing code and bounce back to the shell via the
 * `folio://` deep link. Kept resilient: if the deep link cannot be triggered
 * automatically (browser permission prompts etc.), a manual button stays
 * available; if code minting fails, the user can retry without leaving.
 */

export function DesktopHandoffClient({ name }: { name: string }) {
  const [phase, setPhase] = useState<"minting" | "ready" | "failed">("minting");
  const [deepLink, setDeepLink] = useState("");
  const [error, setError] = useState("");
  const triggered = useRef(false);

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;

    void (async () => {
      try {
        const response = await fetch("/api/auth/desktop/handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destination: "/overview" }),
        });
        const body = (await response.json()) as { code?: string; error?: string };
        if (!response.ok || !body.code) throw new Error(body.error || "The pairing code could not be created.");
        const link = `folio://auth?code=${encodeURIComponent(body.code)}`;
        setDeepLink(link);
        setPhase("ready");
        window.location.href = link;
      } catch (err) {
        setError(err instanceof Error ? err.message : "The pairing code could not be created.");
        setPhase("failed");
      }
    })();
  }, []);

  return (
    <main style={{ minHeight: "100vh", background: "#0d0d11", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420, textAlign: "center", border: "1px solid #26262c", borderRadius: 18, padding: "36px 30px", background: "#141418" }}>
        <div style={{ display: "grid", placeItems: "center", width: 48, height: 48, margin: "0 auto 16px", borderRadius: 12, background: "linear-gradient(135deg,#7c6cf0,#5a8bd4)" }}>
          <Logo compact />
        </div>
        <h1 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700 }}>
          {phase === "failed" ? "Let’s try that again" : `You’re in, ${name.split(" ")[0]}.`}
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 13, lineHeight: 1.7, color: "#a1a1aa" }}>
          {phase === "minting" && "Preparing a secure one-time pairing code…"}
          {phase === "ready" && "Opening the Folio desktop app automatically…"}
          {phase === "failed" && error}
        </p>

        {phase === "minting" && <Loader2 size={22} className="spin" style={{ color: "#a1a1aa" }} aria-label="Preparing" />}
        {phase === "ready" && (
          <>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#34d399", fontSize: 12.5, marginBottom: 18 }}>
              <CheckCircle2 size={15} /> Pairing code ready
            </div>
            <a
              href={deepLink}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", minHeight: 44, borderRadius: 10, background: "#fff", color: "#111", fontWeight: 600, fontSize: 13, textDecoration: "none" }}
            >
              <ExternalLink size={15} /> Open Folio Desktop
            </a>
          </>
        )}
        {phase === "failed" && (
          <button
            type="button"
            onClick={() => { triggered.current = false; setPhase("minting"); setError(""); }}
            style={{ minHeight: 44, padding: "0 22px", borderRadius: 10, border: "1px solid #3f3f46", background: "transparent", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
          >
            Try again
          </button>
        )}

        <p style={{ margin: "18px 0 0", fontSize: 11, color: "#71717a" }}>
          You can close this tab once the desktop app opens.
        </p>
      </div>
    </main>
  );
}
