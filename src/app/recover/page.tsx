"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { Logo, Spinner } from "@/components/ui";
import { EMAIL_FEATURES_ENABLED, EMAIL_FEATURES_NOTICE } from "@/lib/feature-flags";

export default function RecoverPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // While email features are paused, recovery links are not read or consumed here.
    if (!EMAIL_FEATURES_ENABLED) return;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (value) {
      setToken(value);
      window.history.replaceState(null, "", "/recover");
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(token ? { action: "reset", token, password } : { action: "request", email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Please try again.");
      setMessage(token ? "Your password has been updated. Please sign in with your new password." : result.message);
      if (token) setToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-site auth-experience">
      <section className="auth-editorial">
        <Link href="/" aria-label="Folio home">
          <Logo />
        </Link>
        <div className="auth-editorial-copy">
          <span className="lp-eyebrow">A LITTLE CLARITY. A LOT OF POSSIBILITY.</span>
          <h2>
            Let’s get you<br />
            <em>back in.</em>
          </h2>
          <p>Your workspace is still right where you left it.</p>
        </div>
        <small>Thoughtfully organized. Always yours.</small>
      </section>

      <section className="auth-form-side">
        <div className="auth-top-line">
          <Link className="auth-back" href="/login">
            <ArrowLeft size={15} />
            Back to sign in
          </Link>
        </div>

        <div className="auth-new-card">
          <span className="auth-small-mark">
            <Logo compact />
          </span>
          <span className="lp-eyebrow">YOUR WORKSPACE IS WAITING</span>

          {!EMAIL_FEATURES_ENABLED ? (
            <>
              <h1>
                Recovery is <em>temporarily unavailable.</em>
              </h1>
              <p>Your sign-in still works. If you use Google or GitHub, continue with that provider from the sign-in page.</p>
              <div className="folio-notice" role="note">
                <Sparkles size={14} />
                <span>{EMAIL_FEATURES_NOTICE}</span>
              </div>
              <p className="auth-alternate">
                <Link href="/login">
                  Return to sign in <ArrowRight size={12} />
                </Link>
              </p>
            </>
          ) : (
            <>
              <h1>
                {token ? (
                  <>
                    Choose a new <em>password.</em>
                  </>
                ) : (
                  <>
                    Recover your <em>account.</em>
                  </>
                )}
              </h1>
              <p>{token ? "Make it something only you know." : "We’ll send a secure, one-time link to your account email."}</p>

              {!message && (
                <form className="auth-email-form" onSubmit={submit}>
                  {token ? (
                    <label>
                      New password
                      <input
                        aria-label="New password"
                        type="password"
                        required
                        minLength={8}
                        maxLength={128}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                      />
                    </label>
                  ) : (
                    <label>
                      Email address
                      <input
                        aria-label="Email address"
                        type="email"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </label>
                  )}
                  <button className="lp-button is-primary" disabled={busy}>
                    {busy ? <Spinner size={16} /> : <LockKeyhole size={16} />} {token ? "Update password" : "Send recovery link"}
                    <ArrowRight size={15} />
                  </button>
                </form>
              )}

              {message && (
                <div className="auth-inline-error" role="status">
                  {message}
                </div>
              )}
              {error && (
                <div className="auth-inline-error" role="alert">
                  {error}
                </div>
              )}

              <p className="auth-alternate">
                <Link href="/login">
                  Return to sign in <ArrowRight size={12} />
                </Link>
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
