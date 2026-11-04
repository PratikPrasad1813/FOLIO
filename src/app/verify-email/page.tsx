"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, MailCheck, ShieldCheck, Sparkles } from "lucide-react";
import { Logo, Spinner } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { EMAIL_FEATURES_ENABLED, EMAIL_FEATURES_NOTICE } from "@/lib/feature-flags";

type VerifyState =
  | { kind: "verifying" }
  | { kind: "verified"; email: string }
  | { kind: "expired"; message: string }
  | { kind: "invalid"; message: string };

// Deduplicates single-use token confirmation across React StrictMode remounts.
const inflightVerifications = new Map<string, Promise<VerifyState>>();
let capturedHashToken = "";

function verifyTokenOnce(token: string): Promise<VerifyState> {
  const existing = inflightVerifications.get(token);
  if (existing) return existing;

  const request = fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm", token }),
  })
    .then(async (response): Promise<VerifyState> => {
      const result = (await response.json()) as { ok?: boolean; email?: string; code?: string; error?: string };
      if (response.ok && result.ok) {
        return { kind: "verified", email: result.email || "Your email address" };
      }
      if (result.code === "expired") {
        return {
          kind: "expired",
          message: result.error || "This verification link has expired. Request a new 24-hour link from Settings.",
        };
      }
      return {
        kind: "invalid",
        message: result.error || "This verification link is invalid or has already been used.",
      };
    })
    .catch(
      (): VerifyState => ({
        kind: "invalid",
        message: "We couldn’t verify this link right now. Please check your connection and try again.",
      }),
    );

  inflightVerifications.set(token, request);
  return request;
}

export default function VerifyEmailPage() {
  const [state, setState] = useState<VerifyState>({ kind: "verifying" });
  const tokenRef = useRef<string>("");

  useEffect(() => {
    // While email features are paused, links are neither read nor sent to the API from the browser.
    if (!EMAIL_FEATURES_ENABLED) return;

    let cancelled = false;
    async function confirmFromHash() {
      const fromUrl = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
      if (fromUrl) {
        capturedHashToken = fromUrl;
        tokenRef.current = fromUrl;
        window.history.replaceState(null, "", "/verify-email");
      }
      const token = tokenRef.current || capturedHashToken;
      if (!token) {
        if (!cancelled) {
          setState({
            kind: "invalid",
            message:
              "No verification token was found in this link. Open the link directly from your email, or request a fresh one from Settings.",
          });
        }
        return;
      }
      setState({ kind: "verifying" });
      const outcome = await verifyTokenOnce(token);
      if (!cancelled) {
        capturedHashToken = "";
        tokenRef.current = "";
        setState(outcome);
      }
    }
    void confirmFromHash();
    const onHashChange = () => {
      if (window.location.hash.includes("token=")) void confirmFromHash();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return (
    <div className="public-site auth-experience">
      <section className="auth-editorial">
        <Link href="/" aria-label="Folio home">
          <Logo />
        </Link>
        <div className="auth-editorial-copy">
          <span className="lp-eyebrow">
            <span />
            ACCOUNT TRUST &amp; SECURITY
          </span>
          <h2>
            Verified.
            <br />
            Protected.
            <br />
            <em>Always yours.</em>
          </h2>
          <p>Confirming your email keeps password recovery reliable and ensures only verified identities can link to your workspace.</p>
        </div>
        <small>Thoughtfully organized. Always yours.</small>
      </section>

      <section className="auth-form-side">
        <div className="auth-top-line">
          <Link className="auth-back" href="/overview">
            <ArrowLeft size={15} />
            To your workspace
          </Link>
          <ThemeToggle />
        </div>

        <div className="auth-new-card">
          <span className="auth-small-mark">
            <Logo compact />
          </span>
          <span className="lp-eyebrow">EMAIL VERIFICATION</span>

          {!EMAIL_FEATURES_ENABLED ? (
            <>
              <h1>
                Verification is <em>temporarily unavailable.</em>
              </h1>
              <p>Your account and workspace are unchanged. You can continue using Folio normally.</p>
              <div className="folio-notice" role="note">
                <Sparkles size={14} />
                <span>{EMAIL_FEATURES_NOTICE}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                <Link className="lp-button is-primary" href="/overview">
                  Open my workspace
                  <ArrowRight size={15} />
                </Link>
                <Link className="lp-button is-outline" href="/login">
                  Sign in to Folio
                </Link>
              </div>
            </>
          ) : (
            <>
              {state.kind === "verifying" && (
                <>
                  <h1>
                    Confirming your <em>email…</em>
                  </h1>
                  <p>Hold on for just a moment while we verify your one-time security link.</p>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "14px 0", color: "var(--lp-muted)" }} role="status">
                    <Spinner size={18} />
                    <span>Verifying your Folio account…</span>
                  </div>
                </>
              )}

              {state.kind === "verified" && (
                <>
                  <h1>
                    Your email is <em>verified.</em>
                  </h1>
                  <p>
                    <strong>{state.email}</strong> is now confirmed for your Folio workspace. Password recovery and account security protections are active.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                    <Link className="lp-button is-primary" href="/overview">
                      <CircleCheck size={16} />
                      Open my workspace
                      <ArrowRight size={15} />
                    </Link>
                    <Link className="lp-button is-outline" href="/settings">
                      <MailCheck size={16} />
                      Review account settings
                    </Link>
                  </div>
                </>
              )}

              {(state.kind === "expired" || state.kind === "invalid") && (
                <>
                  <h1>
                    {state.kind === "expired" ? (
                      <>
                        This link has <em>expired.</em>
                      </>
                    ) : (
                      <>
                        Link couldn’t be <em>verified.</em>
                      </>
                    )}
                  </h1>
                  <div className="auth-inline-error" role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                    <CircleAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{state.message}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                    <Link className="lp-button is-primary" href="/settings">
                      Go to account settings
                      <ArrowRight size={15} />
                    </Link>
                    <Link className="lp-button is-outline" href="/login">
                      Sign in to Folio
                    </Link>
                  </div>
                </>
              )}
            </>
          )}

          <div className="auth-privacy-note" style={{ marginTop: 26 }}>
            <ShieldCheck size={14} />
            <span>Verification links are single-use and expire automatically after 24 hours.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
