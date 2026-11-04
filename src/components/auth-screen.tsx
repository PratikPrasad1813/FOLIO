"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { Logo, Spinner } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProductImage } from "@/components/public-site";
import { EMAIL_FEATURES_ENABLED } from "@/lib/feature-flags";

export function GoogleMark() { return <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5Z"/><path fill="#4285F4" d="M47 24.5c0-1.5-.2-3.1-.4-4.5H24v9h12.9c-.5 3-2.2 5.5-4.7 7.2l7.7 6C44.4 38 47 32.2 47 24.5Z"/><path fill="#FBBC05" d="M10.5 28.6A14.6 14.6 0 0 1 9.8 24c0-1.6.2-3.1.7-4.6l-8-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.2Z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48Z"/></svg>; }
export function GithubMark() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .6C5.7.6.6 5.7.6 12c0 5 3.3 9.3 7.8 10.8.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.6 1.3 3.3 1 .1-.8.4-1.3.7-1.6-2.5-.3-5.2-1.3-5.2-5.7 0-1.2.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3 0 0 1-.3 3.1 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.1-1.2 3.1-1.2.6 1.5.2 2.7.1 3 .8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.2 5.7.4.4.8 1 .8 2.1v3.1c0 .3.2.6.8.5A11.4 11.4 0 0 0 23.4 12C23.4 5.7 18.3.6 12 .6Z"/></svg>; }

interface AuthScreenProps { mode: "login" | "signup"; next: string; error?: string }

export function AuthScreen({ mode, next, error: initialError = "" }: AuthScreenProps) {
  const signup = mode === "signup";
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  // Email + password is offered up front, not hidden behind a toggle.
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;
  const nameValid = !signup || name.trim().length > 0;
  const passwordValid = password.length >= 8 && password.length <= 128;

  async function providerSignIn(provider: "google" | "github") {
    setError(""); setNotice(""); setBusy(provider);
    window.location.assign(`/api/auth/oauth/${provider}?next=${encodeURIComponent(next)}`);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSubmitted(true);
    if (!emailValid || !nameValid || !passwordValid || busy) return;
    setBusy("email"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: signup ? "register" : "login", name: name.trim(), email: email.trim(), password, next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We couldn’t complete that request.");
      window.location.assign(data.destination || next);
    } catch (err) { setError(err instanceof Error ? err.message : "We couldn’t complete that request."); setBusy(null); }
  }

  return <div className="public-site auth-experience"><section className="auth-editorial"><Link href="/" aria-label="Folio home"><Logo/></Link><div className="auth-editorial-copy"><span className="lp-eyebrow"><span/>A LITTLE CLARITY. A LOT OF POSSIBILITY.</span><h2>Less noise.<br/>More room<br/><em>for you.</em></h2><p>A thoughtful home for your projects,<br/>your plans, and your next big idea.</p><div className="auth-editorial-points"><span><Check size={13}/>One unified workspace</span><span><Check size={13}/>A little more peace of mind</span></div></div><div className="auth-real-preview"><div className="auth-preview-caption"><Sparkles size={13}/>A glimpse of what’s possible</div><ProductImage name="dashboard" alt="Real Folio overview with example workspace data"/></div><small>Thoughtfully organized. Always yours.</small></section><section className="auth-form-side"><div className="auth-top-line"><Link href="/" className="auth-back"><ArrowLeft size={15}/>Back to Folio</Link><ThemeToggle/></div><div className="auth-new-card"><span className="auth-small-mark"><Logo compact/></span><span className="lp-eyebrow">{signup ? "YOUR NEXT CHAPTER" : "RIGHT WHERE YOU LEFT OFF"}</span><h1>{signup ? <>A little space.<br/><em>All your possibilities.</em></> : <>Welcome <em>back.</em></>}</h1><p>{signup ? "Create your free Folio account. Let’s make it feel like you." : "Your projects, plans, and ideas are waiting for you."}</p><div className="auth-oauth-buttons"><button type="button" disabled={Boolean(busy)} onClick={() => void providerSignIn("google")}>{busy === "google" ? <Spinner size={17}/> : <GoogleMark/>}Continue with Google<ArrowRight size={15}/></button><button type="button" disabled={Boolean(busy)} onClick={() => void providerSignIn("github")}>{busy === "github" ? <Spinner size={17}/> : <GithubMark/>}Continue with GitHub<ArrowRight size={15}/></button></div>{notice && <div className="auth-inline-error" role="status">{notice}</div>}<div className="auth-separator"><span/><button type="button" aria-expanded aria-controls="auth-email-form">or use your email</button><span/></div><form id="auth-email-form" className="auth-email-form" onSubmit={submit} noValidate>{signup && <label>Your name<input aria-label="Your name" name="name" autoComplete="name" required maxLength={80} placeholder="What should we call you?" value={name} onChange={e => setName(e.target.value)} aria-invalid={submitted && !nameValid}/></label>}<label>Email address<input aria-label="Email address" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} aria-invalid={submitted && !emailValid}/></label><label>Password<div className="auth-password-field"><input aria-label="Password" name="password" type={showPassword ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} required minLength={8} maxLength={128} placeholder={signup ? "At least 8 characters" : "Your password"} value={password} onChange={e => setPassword(e.target.value)} aria-invalid={submitted && !passwordValid}/><button type="button" className="auth-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>{submitted && !passwordValid && <em className="auth-field-hint">Use 8 or more characters.</em>}</label><button className="lp-button is-primary" disabled={Boolean(busy) || (submitted && (!emailValid || !nameValid || !passwordValid))}>{busy === "email" ? <Spinner size={16}/> : <Mail size={16}/>} {signup ? "Create my workspace" : "Sign in to Folio"}</button>{EMAIL_FEATURES_ENABLED && !signup && <Link href="/recover" className="auth-back">Forgot your password?</Link>}</form>{error && <div className="auth-inline-error" role="alert">{error}</div>}<p className="auth-alternate">{signup ? "Already have a little corner here?" : "New to Folio?"} <Link href={`${signup ? "/login" : "/signup"}?next=${encodeURIComponent(next)}`}>{signup ? "Sign in" : "Make yourself at home"}<ArrowRight size={12}/></Link></p><div className="auth-privacy-note"><LockKeyhole size={14}/><span>Secure sign-in. A workspace that’s only yours.</span></div><p className="auth-new-legal">By continuing, you agree to our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p></div><div className="auth-bottom-line"><span>© {new Date().getFullYear()} Folio</span><span>A little more organized. A little more you.</span></div></section></div>;
}
