#!/usr/bin/env node
// Verifies that DATABASE_URL points at a reachable PostgreSQL server whose
// credentials are accepted. Read-only: it only runs `select 1`.
//
//   npm run db:check
//
// On failure it prints the specific cause and the exact fix, so connection
// problems can be resolved without starting the dev server.
import { loadFolioEnv, printTarget } from "./lib/env.mjs";
import { Pool } from "pg";

const applied = loadFolioEnv();
console.log("folio · database connection check");
if (applied.length) console.log(`  Env      : ${applied.join(", ")}`);

if (!process.env.DATABASE_URL) {
  console.error("\n  FAILED   : DATABASE_URL is not set.");
  console.error("  1. Copy .env.example to .env.local in the project root.");
  console.error("  2. Set DATABASE_URL to your PostgreSQL connection string");
  console.error("     (Neon: console.neon.tech → your project → Dashboard → Connect → copy the full string).");
  console.error("  3. Restart the dev server and run `npm run db:check` again.\n");
  process.exit(1);
}

printTarget(process.env.DATABASE_URL);
console.log("");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
let failure = null;
try {
  const started = Date.now();
  await pool.query("select 1");
  console.log(`  OK       : connected in ${Date.now() - started} ms. Credentials accepted.`);
} catch (error) {
  failure = error;
} finally {
  await pool.end().catch(() => {});
}

if (!failure) {
  console.log("\n  Next     : if the workspace tables are missing, run `npm run db:init`.\n");
  process.exit(0);
}

const raw = failure?.message ?? String(failure);
// AggregateError (Node multi-address connect) keeps the useful text in `errors[]`.
const aggregate = Array.isArray(failure?.errors) ? failure.errors.map((e) => e?.message ?? String(e)).filter(Boolean) : [];
const detail = [raw, ...aggregate].filter(Boolean).join(" | ") || String(failure);
const code = String(failure?.code ?? "");

if (code === "28P01" || /password authentication failed/i.test(detail)) {
  console.error("\n  FAILED   : the server rejected the password in DATABASE_URL.");
  console.error("  This is a credentials problem, not a code problem. Fix it like this:");
  console.error("    1. Neon: open console.neon.tech → your project → Dashboard → Connect →");
  console.error("       copy the FULL connection string (it includes the real password).");
  console.error("    2. If the password contains special characters, URL-encode them first:");
  console.error("         @ → %40    # → %23    % → %25    ? → %3F    / → %2F");
  console.error("    3. Put the string in .env.local as DATABASE_URL=\"postgresql://…?sslmode=require\".");
  console.error("    4. RESTART the dev server — Next.js reads .env files only at startup.");
  console.error("    5. Run `npm run db:check` again; it should print OK.");
} else if (code === "ECONNREFUSED" || code === "08001" || code === "08006") {
  console.error("\n  FAILED   : nothing is listening at that host and port.");
  console.error("  For the default local URL, start PostgreSQL first (Docker:");
  console.error("    docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres");
  console.error("  ) or point DATABASE_URL at a hosted database such as Neon.");
} else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
  console.error("\n  FAILED   : the host name in DATABASE_URL could not be resolved.");
  console.error("  Check the host part of DATABASE_URL for typos and your network connection.");
} else if (code === "3D000" || /database "[^"]+" does not exist/i.test(detail)) {
  console.error("\n  FAILED   : the database named in DATABASE_URL does not exist.");
  console.error("  Create it with your provider (Neon creates one with each project) or fix the name.");
} else if (code === "28000" || /role "[^"]+" does not exist/i.test(detail)) {
  console.error("\n  FAILED   : the database user in DATABASE_URL does not exist.");
  console.error("  Check the username (before the colon). On Neon it is usually `neondb_owner`.");
} else if (code === "ETIMEDOUT" || /timeout/i.test(detail)) {
  console.error("\n  FAILED   : the connection timed out.");
  console.error("  Check your network, firewall, or the provider's IP allowlist.");
} else if (code === "42501" || /permission denied/i.test(detail)) {
  console.error("\n  FAILED   : the database user lacks the permissions Folio needs.");
  console.error("  Connect as the database owner (on Neon: `neondb_owner`).");
} else {
  console.error("\n  FAILED   : the database could not be reached.");
}
console.error(`  Underlying error: ${detail}\n`);
process.exit(1);
