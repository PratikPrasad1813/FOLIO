#!/usr/bin/env node
// Seeds a demo user's workspace with the Indian demo data by invoking the
// app's own seedWorkspace through the project TS loader.
//   node scripts/seed-demo-user.mjs [email]
import { createRequire } from "node:module";
import { resolve } from "node:path";
import pkg from "pg";
import { loadFolioEnv } from "./lib/env.mjs";

loadFolioEnv();
const { Pool } = pkg;
const email = process.argv[2] ?? "aarav@folio.demo";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query("select id from folio_users where email = $1", [email]);
if (!rows[0]) { console.error("user not found:", email); process.exit(1); }
const userId = rows[0].id;
await pool.end();

const load = createRequire(import.meta.url)("./folio-test-loader.cjs");
const { db, pool: pool2 } = load(resolve("src/db/index.ts"));
const { seedWorkspace } = load(resolve("src/lib/seed.ts"));
await seedWorkspace(userId);
const check = await db.execute(`select count(*)::int as c from folio_projects where user_id = '${userId}'`);
console.log("seeded", email, "— project rows:", check.rows?.[0]?.c ?? "ok");
await pool2.end();
