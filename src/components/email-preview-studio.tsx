"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileText,
  Mail,
  Monitor,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from "lucide-react";
import { Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  buildCalendarConnectedEmail,
  buildEmailVerificationEmail,
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
  buildProviderLinkedEmail,
  buildWelcomeEmail,
  type EmailTemplateId,
  type RenderedEmail,
} from "@/lib/email/templates";

interface PersonaPreset {
  id: string;
  label: string;
  name: string;
  email: string;
  workUses: string[];
}

const PERSONAS: PersonaPreset[] = [
  {
    id: "standard",
    label: "Standard name",
    name: "Elena Rostova",
    email: "elena@rostova.studio",
    workUses: ["Managing projects", "Professional work"],
  },
  {
    id: "missing",
    label: "Missing name",
    name: "",
    email: "hello@folio.studio",
    workUses: [],
  },
  {
    id: "long",
    label: "Long name (56 chars)",
    name: "Alexandrina Bartholomew-Featherstonehaugh-Montgomery III",
    email: "alexandrina.bartholomew@enterprise.example.org",
    workUses: ["Studies & learning"],
  },
  {
    id: "special",
    label: "Special characters",
    name: "Maya O'Connor & Studio <Design>",
    email: "maya@oconnor.design",
    workUses: ["Personal productivity"],
  },
];

const TEMPLATE_META: { id: EmailTemplateId; label: string; trigger: string; expectedPath: string }[] = [
  {
    id: "welcome",
    label: "Welcome Email",
    trigger: "Sent once immediately after successful registration",
    expectedPath: "/overview",
  },
  {
    id: "email-verification",
    label: "Email Verification",
    trigger: "Sent when a user requests a 24h email verification link",
    expectedPath: "/verify-email#token=",
  },
  {
    id: "password-reset",
    label: "Password Reset",
    trigger: "Sent on password recovery request (30m single-use link)",
    expectedPath: "/recover#token=",
  },
  {
    id: "password-changed",
    label: "Password Changed",
    trigger: "Sent immediately after password update & session revocation",
    expectedPath: "/recover",
  },
  {
    id: "provider-linked",
    label: "Provider Linked",
    trigger: "Sent when Google or GitHub sign-in is linked in Settings",
    expectedPath: "/settings",
  },
  {
    id: "calendar-connected",
    label: "Calendar Connected",
    trigger: "Sent when Google Calendar is connected to the workspace",
    expectedPath: "/calendar",
  },
];

const SAMPLE_TOKEN = "a9f4c2e8b1d073654e92a1c8f3b6d5e40918273645fedcba9876543210abcdef";
const FIXED_PREVIEW_DATE = new Date("2026-11-02T14:30:00Z");

export function EmailPreviewStudio({
  defaultOrigin,
  smtpConfigured,
}: {
  defaultOrigin: string;
  smtpConfigured: boolean;
}) {
  const [templateId, setTemplateId] = useState<EmailTemplateId>("welcome");
  const [personaId, setPersonaId] = useState<string>("standard");
  const [viewMode, setViewMode] = useState<"desktop" | "mobile" | "text" | "audit">("desktop");

  const persona = PERSONAS.find((p) => p.id === personaId) ?? PERSONAS[0];
  const meta = TEMPLATE_META.find((t) => t.id === templateId) ?? TEMPLATE_META[0];

  const rendered: RenderedEmail = useMemo(() => {
    switch (templateId) {
      case "welcome":
        return buildWelcomeEmail({
          name: persona.name,
          email: persona.email,
          appOrigin: defaultOrigin,
          provider: "email",
          weeklyGoal: 12,
          workUses: persona.workUses,
        });
      case "email-verification":
        return buildEmailVerificationEmail({
          name: persona.name,
          email: persona.email,
          token: SAMPLE_TOKEN,
          expiresInHours: 24,
          appOrigin: defaultOrigin,
        });
      case "password-reset":
        return buildPasswordResetEmail({
          name: persona.name,
          email: persona.email,
          token: SAMPLE_TOKEN,
          expiresInMinutes: 30,
          appOrigin: defaultOrigin,
        });
      case "password-changed":
        return buildPasswordChangedEmail({
          name: persona.name,
          email: persona.email,
          changedAt: FIXED_PREVIEW_DATE,
          appOrigin: defaultOrigin,
        });
      case "provider-linked":
        return buildProviderLinkedEmail({
          name: persona.name,
          email: persona.email,
          provider: "google",
          providerEmail: persona.email,
          linkedAt: FIXED_PREVIEW_DATE,
          appOrigin: defaultOrigin,
        });
      case "calendar-connected":
        return buildCalendarConnectedEmail({
          name: persona.name,
          email: persona.email,
          googleEmail: persona.email,
          writeEnabled: false,
          connectedAt: FIXED_PREVIEW_DATE,
          appOrigin: defaultOrigin,
        });
    }
  }, [templateId, persona, defaultOrigin]);

  const byteSize = useMemo(() => new TextEncoder().encode(rendered.html).length, [rendered.html]);
  const checks = useMemo(() => {
    const hasPresentationTables = rendered.html.includes('role="presentation"');
    const hasOutlookVml = rendered.html.includes("v:roundrect") && rendered.html.includes("OfficeDocumentSettings");
    const hasNoExternalImages = !/<img\b/i.test(rendered.html);
    const underGmailClipLimit = byteSize < 102_000;
    const ctaMatchesRoute = rendered.ctaUrl.startsWith(defaultOrigin) && rendered.ctaUrl.includes(meta.expectedPath);
    const noUnescapedHtml = !rendered.html.includes("<Design>");
    return [
      { label: "Gmail-safe table layout & under 102 KB clip threshold", ok: hasPresentationTables && underGmailClipLimit, detail: `${(byteSize / 1024).toFixed(1)} KB HTML` },
      { label: "Outlook desktop MSO DPI & VML bulletproof CTA button", ok: hasOutlookVml, detail: "v:roundrect + MSO conditional" },
      { label: "100% readable when images are blocked", ok: hasNoExternalImages, detail: "Zero external image tags required" },
      { label: "Primary CTA points to verified application route", ok: ctaMatchesRoute, detail: rendered.ctaUrl },
      { label: "Dynamic user input safely HTML-escaped", ok: noUnescapedHtml, detail: "XSS & broken-tag safe" },
    ];
  }, [rendered, byteSize, defaultOrigin, meta.expectedPath]);

  return (
    <div className="public-site" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          borderBottom: "1px solid var(--lp-line)",
          background: "var(--lp-surface)",
          padding: "14px 26px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" aria-label="Folio home">
            <Logo compact />
          </Link>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 14.5 }}>Folio Email Design System</strong>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: "var(--lp-soft)",
                  color: "var(--lp-accent)",
                }}
              >
                Local Preview Studio
              </span>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--lp-muted)", marginTop: 2 }}>
              Inspect every transactional template locally — no real emails are sent from this preview.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 8,
              border: "1px solid var(--lp-line)",
              color: "var(--lp-muted)",
            }}
          >
            SMTP status: <strong style={{ color: "var(--lp-text)" }}>{smtpConfigured ? "Configured" : "Not configured (preview active)"}</strong>
          </span>
          <ThemeToggle />
          <Link href="/" className="lp-button is-small is-outline">
            <ArrowLeft size={13} />
            Back to Folio
          </Link>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "minmax(250px, 300px) minmax(0, 1fr)",
          minHeight: 0,
        }}
      >
        {/* Left Sidebar: Templates & Personas */}
        <aside
          style={{
            borderRight: "1px solid var(--lp-line)",
            background: "var(--lp-surface)",
            padding: "20px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 22,
          }}
        >
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--lp-muted)", marginBottom: 10 }}>
              Transactional Templates (6)
            </div>
            <div role="tablist" aria-label="Email templates" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {TEMPLATE_META.map((item) => {
                const active = item.id === templateId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTemplateId(item.id)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `1px solid ${active ? "var(--lp-accent)" : "var(--lp-line)"}`,
                      background: active ? "var(--lp-soft)" : "transparent",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "var(--lp-text)" }}>
                      <Mail size={13} />
                      {item.label}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--lp-muted)", lineHeight: 1.45 }}>{item.trigger}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--lp-muted)", marginBottom: 10 }}>
              Recipient Edge-Case Presets
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PERSONAS.map((item) => {
                const active = item.id === personaId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPersonaId(item.id)}
                    style={{
                      textAlign: "left",
                      padding: "8px 11px",
                      borderRadius: 8,
                      border: `1px solid ${active ? "var(--lp-accent)" : "var(--lp-line)"}`,
                      background: active ? "var(--lp-soft)" : "transparent",
                      fontSize: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 550 }}>
                      <UserCheck size={13} />
                      {item.label}
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--lp-muted)" }}>{item.name ? `${item.name.slice(0, 14)}${item.name.length > 14 ? "…" : ""}` : "(empty)"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Main Preview Canvas */}
        <main style={{ padding: "22px 28px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {/* Envelope Metadata Bar */}
          <section
            style={{
              background: "var(--lp-surface)",
              border: "1px solid var(--lp-line)",
              borderRadius: 12,
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--lp-muted)", marginBottom: 3 }}>
                To: <strong style={{ color: "var(--lp-text)" }}>{persona.email}</strong> &middot; CTA:{" "}
                <code style={{ fontSize: 11, color: "var(--lp-accent)" }}>{rendered.ctaUrl}</code>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--lp-text)" }}>{rendered.subject}</div>
              <div style={{ fontSize: 12, color: "var(--lp-muted)", marginTop: 2 }}>Preheader: {rendered.preheader}</div>
            </div>

            <div role="group" aria-label="Preview viewport" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { id: "desktop" as const, label: "Desktop (640px)", Icon: Monitor },
                { id: "mobile" as const, label: "Mobile (375px)", Icon: Smartphone },
                { id: "text" as const, label: "Plain text", Icon: FileText },
                { id: "audit" as const, label: "Client & CTA audit", Icon: ShieldCheck },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={viewMode === id}
                  onClick={() => setViewMode(id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 550,
                    border: `1px solid ${viewMode === id ? "var(--lp-accent)" : "var(--lp-line)"}`,
                    background: viewMode === id ? "var(--lp-soft)" : "var(--lp-bg)",
                    color: viewMode === id ? "var(--lp-accent)" : "var(--lp-text)",
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Frame / Output */}
          <div
            style={{
              flex: 1,
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start",
              background: "#ECEAE4",
              borderRadius: 14,
              border: "1px solid var(--lp-line)",
              padding: viewMode === "mobile" ? "24px 12px" : "20px",
              minHeight: 680,
            }}
          >
            {(viewMode === "desktop" || viewMode === "mobile") && (
              <iframe
                key={`${templateId}-${personaId}-${viewMode}`}
                title={`${meta.label} (${viewMode})`}
                srcDoc={rendered.html}
                sandbox=""
                style={{
                  width: viewMode === "mobile" ? 375 : "100%",
                  maxWidth: viewMode === "mobile" ? 375 : 680,
                  height: 760,
                  border: "1px solid #D8D4DF",
                  borderRadius: viewMode === "mobile" ? 22 : 12,
                  background: "#F4F3EF",
                  boxShadow: "0 18px 42px -24px rgba(24, 22, 34, 0.28)",
                }}
              />
            )}

            {viewMode === "text" && (
              <pre
                style={{
                  width: "100%",
                  maxWidth: 680,
                  margin: 0,
                  padding: 24,
                  borderRadius: 12,
                  background: "#181622",
                  color: "#EAE6F3",
                  fontSize: 12.5,
                  lineHeight: 1.65,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                }}
              >
                {rendered.text}
              </pre>
            )}

            {viewMode === "audit" && (
              <div
                style={{
                  width: "100%",
                  maxWidth: 680,
                  background: "var(--lp-surface)",
                  border: "1px solid var(--lp-line)",
                  borderRadius: 12,
                  padding: 24,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <h2 style={{ fontSize: 17, fontWeight: 600 }}>Email Client Compatibility &amp; Route Audit</h2>
                  <span style={{ fontSize: 12, color: "var(--lp-green)", fontWeight: 600 }}>
                    {checks.filter((c) => c.ok).length} / {checks.length} checks passing
                  </span>
                </div>

                {checks.map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 14,
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: "1px solid var(--lp-line)",
                      background: "var(--lp-bg)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <CheckCircle2 size={16} style={{ color: item.ok ? "var(--lp-green)" : "#c45858", flexShrink: 0 }} />
                      <strong style={{ fontSize: 13 }}>{item.label}</strong>
                    </div>
                    <code style={{ fontSize: 11, color: "var(--lp-muted)", wordBreak: "break-all" }}>{item.detail}</code>
                  </div>
                ))}

                <div
                  style={{
                    marginTop: 6,
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: "var(--lp-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                    <Code2 size={15} />
                    <span>Primary CTA Button: <strong>{rendered.ctaLabel}</strong></span>
                  </div>
                  <a
                    href={rendered.ctaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--lp-accent)" }}
                  >
                    Test CTA destination
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
