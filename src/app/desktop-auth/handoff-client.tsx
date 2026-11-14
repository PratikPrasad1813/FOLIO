"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Logo } from "@/components/ui";

/**
 * Mint or receive a one-time desktop pairing code and bounce back to the shell
 * via the `folio://` deep link. If the protocol handler cannot be triggered
 * automatically, a manual button and copyable code stay available.
 */

export function DesktopHandoffClient({
  name = "there",
  directCode,
}: {
  name?: string;
  directCode?: string;
}) {
  const [phase, setPhase] = useState<"minting" | "ready" | "failed">(
    directCode ? "ready" : "minting",
  );
  const [code, setCode] = useState(directCode ?? "");
  const [deepLink, setDeepLink] = useState(
    directCode ? `folio://auth?code=${encodeURIComponent(directCode)}` : "",
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const triggered = useRef(false);

  useEffect(() => {
    if (directCode) {
      const link = `folio://auth?code=${encodeURIComponent(directCode)}`;
      setDeepLink(link);
      setPhase("ready");
      try {
        window.location.href = link;
      } catch {
        // Fallback to manual interaction
      }
      return;
    }

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
        if (!response.ok || !body.code) {
          throw new Error(body.error || "The pairing code could not be created.");
        }
        setCode(body.code);
        const link = `folio://auth?code=${encodeURIComponent(body.code)}`;
        setDeepLink(link);
        setPhase("ready");
        window.location.href = link;
      } catch (err) {
        setError(err instanceof Error ? err.message : "The pairing code could not be created.");
        setPhase("failed");
      }
    })();
  }, [directCode]);

  async function handleCopy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore clipboard error
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0d0d11",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          textAlign: "center",
          border: "1px solid #26262c",
          borderRadius: 20,
          padding: "36px 30px",
          background: "#141418",
          boxShadow: "0 25px 60px rgba(0,0,0,0.7)",
        }}
      >
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: 48,
            height: 48,
            margin: "0 auto 16px",
            borderRadius: 12,
            background: "linear-gradient(135deg,#7c6cf0,#5a8bd4)",
          }}
        >
          <Logo compact />
        </div>
        <h1 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700 }}>
          {phase === "failed"
            ? "Let’s try that again"
            : `You’re signed into Folio Desktop!`}
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 13, lineHeight: 1.6, color: "#a1a1aa" }}>
          {phase === "minting" && "Preparing a secure one-time pairing code…"}
          {phase === "ready" && "Opening the Folio desktop app automatically…"}
          {phase === "failed" && error}
        </p>

        {phase === "minting" && (
          <Loader2
            size={22}
            className="spin"
            style={{ color: "#a1a1aa" }}
            aria-label="Preparing"
          />
        )}

        {phase === "ready" && (
          <>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                color: "#34d399",
                fontSize: 12.5,
                marginBottom: 16,
              }}
            >
              <CheckCircle2 size={15} /> Authorization ready
            </div>

            <a
              href={deepLink}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                minHeight: 44,
                borderRadius: 10,
                background: "#7c6cf0",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                textDecoration: "none",
                marginBottom: 18,
              }}
            >
              <ExternalLink size={15} /> Open Folio Desktop
            </a>

            {code && (
              <div
                style={{
                  background: "#0a0a0d",
                  border: "1px solid #27272f",
                  borderRadius: 10,
                  padding: "12px 14px",
                  textAlign: "left",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "#888c9b",
                    marginBottom: 6,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  If Folio Desktop did not open automatically:
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="text"
                    readOnly
                    value={code}
                    style={{
                      flex: 1,
                      background: "#16161c",
                      border: "1px solid #32323e",
                      borderRadius: 6,
                      color: "#eceef5",
                      fontFamily: "monospace",
                      fontSize: 11,
                      padding: "6px 8px",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: copied ? "#10b981" : "#2a2b36",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 10px",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {phase === "failed" && (
          <button
            type="button"
            onClick={() => {
              triggered.current = false;
              setPhase("minting");
              setError("");
            }}
            style={{
              minHeight: 44,
              padding: "0 22px",
              borderRadius: 10,
              border: "1px solid #3f3f46",
              background: "transparent",
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        )}

        <p style={{ margin: "16px 0 0", fontSize: 11.5, color: "#71717a", lineHeight: 1.5 }}>
          Your web browser remains unauthenticated. Only your desktop application will be signed in. You can close this tab once the app opens.
        </p>
      </div>
    </main>
  );
}
