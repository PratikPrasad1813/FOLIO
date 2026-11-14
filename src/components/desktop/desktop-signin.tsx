"use client";

/**
 * Dedicated Desktop Sign-In & Registration Screen.
 *
 * Designed exclusively for the Folio Desktop application:
 *   - Completely independent from web authentication.
 *   - 100% self-contained in the desktop shell: NO redirects to Chrome,
 *     NO opening browser tabs, and NO web session cookies.
 *   - Supports both Sign In (existing password accounts) and Create Account
 *     (desktop registration with name, email, password).
 *   - Communicates directly via CORS-authenticated Bearer tokens persisted
 *     in local SQLite (local_auth table).
 *   - Transparent server connection & offline resilience.
 */

import { useEffect, useState, type FormEvent } from "react";
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
import { Logo } from "@/components/ui";
import {
  desktopSignInWithPassword,
  desktopSignUpWithPassword,
  isNetworkError,
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

  const emailValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;
  const passwordValid = password.length >= 8 && password.length <= 128;
  const nameValid = mode !== "register" || name.trim().length > 0;
  const [submittedOnce, setSubmittedOnce] = useState(false);

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
              <Logo compact />
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
              disabled={busy}
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
  width: 46px;
  height: 46px;
  min-width: 46px;
  border-radius: 12px;
  background: linear-gradient(135deg, #7c6cf0 0%, #4a77d4 100%);
  box-shadow: 0 8px 20px -6px rgba(124, 108, 240, 0.5);
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
