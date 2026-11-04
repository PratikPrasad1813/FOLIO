import {
  escapeHtml,
  formatGreetingLine,
  formatRecipientName,
  italicSerifAccent,
  normalizeAppOrigin,
  renderEmailButton,
  renderEmailCallout,
  renderEmailDocument,
  renderEmailFallbackLink,
  renderEmailMetadataCard,
  renderEmailParagraph,
  renderEmailStepList,
} from "@/lib/email/design-system";

export type EmailTemplateId =
  | "welcome"
  | "email-verification"
  | "password-reset"
  | "password-changed"
  | "provider-linked"
  | "calendar-connected";

export interface RenderedEmail {
  id: EmailTemplateId;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  ctaLabel: string;
  ctaUrl: string;
}

export interface WelcomeEmailInput {
  name?: string | null;
  email: string;
  appOrigin?: string | null;
  provider?: string | null;
  weeklyGoal?: number | null;
  workUses?: string[] | null;
}

export function buildWelcomeEmail(input: WelcomeEmailInput): RenderedEmail {
  const origin = normalizeAppOrigin(input.appOrigin);
  const ctaUrl = `${origin}/overview`;
  const ctaLabel = "Open your Folio workspace";
  const shortName = formatRecipientName(input.name);
  const greeting = formatGreetingLine(input.name);
  const uses = Array.isArray(input.workUses) ? input.workUses.filter(Boolean) : [];
  const primaryFocus = uses[0] || null;
  const providerName =
    input.provider === "google"
      ? "Google"
      : input.provider === "github"
        ? "GitHub"
        : "Email & password";
  const weeklyGoal = typeof input.weeklyGoal === "number" && input.weeklyGoal > 0 ? input.weeklyGoal : 12;

  const firstStepDetail =
    primaryFocus === "Managing projects" || primaryFocus === "Professional work"
      ? "Create a project with clear milestones so your highest-leverage work has a dedicated home."
      : primaryFocus === "Studies & learning"
        ? "Start a study or research project and map key milestones onto your timeline."
        : "Start with one meaningful project—no pre-filled clutter, just a clean space for what matters.";

  const steps = [
    {
      number: "01",
      title: "Give your first project a home",
      description: firstStepDetail,
    },
    {
      number: "02",
      title: "Break momentum into calm next steps",
      description: `Move tasks across your board, list, or calendar at your own rhythm (your weekly focus starts at ${weeklyGoal} tasks and can be tuned anytime).`,
    },
    {
      number: "03",
      title: "Keep bright ideas and schedules together",
      description: "Park early sparks on your Idea Board until they are ready, connect Google Calendar when helpful, or explore private on-device Folio AI.",
    },
  ];

  const subject = shortName
    ? `Welcome to Folio, ${shortName} — your workspace is ready`
    : "Welcome to Folio — your workspace is ready";
  const preheader = "A calm, private home for your projects, tasks, schedule, and next bright ideas.";

  const bodyHtml = [
    renderEmailParagraph(
      "Welcome to Folio. Your workspace has been prepared and starts intentionally clear—without noisy sample projects or distractions—so everything inside belongs genuinely to you.",
    ),
    renderEmailParagraph(
      "Folio brings your long-term projects, daily tasks, schedule, and early ideas into one considered place. Here are three simple ways to make yourself at home:",
    ),
    renderEmailStepList(steps),
    renderEmailButton({ label: ctaLabel, href: ctaUrl, tone: "editorial" }),
    renderEmailMetadataCard("Your Workspace Details", [
      { label: "Account email", value: input.email },
      { label: "Sign-in method", value: providerName },
      { label: "Privacy model", value: "Account-scoped workspace · Optional local-only AI" },
    ]),
    renderEmailCallout({
      title: "Designed around your pace",
      body: "You can refine your display name, timezone, theme, quiet hours, and notification preferences whenever you like from Settings.",
      tone: "calm",
      actionLabel: "Review workspace preferences",
      actionHref: `${origin}/settings`,
    }),
  ].join("\n");

  const html = renderEmailDocument({
    subject,
    preheader,
    heroTone: "editorial",
    eyebrow: "Welcome to Folio",
    headlineHtml: `A quieter place for ${italicSerifAccent("better work.")}`,
    heroSubtitle: "Your projects, plans, and bright ideas—thoughtfully organized and always yours.",
    greeting,
    bodyHtml,
    appOrigin: origin,
    recipientEmail: input.email,
    footerReason: "You received this welcome note because a new Folio workspace was created with this email address.",
  });

  const text = [
    subject,
    "------------------------------------------------------------",
    "",
    greeting,
    "",
    "Welcome to Folio. Your workspace has been prepared and starts intentionally clear—without noisy sample projects—so everything inside belongs genuinely to you.",
    "",
    "Three ways to get started:",
    ...steps.map((s) => `${s.number}. ${s.title}\n   ${s.description}`),
    "",
    `${ctaLabel}: ${ctaUrl}`,
    "",
    `Account email: ${input.email}`,
    `Sign-in method: ${providerName}`,
    `Preferences: ${origin}/settings`,
    "",
    "With care,",
    "The Folio Team",
  ].join("\n");

  return { id: "welcome", subject, preheader, html, text, ctaLabel, ctaUrl };
}

export interface EmailVerificationInput {
  name?: string | null;
  email: string;
  token: string;
  expiresInHours?: number;
  appOrigin?: string | null;
}

export function buildEmailVerificationEmail(input: EmailVerificationInput): RenderedEmail {
  const origin = normalizeAppOrigin(input.appOrigin);
  const ctaUrl = `${origin}/verify-email#token=${encodeURIComponent(input.token)}`;
  const ctaLabel = "Verify email address";
  const hours = input.expiresInHours ?? 24;
  const greeting = formatGreetingLine(input.name);
  const subject = "Verify your email address for Folio";
  const preheader = `Confirm ${input.email} within ${hours} hours to secure account recovery and sign-in linking.`;

  const bodyHtml = [
    renderEmailParagraph(
      `Please confirm that <strong style="color:#1F1D2B;">${escapeHtml(input.email)}</strong> is the email address you want associated with your Folio workspace.`,
    ),
    renderEmailParagraph(
      "Verifying your email ensures you can reliably recover access if you ever forget your password and protects your account before linking external sign-in providers.",
    ),
    renderEmailButton({ label: ctaLabel, href: ctaUrl, tone: "security" }),
    renderEmailMetadataCard("Verification Details", [
      { label: "Email to verify", value: input.email },
      { label: "Link validity", value: `${hours} hours (single-use link)` },
    ]),
    renderEmailFallbackLink(ctaUrl),
    renderEmailCallout({
      title: "Didn’t request this verification?",
      body: "If you did not create a Folio workspace or request email verification, no action is needed. You can safely ignore this message and the link will expire automatically.",
      tone: "security",
    }),
  ].join("\n");

  const html = renderEmailDocument({
    subject,
    preheader,
    heroTone: "security",
    eyebrow: "Email Verification",
    headlineHtml: `Confirm your ${italicSerifAccent("email address.", "security")}`,
    heroSubtitle: "One quick confirmation keeps account recovery and sign-in protections active.",
    greeting,
    bodyHtml,
    appOrigin: origin,
    recipientEmail: input.email,
    footerReason: "You received this security email because email verification was requested for your Folio account.",
  });

  const text = [
    subject,
    "------------------------------------------------------------",
    "",
    greeting,
    "",
    `Please confirm that ${input.email} is the email address for your Folio workspace.`,
    "Verifying your email secures password recovery and protects provider linking.",
    "",
    `${ctaLabel}: ${ctaUrl}`,
    "",
    `Link validity: ${hours} hours (single-use link)`,
    "",
    "Didn't request this?",
    "If you did not create a Folio account or request verification, you can safely ignore this email. The link will expire automatically.",
    "",
    "With care,",
    "The Folio Team",
  ].join("\n");

  return { id: "email-verification", subject, preheader, html, text, ctaLabel, ctaUrl };
}

export interface PasswordResetEmailInput {
  name?: string | null;
  email: string;
  token: string;
  expiresInMinutes?: number;
  appOrigin?: string | null;
}

export function buildPasswordResetEmail(input: PasswordResetEmailInput): RenderedEmail {
  const origin = normalizeAppOrigin(input.appOrigin);
  const ctaUrl = `${origin}/recover#token=${encodeURIComponent(input.token)}`;
  const ctaLabel = "Choose a new password";
  const minutes = input.expiresInMinutes ?? 30;
  const greeting = formatGreetingLine(input.name);
  const subject = "Reset your Folio password";
  const preheader = `Use this single-use security link within ${minutes} minutes to choose a new Folio password.`;

  const bodyHtml = [
    renderEmailParagraph(
      `We received a request to reset the password for the Folio workspace associated with <strong style="color:#1F1D2B;">${escapeHtml(input.email)}</strong>.`,
    ),
    renderEmailParagraph(
      "Select the button below to choose a new password. For your protection, this link can only be used once and will sign out existing active sessions once completed.",
    ),
    renderEmailButton({ label: ctaLabel, href: ctaUrl, tone: "security" }),
    renderEmailMetadataCard("Security Summary", [
      { label: "Account", value: input.email },
      { label: "Expires in", value: `${minutes} minutes (single-use token)` },
      { label: "Session policy", value: "Active sessions are revoked after password change" },
    ]),
    renderEmailFallbackLink(ctaUrl),
    renderEmailCallout({
      title: "Didn’t request a password reset?",
      body: "Your current password has not been changed and your workspace remains private. You can safely ignore this email—nobody can reset your password without access to this inbox.",
      tone: "security",
    }),
  ].join("\n");

  const html = renderEmailDocument({
    subject,
    preheader,
    heroTone: "security",
    eyebrow: "Account Security",
    headlineHtml: `Reset your Folio ${italicSerifAccent("password.", "security")}`,
    heroSubtitle: "A single-use recovery link for your workspace.",
    greeting,
    bodyHtml,
    appOrigin: origin,
    recipientEmail: input.email,
    footerReason: "You received this security notice because a password recovery request was submitted for this email address.",
  });

  const text = [
    subject,
    "------------------------------------------------------------",
    "",
    greeting,
    "",
    `We received a request to reset the password for your Folio workspace (${input.email}).`,
    `Use this one-time link within ${minutes} minutes to choose a new password:`,
    "",
    ctaUrl,
    "",
    "Didn't request a password reset?",
    "Your password has not been changed. You can safely ignore this email and the link will expire automatically.",
    "",
    "With care,",
    "The Folio Team",
  ].join("\n");

  return { id: "password-reset", subject, preheader, html, text, ctaLabel, ctaUrl };
}

export interface PasswordChangedEmailInput {
  name?: string | null;
  email: string;
  changedAt?: Date;
  appOrigin?: string | null;
}

export function buildPasswordChangedEmail(input: PasswordChangedEmailInput): RenderedEmail {
  const origin = normalizeAppOrigin(input.appOrigin);
  const ctaUrl = `${origin}/recover`;
  const ctaLabel = "Secure & recover your account";
  const greeting = formatGreetingLine(input.name);
  const timestamp = (input.changedAt ?? new Date()).toUTCString();
  const subject = "Your Folio password was updated";
  const preheader = "Confirmation that your Folio password changed and previous sessions were signed out.";

  const bodyHtml = [
    renderEmailParagraph(
      `This is a confirmation that the password for your Folio account (<strong style="color:#1F1D2B;">${escapeHtml(input.email)}</strong>) was just updated.`,
    ),
    renderEmailParagraph(
      "As part of this update, any previous browser sessions for your workspace were automatically signed out so only you hold active access.",
    ),
    renderEmailMetadataCard("Change Confirmation", [
      { label: "Account", value: input.email },
      { label: "Updated at", value: timestamp },
      { label: "Active sessions", value: "Previous sessions signed out" },
    ]),
    renderEmailCallout({
      title: "Didn’t make this change?",
      body: "If you did not update your password, reset your Folio password immediately using the recovery page below and review the security of your email inbox.",
      tone: "security",
    }),
    renderEmailButton({ label: ctaLabel, href: ctaUrl, tone: "security" }),
  ].join("\n");

  const html = renderEmailDocument({
    subject,
    preheader,
    heroTone: "security",
    eyebrow: "Security Confirmation",
    headlineHtml: `Your password was ${italicSerifAccent("updated.", "security")}`,
    heroSubtitle: "Your workspace credentials were changed and previous sessions were signed out.",
    greeting,
    bodyHtml,
    appOrigin: origin,
    recipientEmail: input.email,
    footerReason: "You received this mandatory security confirmation because the password on your Folio account was changed.",
  });

  const text = [
    subject,
    "------------------------------------------------------------",
    "",
    greeting,
    "",
    `The password for your Folio account (${input.email}) was updated on ${timestamp}.`,
    "All previous sessions were signed out automatically.",
    "",
    "If you made this change, no further action is needed.",
    `If you did NOT make this change, recover your account immediately: ${ctaUrl}`,
    "",
    "With care,",
    "The Folio Team",
  ].join("\n");

  return { id: "password-changed", subject, preheader, html, text, ctaLabel, ctaUrl };
}

export interface ProviderLinkedEmailInput {
  name?: string | null;
  email: string;
  provider: "google" | "github";
  providerEmail: string;
  linkedAt?: Date;
  appOrigin?: string | null;
}

export function buildProviderLinkedEmail(input: ProviderLinkedEmailInput): RenderedEmail {
  const origin = normalizeAppOrigin(input.appOrigin);
  const ctaUrl = `${origin}/settings`;
  const ctaLabel = "Review sign-in settings";
  const providerLabel = input.provider === "google" ? "Google" : "GitHub";
  const greeting = formatGreetingLine(input.name);
  const timestamp = (input.linkedAt ?? new Date()).toUTCString();
  const subject = `${providerLabel} sign-in was linked to your Folio account`;
  const preheader = `${providerLabel} (${input.providerEmail}) can now be used to sign in to your Folio workspace.`;

  const bodyHtml = [
    renderEmailParagraph(
      `<strong style="color:#1F1D2B;">${escapeHtml(providerLabel)}</strong> was just linked as a verified sign-in method for your Folio workspace.`,
    ),
    renderEmailParagraph(
      `You can now sign in seamlessly using ${escapeHtml(providerLabel)} in addition to your existing credentials. Your projects, tasks, and preferences remain unchanged.`,
    ),
    renderEmailMetadataCard("Connected Sign-In Identity", [
      { label: "Provider", value: providerLabel },
      { label: "Verified address", value: input.providerEmail },
      { label: "Connected at", value: timestamp },
    ]),
    renderEmailButton({ label: ctaLabel, href: ctaUrl, tone: "security" }),
    renderEmailCallout({
      title: "Didn’t connect this sign-in method?",
      body: "Visit Account recovery immediately to reset your password and revoke active browser sessions.",
      tone: "security",
      actionLabel: "Reset password & revoke sessions",
      actionHref: `${origin}/recover`,
    }),
  ].join("\n");

  const html = renderEmailDocument({
    subject,
    preheader,
    heroTone: "security",
    eyebrow: "Account Access",
    headlineHtml: `${escapeHtml(providerLabel)} sign-in ${italicSerifAccent("connected.", "security")}`,
    heroSubtitle: "A new verified sign-in identity was added to your Folio account.",
    greeting,
    bodyHtml,
    appOrigin: origin,
    recipientEmail: input.email,
    footerReason: "You received this security notice because a new OAuth sign-in provider was linked to your Folio account.",
  });

  const text = [
    subject,
    "------------------------------------------------------------",
    "",
    greeting,
    "",
    `${providerLabel} (${input.providerEmail}) was linked to your Folio workspace on ${timestamp}.`,
    "",
    `${ctaLabel}: ${ctaUrl}`,
    `If you did not authorize this, reset your password immediately: ${origin}/recover`,
    "",
    "With care,",
    "The Folio Team",
  ].join("\n");

  return { id: "provider-linked", subject, preheader, html, text, ctaLabel, ctaUrl };
}

export interface CalendarConnectedEmailInput {
  name?: string | null;
  email: string;
  googleEmail: string;
  writeEnabled: boolean;
  connectedAt?: Date;
  appOrigin?: string | null;
}

export function buildCalendarConnectedEmail(input: CalendarConnectedEmailInput): RenderedEmail {
  const origin = normalizeAppOrigin(input.appOrigin);
  const ctaUrl = `${origin}/calendar`;
  const ctaLabel = "Open your Folio calendar";
  const greeting = formatGreetingLine(input.name);
  const timestamp = (input.connectedAt ?? new Date()).toUTCString();
  const permissionText = input.writeEnabled
    ? "Read calendars & create/edit selected events"
    : "Read-only calendar visibility (no event edits)";
  const subject = "Google Calendar is now connected to Folio";
  const preheader = `${input.googleEmail} is synced with your Folio schedule.`;

  const bodyHtml = [
    renderEmailParagraph(
      `Your Google Calendar account (<strong style="color:#1F1D2B;">${escapeHtml(input.googleEmail)}</strong>) is now connected to your Folio workspace.`,
    ),
    renderEmailParagraph(
      "Selected calendars now appear alongside your task deadlines and project milestones so you can plan your week with full context.",
    ),
    renderEmailMetadataCard("Integration Summary", [
      { label: "Google account", value: input.googleEmail },
      { label: "Access level", value: permissionText },
      { label: "Connected at", value: timestamp },
    ]),
    renderEmailButton({ label: ctaLabel, href: ctaUrl, tone: "editorial" }),
    renderEmailCallout({
      title: "You stay in complete control",
      body: "You can choose which calendars are visible, adjust event permissions, or disconnect Google Calendar at any time in Settings without affecting your Google events.",
      tone: "calm",
      actionLabel: "Manage calendar integration",
      actionHref: `${origin}/settings`,
    }),
  ].join("\n");

  const html = renderEmailDocument({
    subject,
    preheader,
    heroTone: "editorial",
    eyebrow: "Calendar Integration",
    headlineHtml: `Your schedule, ${italicSerifAccent("in one place.")}`,
    heroSubtitle: "Google Calendar is now connected to your Folio workspace.",
    greeting,
    bodyHtml,
    appOrigin: origin,
    recipientEmail: input.email,
    footerReason: "You received this confirmation because Google Calendar was connected to your Folio workspace.",
  });

  const text = [
    subject,
    "------------------------------------------------------------",
    "",
    greeting,
    "",
    `Google Calendar (${input.googleEmail}) is now connected to your Folio workspace.`,
    `Access level: ${permissionText}`,
    `Connected at: ${timestamp}`,
    "",
    `${ctaLabel}: ${ctaUrl}`,
    `Manage integration: ${origin}/settings`,
    "",
    "With care,",
    "The Folio Team",
  ].join("\n");

  return { id: "calendar-connected", subject, preheader, html, text, ctaLabel, ctaUrl };
}
