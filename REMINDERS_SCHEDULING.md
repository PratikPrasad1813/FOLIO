# Folio 2.0 — Scheduled Reminder Processing Guide

Folio 2.0 evaluates task reminders, upcoming/overdue deadlines, project & milestone reminders, quiet-hours queues, and Google Calendar event reminders on the server via an idempotent, PostgreSQL advisory-locked endpoint:

```
POST /api/notifications/process
GET  /api/notifications/process
```

## 1. Required Environment Variable

Generate a high-entropy secret (at least 32 random bytes) and add it to your deployment environment:

```bash
# Example: openssl rand -hex 32
FOLIO_CRON_SECRET="your-random-32-byte-hex-secret"
```

> **Honest scheduler status:** Until `FOLIO_CRON_SECRET` is set and an external scheduler invokes `/api/notifications/process`, Folio's **Settings → Notifications & reminders** panel transparently reports **"No external cron configured"** rather than pretending a background worker is running.

---

## 2. Option A — Netlify Scheduled Functions (Recommended for Netlify)

Create `netlify/functions/process-reminders.mts` in your repository:

```ts
import type { Config } from "@netlify/functions";

export default async function handler() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");
  const secret = process.env.FOLIO_CRON_SECRET;

  if (!appUrl || !secret) {
    console.error("Missing NEXT_PUBLIC_APP_URL/URL or FOLIO_CRON_SECRET");
    return new Response("Misconfigured", { status: 500 });
  }

  const response = await fetch(`${appUrl}/api/notifications/process`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
    },
  });

  const body = await response.text();
  console.log("Folio reminder run:", response.status, body);
  return new Response(body, { status: response.status });
}

export const config: Config = {
  // Run every 5 minutes (adjust to "*/1 * * * *" on Pro plans for 1-minute precision)
  schedule: "*/5 * * * *",
};
```

Set `FOLIO_CRON_SECRET` and `NEXT_PUBLIC_APP_URL` in **Netlify Site configuration → Environment variables**, then deploy.

---

## 3. Option B — Vercel Cron

 Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>` on `GET` requests. Folio accepts either `FOLIO_CRON_SECRET` or `CRON_SECRET`.

Add `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/notifications/process",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

---

## 4. Option C — GitHub Actions / External Cron / System `crontab`

You can trigger the endpoint from any external scheduler (e.g. `cron-job.org`, Railway Cron, Render Cron, or Linux `crontab`):

```bash
curl -fsS -X POST "https://your-folio-domain.example/api/notifications/process" \
  -H "Authorization: Bearer ${FOLIO_CRON_SECRET}"
```

---

## 5. Reliability, Idempotency & Downtime Recovery Guarantees

- **Concurrency safe:** Uses `pg_try_advisory_lock(72031918)` so overlapping cron runs never double-process.
- **Idempotent & duplicate-proof:** Every delivery is recorded in `folio_reminder_deliveries` (`UNIQUE (user_id, dedupe_key)`) and `folio_notifications` (`UNIQUE (user_id, dedupe_key)`). Even if a user deletes or clears a notification, the same reminder occurrence is never recreated.
- **Downtime catch-up:** Pending task reminders (`remind_at <= now`) and missed Google Calendar intervals (up to 12 hours) are automatically caught up on the first run after temporary downtime.
- **Timezone & quiet hours aware:** All date cutoffs, relative due times, and quiet-hours windows are evaluated in each user's configured IANA timezone. Reminders triggered during quiet hours are queued with `delivery_status = 'queued_quiet_hours'` and promoted once quiet hours end (unless the underlying task or event was completed/cancelled in the meantime).
