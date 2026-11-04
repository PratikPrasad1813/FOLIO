// Central, documented switch for EMAIL-DEPENDENT FRONTEND features.
//
// Set NEXT_PUBLIC_EMAIL_FEATURES_ENABLED=true (at build or dev-server start) to show
// email verification prompts, "Send verification link" / "Verify email address" actions,
// and the password-recovery entry points and forms.
//
// This flag controls user-facing UI only. It does NOT disable or gate:
//   - SMTP / Nodemailer transport or its configuration (src/lib/email/mailer.ts),
//   - verification or password-reset token issuance and validation (/api/auth/*),
//   - email templates, the /dev/emails preview studio, or email-related tables.
// Server-side security checks never read this flag. Because NEXT_PUBLIC_* values are
// inlined into the browser bundle, never place secrets in a NEXT_PUBLIC_* variable.

const FLAG = process.env.NEXT_PUBLIC_EMAIL_FEATURES_ENABLED ?? "";

export const EMAIL_FEATURES_ENABLED = /^(true|1)$/i.test(FLAG.trim());

/** Calm, user-facing wording. Never includes configuration or transport details. */
export const EMAIL_FEATURES_NOTICE =
  "Email verification and password recovery are temporarily unavailable while we finish setting up our email services.";
