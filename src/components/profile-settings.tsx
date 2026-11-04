"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CircleCheck,
  Globe2,
  Link2,
  MailCheck,
  Palette,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { readProfile } from "@/lib/profile-service";
import { Spinner } from "@/components/ui";
import { EMAIL_FEATURES_ENABLED, EMAIL_FEATURES_NOTICE } from "@/lib/feature-flags";

export function ProfileSettings() {
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof readProfile>> | null>(null);
  const connectionNotice = useSearchParams().get("error")?.slice(0, 240) || "";
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [guideBusy, setGuideBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/profile", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        return data;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setProfile(data);
          setError("");
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message || "Couldn’t load preferences.");
      });
    return () => controller.abort();
  }, [attempt]);

  async function sendVerification() {
    if (verifyBusy) return;
    setVerifyBusy(true);
    setVerifyMessage(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) {
        setVerifyMessage({ tone: "err", text: data.error || "Could not send verification email." });
      } else {
        setVerifyMessage({ tone: "ok", text: data.message || "Verification link sent." });
      }
    } catch {
      setVerifyMessage({ tone: "err", text: "Could not reach the verification service." });
    } finally {
      setVerifyBusy(false);
    }
  }

  async function reopenGuide() {
    if (guideBusy) return;
    setGuideBusy(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guideDismissed: false }),
      });
      if (res.ok) {
        const next = await res.json();
        setProfile(next);
      }
    } finally {
      setGuideBusy(false);
    }
  }

  return (
    <section className="panel settings-card personalization-card">
      <div className="settings-section-heading">
        <h2>Made a little more yours.</h2>
        <p>Your profile, email verification, and connected sign-in accounts.</p>
      </div>

      {connectionNotice && (
        <p className="form-error" role="alert">
          {connectionNotice}
        </p>
      )}

      {error ? (
        <p role="alert">
          {error}
          <button className="pj-link" onClick={() => setAttempt((v) => v + 1)}>
            <RefreshCw size={13} />
            Retry
          </button>
        </p>
      ) : !profile ? (
        <p>
          <Spinner size={14} /> Loading your preferences…
        </p>
      ) : (
        <>
          <div className="profile-preference-chips">
            <span>
              <UserRound size={13} />
              {profile.user.greetingName}
            </span>
            <span>
              <Globe2 size={13} />
              {profile.timezone}
            </span>
            <span>
              <Palette size={13} />
              {profile.personal.theme === "system" ? "Follow system" : profile.personal.theme}
            </span>
            {(profile.user.emailVerified || (EMAIL_FEATURES_ENABLED && profile.user.provider === "email")) && (
              <span>
                {profile.user.emailVerified ? <CircleCheck size={13} /> : <ShieldAlert size={13} />}
                {profile.user.emailVerified ? "Email verified" : "Email unverified"}
              </span>
            )}
          </div>

          {!EMAIL_FEATURES_ENABLED && profile.user.provider === "email" && !profile.user.emailVerified && (
            <p className="folio-notice" role="note">
              <Sparkles size={13} />
              <span>{EMAIL_FEATURES_NOTICE}</span>
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Link href="/preferences" className="pj-btn is-secondary">
              Edit profile &amp; preferences
              <ArrowUpRight size={14} />
            </Link>
            {EMAIL_FEATURES_ENABLED && !profile.user.emailVerified && profile.user.provider === "email" && (
              <button
                type="button"
                className="pj-btn is-secondary"
                disabled={verifyBusy}
                onClick={() => void sendVerification()}
              >
                {verifyBusy ? <Spinner size={13} /> : <MailCheck size={14} />}
                Verify email address
              </button>
            )}
            {profile.user.guideDismissed && (
              <button
                type="button"
                className="pj-btn is-ghost"
                disabled={guideBusy}
                onClick={() => void reopenGuide()}
              >
                {guideBusy ? <Spinner size={13} /> : <Sparkles size={14} />}
                Show getting-started guide on Overview
              </button>
            )}
          </div>

          {EMAIL_FEATURES_ENABLED && verifyMessage && (
            <p
              role="status"
              style={{
                fontSize: 11.5,
                marginTop: 10,
                color: verifyMessage.tone === "ok" ? "var(--green)" : "#c45858",
              }}
            >
              {verifyMessage.text}
            </p>
          )}

          <div className="profile-connections">
            <h3>
              <Link2 size={14} />
              Sign-in method
            </h3>
            <p>
              Link a sign-in provider while signed in. Its verified email must match your Folio account; accounts are never merged automatically.
            </p>
            {(["google", "github"] as const).map((provider) => {
              const linked =
                profile.linkedProviders.includes(provider) || profile.user.provider === provider;
              const label = provider === "google" ? "Google" : "GitHub";
              return (
                <div key={provider}>
                  <strong>{label}</strong>
                  {linked ? (
                    <span className="connection-note" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Check size={12} /> Connected
                    </span>
                  ) : (
                    <a className="connection-note" href={`/api/auth/oauth/${provider}?link=1`}>
                      Link {label} →
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
