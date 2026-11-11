#!/usr/bin/env node
// Creates the demo user (Aarav Sharma, Asia/Kolkata) and a valid session row.
// Prints NOTHING sensitive: the session token is written to .demo_session.
import { createHash, randomBytes, scrypt as _scrypt } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const scrypt = promisify(_scrypt);
const root = "/home/z/my-project/FOLIO";
for (const line of readFileSync(`${root}/.env.local`, "utf8").split("\n")) {
  const m = line.match(/^DATABASE_URL=(.*)$/);
  if (m && !process.env.DATABASE_URL) process.env.DATABASE_URL = m[1];
}

const NAME = "Aarav Sharma";
const EMAIL = "aarav@folio.demo";
const PASSWORD = "marigold-lights-2026";
const TZ = "Asia/Kolkata";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (t, v) => pool.query(t, v);

async function main() {
  // 1. user
  let { rows } = await q(`select id from folio_users where email = $1`, [EMAIL]);
  let userId = rows[0]?.id;
  if (!userId) {
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(PASSWORD, salt, 64)).toString("hex");
    ({ rows } = await q(
      `insert into folio_users (name, email, password_hash, provider, email_verified_at, onboarding_step, onboarding_completed_at)
       values ($1,$2,$3,'email', now(), 3, now()) returning id`,
      [NAME, EMAIL, `${salt}:${key}`],
    ));
    userId = rows[0].id;
    console.log("user created");
  } else {
    console.log("user exists");
  }

  // 2. timezone-aware notification prefs (row is upserted by app on first load;
  //    we pre-create it so screenshots show IST immediately)
  await q(
    `insert into folio_notification_prefs (user_id, timezone, timezone_auto_detected, calendar_reminder_intervals)
     values ($1,$2,true, '{60,1440}')
     on conflict (user_id) do update set timezone = excluded.timezone`,
    [userId, TZ],
  );

  // 3. session (single-use token, sha256 stored — mirrors src/lib/auth.ts)
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await q(`delete from folio_sessions where user_id = $1`, [userId]);
  await q(`insert into folio_sessions (user_id, token_hash, expires_at) values ($1,$2, now() + interval '30 days')`, [userId, tokenHash]);
  writeFileSync("/home/z/my-project/scripts/.demo_session", token);

  // 4. wipe any previous workspace data so the new seed runs cleanly
  for (const t of ["folio_subtasks", "folio_activities", "folio_ideas", "folio_milestones", "folio_tasks", "folio_projects"]) {
    await q(`delete from ${t} where user_id = $1`, [userId]).catch(() => q(`delete from ${t} where user_id = $1`, [userId]));
  }
  console.log("session ready, workspace cleared");
  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
