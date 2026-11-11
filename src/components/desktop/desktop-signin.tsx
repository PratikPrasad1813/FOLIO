"use client";

/**
 * The desktop sign-in screen (the ONLY sign-in surface of the static
 * desktop shell — /login is a web page and is pruned from the bundle).
 *
 * Two transports, both against the deployed API (absolute URL):
 *   1. Email + password  → POST /api/auth/desktop/login  → user + 90-day
 *      Bearer token persisted in local_auth.
 *   2. "Continue in your browser" → opens `<api>/login?next=/desktop-auth`
 *      in the system browser (Google/GitHub OAuth included); that page
 *      mints a one-time handoff code and deep-links back
 *      `folio://auth?code=…`, which the deep-link listener exchanges.
 *
 * Offline behaviour: with no cached session the form still renders; the
 * submit fails with a friendly "You're offline" notice (never a crash,
 * never an unhandled rejection).
 */

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail, WifiOff } from "lucide-react";
import { Logo } from "@/components/ui";
import "@/app/auth.css";
import {
  desktopSignInWithPassword,
  isNetworkError,
  openDesktopBrowserSignIn,
} from "@/lib/desktop/auth-store";

export interface DesktopSignInProps {
  reason: "fresh" | "signed-out" | "expired";
  cachedEmail?: string;
}

/** Surface a failed browser-handoff exchange (deep-link listener emits it). */
interface HandoffErrorDetail {
  message: string;
}

const REASON_COPY: Record<DesktopSignInProps["reason"], { eyebrow: string; title: React.ReactNode; lead: string }> = {
  fresh: {
    eyebrow: "FOLIO DESKTOP",
    title: <>A little clarity.<br /><em>Right on your desktop.</em></>,
    lead: "Sign in once — your workspace then lives on this machine and keeps working with or without internet.",
  },
  "signed-out": {
    eyebrow: "SEE YOU SOON",
    title: <>Welcome <em>back.</em></>,
    lead: "Sign in again to pick up exactly where you left off. Everything synced from your last session is still here.",
  },
  expired: {
    eyebrow: "SIGN-IN EXPIRED",
    title: <>One small step <em>again.</em></>,
    lead: "Your saved sign-in expired on the server. Your workspace is safe on this machine — sign in to resume syncing.",
  },
};

export function DesktopSignIn({ reason, cachedEmail }: DesktopSignInProps) {
  const copy = REASON_COPY[reason];
  const [email, setEmail] = useState(cachedEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"email" | "browser" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;
  const passwordValid = password.length >= 8 && password.length <= 128;
  const submittedOnce = busy === null && (error !== "" || notice !== "");

  // A browser-handoff sign-in that failed server-side (expired/used code) is
  // surfaced here by the deep-link listener. Network failures stay silent.
  useEffect(() => {
    const onHandoffError = (event: Event) => {
      const detail = (event as CustomEvent<HandoffErrorDetail>).detail;
      if (detail?.message) {
        setError(detail.message);
        setNotice("");
      }
    };
    window.addEventListener("folio:desktop-handoff-error", onHandoffError);
    return () => window.removeEventListener("folio:desktop-handoff-error", onHandoffError);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!emailValid || !passwordValid || busy) {
      if (!emailValid || !passwordValid) setError("Enter a valid email and a password of at least 8 characters.");
      return;
    }
    setBusy("email");
    try {
      await desktopSignInWithPassword(email.trim(), password);
      // The auth-store emits `folio:desktop-session`; the gate swaps to the
      // workspace on its own. No navigation, no reload.
    } catch (err) {
      if (isNetworkError(err)) {
        setOffline(true);
        setError("You're offline. Sign-in needs internet the first time — connect and try again.");
      } else {
        setError(err instanceof Error ? err.message : "We couldn’t complete that request.");
      }
      setBusy(null);
    }
  }

  async function browserSignIn() {
    setError("");
    setNotice("");
    setBusy("browser");
    try {
      await openDesktopBrowserSignIn();
      setNotice("Continue in your browser — Folio will sign in automatically when you're done.");
    } catch {
      setError("Could not open your browser. Please try again, or use your email above.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="public-site desktop-signin-screen">
      <style>{desktopSigninCss}</style>
      <section className="desktop-signin-card">
        <span className="desktop-signin-mark"><Logo compact /></span>
        <span className="lp-eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p className="desktop-signin-lead">{copy.lead}</p>

        {notice && <div className="auth-notice" role="status">{notice}</div>}
        {error && <div className="auth-inline-error" role="alert">{error}</div>}

        <form className="desktop-signin-form" onSubmit={submit} noValidate>
          <label>
            Email address
            <input
              aria-label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={submittedOnce && !emailValid}
            />
          </label>
          <label>
            Password
            <span className="desktop-signin-password">
              <input
                aria-label="Password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                minLength={8}
                maxLength={128}
                placeholder="Your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={submittedOnce && !passwordValid}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
          <button className="lp-button is-primary" type="submit" disabled={busy !== null}>
            {busy === "email" ? <Loader2 size={16} className="spin" /> : <Mail size={16} />}
            Sign in to Folio
          </button>
        </form>

        <div className="auth-separator"><span /><button type="button" onClick={() => void browserSignIn()} disabled={busy !== null}>or continue in your browser</button><span /></div>
        <button type="button" className="lp-button is-outline desktop-signin-browser" onClick={() => void browserSignIn()} disabled={busy !== null}>
          {busy === "browser" ? <Loader2 size={16} className="spin" /> : <ArrowRight size={15} />}
          Continue with Google, GitHub and more
        </button>

        {offline && (
          <p className="desktop-signin-offline" role="status">
            <WifiOff size={14} /> You're offline — Folio is fully usable once signed in; this screen only needs internet the first time.
          </p>
        )}

        <div className="desktop-signin-note">
          <LockKeyhole size={14} />
          <span>Secure sign-in. Your workspace stays on this device and syncs privately.</span>
        </div>
      </section>
    </div>
  );
}

const desktopSigninCss = `
.desktop-signin-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 20px;
  background:var(--lp-bg,#f6f5f4)}
[data-theme="dark"] .desktop-signin-screen{background:var(--lp-bg,#08090a)}
.desktop-signin-card{width:100%;max-width:400px;display:flex;flex-direction:column;gap:14px;padding:34px 30px;
  border:1px solid var(--lp-line,#e7e2da);border-radius:18px;background:var(--lp-surface,#fff);
  box-shadow:0 24px 70px -30px #25211a2e}
[data-theme="dark"] .desktop-signin-card{background:#101114;border-color:#23242a;box-shadow:0 24px 70px -30px #000}
.desktop-signin-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;
  background:linear-gradient(135deg,#7c6cf0,#5a8bd4)}
.desktop-signin-card h1{margin:2px 0 0;font-size:26px;line-height:1.25;letter-spacing:-.02em}
.desktop-signin-card h1 em{font-style:italic}
.desktop-signin-lead{margin:0;font-size:12.5px;line-height:1.7;color:var(--lp-muted,#6b675f)}
.desktop-signin-form{display:flex;flex-direction:column;gap:13px;margin-top:4px}
.desktop-signin-form label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;color:var(--lp-muted,#6b675f)}
.desktop-signin-form input{min-height:44px;padding:0 14px;border-radius:8px;font-size:13.5px;
  border:1px solid var(--lp-line,#e7e2da);background:var(--lp-bg,#faf9f7);color:var(--lp-text,#26241f)}
[data-theme="dark"] .desktop-signin-form input{background:#0b0c0f;border-color:#2a2b31;color:#eceae6}
.desktop-signin-form input:focus-visible{outline:2px solid #7c6cf0;outline-offset:1px}
.desktop-signin-form input[aria-invalid="true"]{border-color:#d06a5a}
.desktop-signin-password{position:relative;display:block}
.desktop-signin-password input{width:100%;padding-right:42px}
.desktop-signin-password button{position:absolute;top:0;right:0;width:42px;height:44px;display:grid;place-items:center;
  background:none;border:none;cursor:pointer;color:var(--lp-muted,#6b675f)}
.desktop-signin-screen .auth-separator{display:flex;align-items:center;gap:12px;margin:6px 0 2px}
.desktop-signin-screen .auth-separator span{flex:1;height:1px;background:var(--lp-line,#e7e2da)}
.desktop-signin-screen .auth-separator button{background:none;border:none;cursor:pointer;font-size:11px;
  color:var(--lp-muted,#6b675f)}
.desktop-signin-browser{width:100%}
.desktop-signin-offline{display:flex;align-items:center;gap:8px;margin:0;font-size:11.5px;line-height:1.6;color:#a2722f}
.desktop-signin-note{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:10.5px;color:var(--lp-muted,#6b675f)}
`;
