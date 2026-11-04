"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Eye, EyeOff, FolderKanban, Lightbulb, LockKeyhole, ShieldCheck, Sparkles, X } from "lucide-react";
import { Logo } from "@/components/ui";

type Mode = "signin" | "register";
interface Props { providers: { google: boolean; github: boolean }; initialError?: string; notice?: string }

function GoogleMark() {
  return <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"/><path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.14.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}

export default function AuthLanding({ providers, initialError = "", notice = "" }: Props) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [providerNotice, setProviderNotice] = useState(notice);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  function chooseMode(next: Mode) { setMode(next); setError(""); setProviderNotice(""); }

  function startProvider(provider: "google" | "github") {
    const configured = providers[provider];
    setPendingProvider(provider);
    if (configured) { window.location.href = `/api/auth/oauth/${provider}`; return; }
    window.setTimeout(() => {
      setPendingProvider(null);
      setProviderNotice(`${provider === "google" ? "Google" : "GitHub"} sign-in needs this deployment to be connected first. Add ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET to your environment, then use the button again. Email sign-in is ready right now.`);
    }, 260);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setProviderNotice("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: mode === "register" ? "register" : "login", name, email, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn’t complete that request.");
      window.location.href = "/overview";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return <div className="auth-page">
    <section className="auth-story" aria-label="About folio">
      <div className="auth-story-inner">
        <div className="auth-story-top"><Logo/><span className="auth-story-badge">PERSONAL WORKSPACE</span></div>
        <div className="auth-story-copy">
          <span className="eyebrow">A LITTLE CLARITY. A LOT OF POSSIBILITY.</span>
          <h1>Big ideas meet<br/>everyday progress.</h1>
          <p>folio is a quiet home for your projects, your to-dos, and all the “what ifs” still waiting to become something. Bring the big picture and the small next step into one place.</p>
          <ul className="auth-points">
            <li><FolderKanban size={17}/><span><strong>Projects with a pulse</strong>Deadlines, progress, and the little wins in between.</span></li>
            <li><SquareCheckIcon/><span><strong>A list that feels doable</strong>Priorities and due dates without the noise.</span></li>
            <li><Lightbulb size={17}/><span><strong>Room for what if</strong>Capture ideas now. Turn them into projects later.</span></li>
          </ul>
        </div>
        <div className="auth-preview" aria-hidden="true">
          <div className="auth-preview-card preview-main">
            <div className="preview-card-top"><span className="preview-icon">▣</span><span className="preview-dots">•••</span></div>
            <strong>Website redesign</strong>
            <p>A fresh look for our digital home.</p>
            <div className="preview-tags"><span className="preview-pill">In progress</span><span className="preview-pill light">Design</span></div>
            <div className="preview-progress"><span style={{ width: "64%" }}/></div>
            <div className="preview-meta"><span>8 of 12 tasks</span><span>64%</span></div>
          </div>
          <div className="auth-preview-card preview-note">
            <span className="preview-note-spark">✳</span>
            <strong>Make space for the good stuff.</strong>
            <p>One small step, then another.</p>
          </div>
          <div className="auth-preview-card preview-task"><span className="preview-check"><Check size={11}/></span><span>Review navigation structure</span></div>
        </div>
        <p className="auth-story-foot"><Sparkles size={14}/>Your workspace is private, and yours alone.</p>
      </div>
    </section>

    <section className="auth-panel">
      <div className="auth-panel-inner">
        <div className="auth-mobile-brand"><Logo/></div>
        <div className="auth-card">
          <div className="auth-card-head">
            <span className="auth-card-kicker">{mode === "register" ? "START SOMETHING GOOD" : "GOOD TO SEE YOU AGAIN"}</span>
            <h2>{mode === "register" ? "Make a little room for your ideas." : "Welcome back."}</h2>
            <p>{mode === "register" ? "Create your free workspace. It takes less than a minute." : "Sign in to pick up right where you left off."}</p>
          </div>

          <div className="auth-providers">
            <button type="button" className="provider-button" onClick={() => startProvider("google")} disabled={busy || pendingProvider !== null} aria-label="Continue with Google">
              {pendingProvider === "google" ? <span className="provider-loading"/> : <GoogleMark/>}<span>Continue with Google</span>
            </button>
            <button type="button" className="provider-button" onClick={() => startProvider("github")} disabled={busy || pendingProvider !== null} aria-label="Continue with GitHub">
              {pendingProvider === "github" ? <span className="provider-loading"/> : <GithubMark/>}<span>Continue with GitHub</span>
            </button>
          </div>

          {providerNotice && <div className="auth-notice" role="status"><ShieldCheck size={16}/><p>{providerNotice}</p><button type="button" onClick={() => setProviderNotice("")} aria-label="Dismiss provider notice"><X size={14}/></button></div>}

          <div className="auth-divider"><span>or continue with email</span></div>

          <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
            <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "active" : ""} onClick={() => chooseMode("signin")}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => chooseMode("register")}>Create account</button>
          </div>

          <form onSubmit={submit} className="auth-form" noValidate>
            {mode === "register" && <label className="auth-field"><span>Your name</span><input aria-label="Your name" autoComplete="name" placeholder="e.g. Jordan Lee" value={name} onChange={event => setName(event.target.value)} maxLength={80} required/></label>}
            <label className="auth-field"><span>Email address</span><input aria-label="Email address" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required/></label>
            <label className="auth-field"><span>Password</span><div className="auth-password"><input aria-label="Password" type={showPassword ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder={mode === "register" ? "At least 8 characters" : "Your password"} value={password} onChange={event => setPassword(event.target.value)} minLength={8} maxLength={128} required/><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>{mode === "register" && <em className="auth-hint">Use 8 or more characters. A phrase you’ll remember works well.</em>}</label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button type="submit" className="auth-submit" disabled={busy}>{busy ? <span className="auth-spinner"/> : null}{busy ? "One moment…" : mode === "register" ? "Create my workspace" : "Sign in to folio"}{!busy && <ArrowRight size={16}/>}</button>
          </form>

          <p className="auth-switch">{mode === "register" ? "Already have a workspace?" : "New to folio?"} <button type="button" onClick={() => chooseMode(mode === "register" ? "signin" : "register")}>{mode === "register" ? "Sign in" : "Create an account"}</button></p>
          <p className="auth-legal"><LockKeyhole size={12}/>Protected by secure, http-only sessions. Your work is never shown to anyone else.</p>
        </div>
        <footer className="auth-panel-foot"><span>© {new Date().getFullYear()} folio</span><span><button type="button" onClick={() => setProviderNotice("folio keeps your projects, tasks, and ideas in your own private workspace. We don’t sell your data. Everything here is created by you, and only you can see it.")}>Privacy</button><button type="button" onClick={() => setProviderNotice("Create a free account to use folio. Start with a project, break it into small tasks, and capture ideas as they come. Everything saves automatically.")}>How it works</button><button type="button" onClick={() => setProviderNotice("Need a hand? Sign in with email and password first. Google and GitHub sign-in activate once this deployment has OAuth credentials configured.")}>Support</button></span></footer>
      </div>
    </section>
  </div>;
}

function GithubMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.55v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.19a11 11 0 0 1 5.8 0c2.2-1.5 3.17-1.19 3.17-1.19.63 1.59.23 2.77.12 3.06.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z"/></svg>;
}

function SquareCheckIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8.3 12.2 2.4 2.4 5-5.2"/></svg>;
}
