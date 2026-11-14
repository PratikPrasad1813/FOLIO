"use client";

/**
 * Dedicated Desktop Sign-In & Registration Screen.
 *
 * Designed exclusively for the Folio Desktop application:
 *   - Completely independent from web authentication. No web session
 *     cookies are ever created or read by this screen.
 *   - Email + password sign-in / registration happens 100% inside the
 *     desktop shell against the deployed API (CORS + Bearer tokens
 *     persisted in the local SQLite `local_auth` table).
 *   - Google and GitHub sign-in complete inside the SYSTEM BROWSER (the
 *     provider's own page must not be embedded), then hand the session
 *     back through the one-time handoff exchange — either via the
 *     `folio://auth?code=` deep link or by polling `/api/auth/desktop/poll`
 *     (both paths converge in `desktopExchangeHandoffCode`).
 *   - Transparent server connection & offline resilience.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  Monitor,
  Server,
  ShieldCheck,
  Sparkles,
  User,
  WifiOff,
} from "lucide-react";
import {
  desktopSignInWithPassword,
  desktopSignUpWithPassword,
  desktopExchangeHandoffCode,
  desktopPollOAuth,
  isNetworkError,
  openDesktopOAuth,
} from "@/lib/desktop/auth-store";
import {
  desktopApiBase,
  setDesktopApiBase,
} from "@/lib/desktop/api-base";

export interface DesktopSignInProps {
  reason?: "fresh" | "signed-out" | "expired";
  cachedEmail?: string;
  initialMode?: "login" | "register";
}

/** Provider glyphs rendered locally so the desktop bundle never pulls in the web marketing components. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M47 24.5c0-1.5-.2-3.1-.4-4.5H24v9h12.9c-.5 3-2.2 5.5-4.7 7.2l7.7 6C44.4 38 47 32.2 47 24.5Z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.6 14.6 0 0 1 9.8 24c0-1.6.2-3.1.7-4.6l-8-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.2Z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48Z" />
    </svg>
  );
}

function GithubMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .6C5.7.6.6 5.7.6 12c0 5 3.3 9.3 7.8 10.8.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.6 1.3 3.3 1 .1-.8.4-1.3.7-1.6-2.5-.3-5.2-1.3-5.2-5.7 0-1.2.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3 0 0 1-.3 3.1 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.1-1.2 3.1-1.2.6 1.5.2 2.7.1 3 .8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.2 5.7.4.4.8 1 .8 2.1v3.1c0 .3.2.6.8.5A11.4 11.4 0 0 0 23.4 12C23.4 5.7 18.3.6 12 .6Z" />
    </svg>
  );
}

/** 48-hex flow id — matches /api/auth/desktop/poll's `^[a-zA-Z0-9_-]{16,64}$`. */
function newOAuthFlowId(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `flow${Math.random().toString(16).slice(2).padEnd(16, "0")}${Date.now().toString(16)}`;
}

const OAUTH_POLL_INTERVAL_MS = 2_000;
const OAUTH_POLL_TIMEOUT_MS = 10 * 60_000;

export function DesktopSignIn({
  reason = "fresh",
  cachedEmail = "",
  initialMode = "login",
}: DesktopSignInProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(cachedEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [customServer, setCustomServer] = useState(desktopApiBase() || "");
  const [serverSavedNotice, setServerSavedNotice] = useState("");
  // "google" | "github" while the corresponding browser flow is in flight.
  const [oauthBusy, setOauthBusy] = useState<"google" | "github" | null>(null);
  const oauthCancelled = useRef(false);
  const [submittedOnce, setSubmittedOnce] = useState(false);

  const emailValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;
  const passwordValid = password.length >= 8 && password.length <= 128;
  const nameValid = mode !== "register" || name.trim().length > 0;

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Stop any in-flight OAuth poll when the screen unmounts (the session
  // gate swaps to the workspace the moment sign-in succeeds).
  useEffect(() => {
    oauthCancelled.current = false;
    return () => {
      oauthCancelled.current = true;
    };
  }, []);

  // The deep-link bridge may complete a browser sign-in started here
  // (folio://auth?code=…); surface its failures instead of leaving the
  // buttons silently stuck in their busy state.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) {
        setError(detail.message);
        setOauthBusy(null);
        setNotice("");
      }
    };
    window.addEventListener("folio:desktop-handoff-error", handler);
    return () => window.removeEventListener("folio:desktop-handoff-error", handler);
  }, []);

  async function handleOAuth(provider: "google" | "github") {
    if (busy || oauthBusy) return;
    setError("");
    setNotice("");
    setOauthBusy(provider);
    const flowId = newOAuthFlowId();

    try {
      await openDesktopOAuth(provider, flowId);
    } catch (openError) {
      console.error("Could not open the browser for OAuth.", openError);
      setError(`Could not open your browser for ${provider === "google" ? "Google" : "GitHub"} sign-in. Please continue with email instead.`);
      setOauthBusy(null);
      return;
    }

    setNotice(
      `Finish signing in with ${provider === "google" ? "Google" : "GitHub"} in your browser — Folio picks it up automatically. Only this desktop app will be signed in.`,
    );

    const deadline = Date.now() + OAUTH_POLL_TIMEOUT_MS;
    while (!oauthCancelled.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, OAUTH_POLL_INTERVAL_MS));
      if (oauthCancelled.current) return;
      const code = await desktopPollOAuth(flowId);
      if (!code) continue;
      try {
        // Persists the session + emits folio:desktop-session; the gate
        // immediately mounts the workspace (or first-run onboarding).
        await desktopExchangeHandoffCode(code);
      } catch (exchangeError) {
        if (oauthCancelled.current) return;
        if (isNetworkError(exchangeError)) {
          setError("Network connection unavailable while completing sign-in. Please try again.");
        } else {
          setError(exchangeError instanceof Error ? exchangeError.message : "Could not complete the sign-in.");
        }
      }
      if (!oauthCancelled.current) setOauthBusy(null);
      return;
    }

    if (!oauthCancelled.current) {
      setOauthBusy(null);
      setNotice("");
      setError("The browser sign-in didn’t finish in time. Please try again or use email sign-in.");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmittedOnce(true);
    setError("");
    setNotice("");

    if (!emailValid || !passwordValid || !nameValid || busy) {
      if (!nameValid) setError("Please enter your name.");
      else if (!emailValid) setError("Please enter a valid email address.");
      else if (!passwordValid) setError("Password must be between 8 and 128 characters.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "login") {
        await desktopSignInWithPassword(email.trim(), password);
      } else {
        await desktopSignUpWithPassword(name.trim(), email.trim(), password);
      }
      // On success, auth-store emits `folio:desktop-session` and DesktopSessionGate
      // immediately mounts the workspace.
    } catch (err) {
      if (isNetworkError(err)) {
        setIsOffline(true);
        setError("Network connection unavailable. First-time sign-in requires internet to verify credentials.");
      } else {
        setError(err instanceof Error ? err.message : "Authentication request could not be completed.");
      }
      setBusy(false);
    }
  }

  function handleSaveServer(e: FormEvent) {
    e.preventDefault();
    const ok = setDesktopApiBase(customServer);
    if (ok) {
      setServerSavedNotice("Server address updated.");
      setTimeout(() => setServerSavedNotice(""), 3000);
    } else {
      setError("Please enter a valid URL (e.g. http://localhost:3000 or https://folio-management-studio.onrender.com)");
    }
  }

  return (
    <div className="folio-desktop-auth-container">
      <style>{desktopAuthStyles}</style>

      <div className="folio-desktop-auth-shell">
        {/* Top Header Badge */}
        <div className="desktop-header-meta">
          <div className="desktop-app-pill">
            <Monitor size={14} className="desktop-icon" />
            <span className="desktop-title-text">FOLIO DESKTOP WORKSPACE</span>
            <span className="desktop-version-tag">v1.0</span>
          </div>
          <div className="desktop-isolation-pill">
            <ShieldCheck size={13} />
            <span>Device-Isolated Session</span>
          </div>
        </div>

        {/* Auth Card */}
        <div className="folio-desktop-card">
          <div className="card-brand-header">
            <div className="desktop-logo-wrapper">
              {/* The REAL app icon (same asset Tauri bundles for the window/taskbar), not the inline marketing glyph. */}
              <img src="/folio-icon.png" alt="Folio" width={56} height={56} className="desktop-app-icon" draggable={false} />
            </div>
            <div className="card-headings">
              <h2>
                {reason === "expired"
                  ? "Sign-In Expired"
                  : mode === "login"
                  ? "Welcome Back"
                  : "Create Desktop Account"}
              </h2>
              <p>
                {reason === "expired"
                  ? "Your server token expired. Re-authenticate to resume silent background sync."
                  : mode === "login"
                  ? "Sign in to access your offline-ready desktop workspace."
                  : "Set up your private workspace directly on this computer."}
              </p>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="desktop-auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={`auth-tab ${mode === "login" ? "active" : ""}`}
              onClick={() => {
                setMode("login");
                setError("");
                setNotice("");
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={`auth-tab ${mode === "register" ? "active" : ""}`}
              onClick={() => {
                setMode("register");
                setError("");
                setNotice("");
              }}
            >
              Create Account
            </button>
          </div>

          {/* Status & Error Notices */}
          {notice && <div className="auth-alert is-notice">{notice}</div>}
          {error && <div className="auth-alert is-error">{error}</div>}
          {isOffline && (
            <div className="auth-alert is-warning">
              <WifiOff size={15} />
              <span>
                You are currently offline. Initial sign-in requires an internet
                connection. Once signed in, Folio works 100% offline.
              </span>
            </div>
          )}

          {/* Provider sign-in (Google / GitHub) — completes in the system browser, then hands the session back here. */}
          <div className="desktop-oauth-buttons">
            <button
              type="button"
              className="oauth-button"
              disabled={busy || oauthBusy !== null}
              onClick={() => void handleOAuth("google")}
            >
              {oauthBusy === "google" ? <Loader2 size={17} className="spin" /> : <GoogleMark />}
              <span>Continue with Google</span>
              <ArrowRight size={15} className="oauth-arrow" />
            </button>
            <button
              type="button"
              className="oauth-button"
              disabled={busy || oauthBusy !== null}
              onClick={() => void handleOAuth("github")}
            >
              {oauthBusy === "github" ? <Loader2 size={17} className="spin" /> : <GithubMark />}
              <span>Continue with GitHub</span>
              <ArrowRight size={15} className="oauth-arrow" />
            </button>
          </div>
          <div className="oauth-separator" role="separator"><span /><b>or continue with email</b><span /></div>

          {/* Form */}
          <form className="desktop-auth-form" onSubmit={handleSubmit} noValidate>
            {mode === "register" && (
              <div className="input-group">
                <label htmlFor="desktop-name">Your Full Name</label>
                <div className="input-field-wrapper">
                  <User size={16} className="input-icon" />
                  <input
                    id="desktop-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    maxLength={80}
                    placeholder="e.g. Alex Morgan"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={submittedOnce && !nameValid}
                  />
                </div>
              </div>
            )}

            <div className="input-group">
              <label htmlFor="desktop-email">Email Address</label>
              <div className="input-field-wrapper">
                <Mail size={16} className="input-icon" />
                <input
                  id="desktop-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder="alex@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={submittedOnce && !emailValid}
                />
              </div>
            </div>

            <div className="input-group">
              <div className="label-with-hint">
                <label htmlFor="desktop-password">Password</label>
                <span className="input-hint">At least 8 characters</span>
              </div>
              <div className="input-field-wrapper">
                <LockKeyhole size={16} className="input-icon" />
                <input
                  id="desktop-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required
                  minLength={8}
                  maxLength={128}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={submittedOnce && !passwordValid}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              className="desktop-submit-button"
              type="submit"
              disabled={busy || oauthBusy !== null}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>
                    {mode === "login" ? "Signing In to Desktop..." : "Creating Account..."}
                  </span>
                </>
              ) : (
                <>
                  {mode === "login" ? (
                    <>
                      <span>Sign In to Desktop</span>
                      <ArrowRight size={16} />
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>Create Desktop Workspace</span>
                    </>
                  )}
                </>
              )}
            </button>
          </form>

          {/* Explanatory callouts */}
          <div className="desktop-perks-box">
            <div className="perk-item">
              <CheckCircle2 size={14} className="perk-icon" />
              <span>
                <strong>Desktop-Only:</strong> You will only be logged in this desktop application. Your web browser sessions are untouched.
              </span>
            </div>
            <div className="perk-item">
              <CheckCircle2 size={14} className="perk-icon" />
              <span>
                <strong>Local SQLite Mirror:</strong> Workspace data is stored locally on this computer for instant 0ms access offline.
              </span>
            </div>
          </div>

          {/* Footer & Server Configuration */}
          <div className="desktop-footer-controls">
            <button
              type="button"
              className="server-settings-toggle"
              onClick={() => setShowServerConfig(!showServerConfig)}
            >
              <Server size={13} />
              <span>Sync Server: {desktopApiBase() || "Local"}</span>
            </button>

            {showServerConfig && (
              <form className="server-config-form" onSubmit={handleSaveServer}>
                <label htmlFor="custom-server-input">Backend Server URL:</label>
                <div className="server-input-row">
                  <input
                    id="custom-server-input"
                    type="url"
                    value={customServer}
                    onChange={(e) => setCustomServer(e.target.value)}
                    placeholder="https://folio-management-studio.onrender.com"
                  />
                  <button type="submit">Save</button>
                </div>
                {serverSavedNotice && (
                  <span className="server-saved-msg">{serverSavedNotice}</span>
                )}
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const desktopAuthStyles = `
.folio-desktop-auth-container {
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  background: radial-gradient(circle at 50% 20%, #161822 0%, #0c0d12 100%);
  color: #eceff4;
  font-family: var(--font-ui, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  box-sizing: border-box;
}

.folio-desktop-auth-shell {
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.desktop-header-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.desktop-app-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: #a0a6b8;
}

.desktop-icon {
  color: #7c6cf0;
}

.desktop-version-tag {
  background: #7c6cf0;
  color: #fff;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 9.5px;
  font-weight: 700;
}

.desktop-isolation-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #34d399;
  font-weight: 500;
}

.folio-desktop-card {
  background: #14161f;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 20px;
  padding: 30px 28px;
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(124, 108, 240, 0.08);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card-brand-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.desktop-logo-wrapper {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  min-width: 56px;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 10px 24px -8px rgba(90, 78, 205, 0.45);
}

.desktop-app-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: block;
}

.card-headings h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #fff;
}

.card-headings p {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: #9297a5;
}

.desktop-auth-tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 3px;
  gap: 4px;
}

.desktop-oauth-buttons {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.oauth-button {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #0d0e14;
  color: #e6e9f2;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.oauth-button:hover:not(:disabled) {
  border-color: rgba(124, 108, 240, 0.55);
  background: #12141c;
}

.oauth-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.oauth-arrow {
  color: #6c7385;
}

.oauth-separator {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #6c7385;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.oauth-separator span {
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
}

.oauth-separator b {
  font-weight: 600;
}

.auth-tab {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #8c92a4;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.auth-tab.active {
  background: #7c6cf0;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(124, 108, 240, 0.35);
}

.auth-alert {
  padding: 10px 14px;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 8px;
}

.auth-alert.is-error {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.auth-alert.is-warning {
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #fcd34d;
}

.auth-alert.is-notice {
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #93c5fd;
}

.desktop-auth-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-group label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: #a4abbd;
  text-transform: uppercase;
}

.label-with-hint {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.input-hint {
  font-size: 11px;
  color: #6c7385;
}

.input-field-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 14px;
  color: #6c7385;
  pointer-events: none;
}

.input-field-wrapper input {
  width: 100%;
  min-height: 44px;
  padding: 0 14px 0 40px;
  background: #0d0e14;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9px;
  color: #f1f3f7;
  font-size: 13.5px;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}

.input-field-wrapper input:focus-visible {
  outline: none;
  border-color: #7c6cf0;
  box-shadow: 0 0 0 3px rgba(124, 108, 240, 0.2);
}

.input-field-wrapper input[aria-invalid="true"] {
  border-color: #ef4444;
}

.password-toggle-btn {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: #6c7385;
  padding: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

.password-toggle-btn:hover {
  color: #eceff4;
}

.desktop-submit-button {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #7c6cf0;
  color: #fff;
  border: none;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(124, 108, 240, 0.4);
  transition: transform 0.15s, background 0.15s;
  margin-top: 4px;
}

.desktop-submit-button:hover:not(:disabled) {
  background: #6e5de6;
  transform: translateY(-1px);
}

.desktop-submit-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.desktop-perks-box {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.perk-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.5;
  color: #8c92a4;
}

.perk-item strong {
  color: #c9cedc;
}

.perk-icon {
  color: #34d399;
  min-width: 14px;
  margin-top: 2px;
}

.desktop-footer-controls {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.server-settings-toggle {
  background: transparent;
  border: none;
  color: #6c7385;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}

.server-settings-toggle:hover {
  color: #a0a6b8;
}

.server-config-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #0d0e14;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.server-config-form label {
  font-size: 10.5px;
  color: #8c92a4;
  text-transform: uppercase;
  font-weight: 600;
}

.server-input-row {
  display: flex;
  gap: 8px;
}

.server-input-row input {
  flex: 1;
  background: #14161f;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #fff;
  padding: 6px 10px;
  font-size: 12px;
}

.server-input-row button {
  background: #7c6cf0;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.server-saved-msg {
  font-size: 11px;
  color: #34d399;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;
