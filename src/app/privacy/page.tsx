import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader, PublicFooter } from "@/components/public-site";

export const metadata: Metadata = {
  title: "Privacy — Folio",
  description: "How Folio handles your account, workspace, calendar connection, and Gemini AI data.",
};

export default function PrivacyPage() {
  return (
    <div className="public-site">
      <PublicHeader />
      <main className="lp-legal">
        <span className="lp-eyebrow">THE IMPORTANT BITS</span>
        <h1>Your work is personal.<br /><em>Here’s how we handle it.</em></h1>
        <p className="legal-lead">
          Folio is designed around a personal, signed-in workspace. This policy describes the features in this
          version—not promises about certifications or services we don’t provide.
        </p>
        <section>
          <h2>Your account and profile</h2>
          <p>
            Folio stores your display name, email address, sign-in provider identifiers, and the preferences you
            choose. Google and GitHub sign-in require a verified provider email. Optional gender, country, and forms
            of address are used only for your profile and personalization, not for eligibility or access. You can edit
            or clear optional answers in <Link href="/preferences">your preferences</Link>.
          </p>
        </section>
        <section>
          <h2>Your workspace and conversations</h2>
          <p>
            Projects, tasks, ideas, activity, notification preferences, search history, saved filters, and Folio AI
            conversations are stored in the deployment’s PostgreSQL database. Backend requests are scoped to the
            signed-in user. Settings offers a JSON export of workspace data. The landing page uses a dedicated
            synthetic example workspace—not private user captures.
          </p>
        </section>
        <section>
          <h2>Folio AI and Google Gemini</h2>
          <p>
            Folio AI sends your prompt, relevant conversation context, and selected workspace context to Google AI
            Studio for Gemini inference. Google processes that information under the terms and data-use settings for
            the API key’s project. Do not put passwords, API keys, government identifiers, or other unnecessary
            sensitive details into AI prompts. The Gemini API key is held by the Folio server and is not sent to your
            browser.
          </p>
          <p>
            Folio enforces a 10,000-token daily allowance per user and stores usage metadata for that limit. This
            allowance is separate from Google’s project-level rate limits and any billing enabled for the deployment’s
            Google AI Studio project. Folio action plans are proposals: workspace changes use the existing validation
            and confirmation flow.
          </p>
        </section>
        <section>
          <h2>Authentication and cookies</h2>
          <p>
            Folio uses an HTTP-only, SameSite session cookie and single-use OAuth state with PKCE. HTTPS deployments
            use Secure cookies. Sessions expire after 30 days and can renew while active. Logging out revokes the
            current server session. Local storage remembers the visual theme and existing view preferences. Rate-limit
            records use hashed request identifiers and limited expiry windows.
          </p>
        </section>
        <section>
          <h2>Google Calendar</h2>
          <p>
            Calendar access is separate from signing in with Google. You choose which calendars to display, and write
            access is optional. Calendar credentials are retained server-side with the existing encrypted-token
            storage. Disconnecting in Settings removes the stored Calendar account and event mirror, without deleting
            events in Google Calendar.
          </p>
        </section>
        <section>
          <h2>Third-party providers and retention</h2>
          <p>
            Google, GitHub, the hosting provider, and the PostgreSQL provider process requests under their own
            policies. Workspace records remain until removed through Folio or by the deployment administrator.
            Current sessions can be revoked by signing out; Calendar access can be disconnected in Settings. This
            version does not yet include a self-service account-deletion workflow.
          </p>
        </section>
        <section>
          <h2>Keep sensitive information out of prompts</h2>
          <p>
            No security system is infallible. For the terms governing this preview, read{" "}
            <Link href="/terms">Terms of service</Link>.
          </p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
