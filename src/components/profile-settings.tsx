"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
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
import { DEFAULT_PERSONAL } from "@/lib/personalization";
import { isDesktopRuntime } from "@/lib/desktop/runtime";
import { getCachedProfile, markLocalProfilePending } from "@/lib/desktop/local-db";
import type { User } from "@/lib/types";

type ProfileData = Awaited<ReturnType<typeof readProfile>>;

/**
 * Reads the connection-error notice from the URL. Isolated in its own
 * component and wrapped in <Suspense>: `useSearchParams()` inside a
 * statically prerendered route (the desktop export prerenders every
 * workspace view) requires a Suspense boundary, or Next.js fails the
 * prerender with a client-side-rendering bailout.
 */
function ConnectionNotice() {
  const connectionNotice = useSearchParams().get("error")?.slice(0, 240) || "";
  if (!connectionNotice) return null;
  return (
    <p className="form-error" role="alert">
      {connectionNotice}
    </p>
  );
}

/** Map the cached desktop profile snapshot onto the settings-card shape. */
function desktopProfile(user: User): ProfileData {
  return {
    user,
    personal: { ...DEFAULT_PERSONAL, ...user.personal },
    timezone: user.timezone || "UTC",
    // Linked providers are a web-side OAuth concern; the desktop mirror has
    // no authIdentities table, so the chips simply render as unlinked.
    linkedProviders: [],
    onboardingStep: 0,
    onboardingCompleted: user.onboardingCompleted,
  } as unknown as ProfileData;
}

export function ProfileSettings() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [guideBusy, setGuideBusy] = useState(false);
  // Hydration guard: the desktop probe is only trusted after mount so the
  // server render and the hydration pass stay identical (Category 2).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDesktop = mounted && isDesktopRuntime();

  useEffect(() => {
    // Local-first desktop path: folio.db's profile snapshot is the source of
    // truth. A relative fetch("/api/profile") can never succeed inside the
    // Tauri webview (there is no same-origin server), so the card reads the
    // cached snapshot instead and refreshes itself after every sync cycle.
    if (isDesktopRuntime()) {
      let cancelled = false;
      const loadCached = () => {
        void getCachedProfile()
          .then((user) => {
            if (cancelled || !user) return;
            setProfile(desktopProfile(user));
            setError("");
          })
          .catch(() => {
            if (!cancelled) setError("Your preferences will appear once your first sync finishes.");
          });
      };
      loadCached();
      window.addEventListener("folio:workspace-sync", loadCached);
      return () => {
        cancelled = true;
        window.removeEventListener("folio:workspace-sync", loadCached);
      };
    }

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
      if (isDesktopRuntime()) {
        // Queue the change for the background sync engine (works offline);
        // update the local snapshot + UI immediately.
        await markLocalProfilePending({ guideDismissed: false });
        setProfile((current) =>
          current ? { ...current, user: { ...current.user, guideDismissed: false } } : current,
        );
      } else {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guideDismissed: false }),
        });
        if (res.ok) {
          const next = await res.json();
          setProfile(next);
        }
      }
    } catch {
      // The guide can be re-opened later; never block the settings card.
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

      <Suspense fallback={null}>
        <ConnectionNotice />
      </Suspense>

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
            {/* The full preferences editor is a server-rendered web page — the
                desktop shell edits the same fields in the form below instead. */}
            {!isDesktop && (
              <Link href="/preferences" className="pj-btn is-secondary">
                Edit profile &amp; preferences
                <ArrowUpRight size={14} />
              </Link>
            )}
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
