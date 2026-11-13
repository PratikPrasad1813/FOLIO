import { createHash, timingSafeEqual } from "node:crypto";
import { requireUser, sameOrigin } from "@/lib/auth";
import {
  getOrCreatePreferences,
  getSchedulerTelemetry,
  processAllUsersReminders,
  processUserReminders,
} from "@/lib/reminder-processor";

export const dynamic = "force-dynamic";

function extractCronToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  const custom = request.headers.get("x-folio-cron-secret");
  if (custom) return custom.trim();
  return null;
}

function verifySecret(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function handleScheduledCron(token: string) {
  const expected = (process.env.FOLIO_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  if (!expected) {
    return Response.json(
      {
        error:
          "Scheduled HTTP cron execution is not configured. Set FOLIO_CRON_SECRET in your environment.",
      },
      { status: 503 },
    );
  }
  if (!verifySecret(token, expected)) {
    return Response.json({ error: "Unauthorized cron token." }, { status: 401 });
  }

  const summary = await processAllUsersReminders("cron");
  return Response.json({
    ok: true,
    mode: "cron",
    processedAt: new Date().toISOString(),
    ...summary,
  });
}

/**
 * GET is supported specifically for hosted schedulers (e.g. Vercel Cron) that
 * send `GET` with `Authorization: Bearer <CRON_SECRET>`. Unauthenticated GETs are rejected.
 */
export async function GET(request: Request) {
  const token = extractCronToken(request);
  if (!token) {
    return Response.json(
      { error: "Authorization: Bearer <FOLIO_CRON_SECRET> header is required." },
      { status: 401 },
    );
  }
  try {
    return await handleScheduledCron(token);
  } catch (error) {
    console.error("Cron reminder processing failed:", error);
    return Response.json({ error: "Reminder processing failed." }, { status: 500 });
  }
}

/**
 * POST supports both:
 * 1) Protected external scheduled execution (Netlify Scheduled Functions, GitHub Actions, curl)
 *    with `Authorization: Bearer <FOLIO_CRON_SECRET>` or `x-folio-cron-secret`.
 * 2) Same-origin manual reminder evaluation scoped strictly to the signed-in user.
 */
export async function POST(request: Request) {
  const token = extractCronToken(request);
  if (token) {
    try {
      return await handleScheduledCron(token);
    } catch (error) {
      console.error("Cron reminder processing failed:", error);
      return Response.json({ error: "Reminder processing failed." }, { status: 500 });
    }
  }

  if (!sameOrigin(request)) {
    return Response.json({ error: "Request not allowed." }, { status: 403 });
  }

  try {
    const user = await requireUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });

    const result = await processUserReminders(user.id, { source: "manual" });
    const prefs = await getOrCreatePreferences(user.id);
    const scheduler = await getSchedulerTelemetry(prefs);
    return Response.json({
      ok: true,
      mode: "user",
      processedAt: new Date().toISOString(),
      result,
      scheduler,
    });
  } catch (error) {
    console.error("User reminder processing failed:", error);
    return Response.json({ error: "Couldn’t process due reminders." }, { status: 500 });
  }
}
