#!/usr/bin/env node
// Initialise a Folio database (fresh Neon project, or an existing one).
//
//   node --env-file=.env.local scripts/init-database.mjs
//
// Order of operations:
//   1. base application schema  (src/db/base-schema.json)  — 16 tables
//   2. Drizzle journal          (drizzle/*.sql)            — incremental changes
//
// Nothing is dropped, reset or deleted. The Neon-managed `neon_auth` schema is
// left completely untouched.
import { loadFolioEnv, printTarget } from "./lib/env.mjs";
import { detectNeonAuth, initializeDatabase, listTables } from "./lib/initialize-database.mjs";
import { Pool } from "pg";

const applied = loadFolioEnv();
console.log("folio · database initialisation");
if (applied.length) console.log(`  Env      : ${applied.join(", ")}`);
if (!process.env.DATABASE_URL) {
  console.error("\n  DATABASE_URL is not set. Add it to .env.local, or run:");
  console.error("    node --env-file=.env.local scripts/init-database.mjs\n");
  process.exit(1);
}
printTarget(process.env.DATABASE_URL);
console.log("");

const result = await initializeDatabase();

// Read-only confirmation of what now exists.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const client = await pool.connect();
  const tables = await listTables(client);
  const neonAuth = await detectNeonAuth(client);
  client.release();
  console.log("");
  console.log(`  Tables   : ${tables.length} present in schema "public"`);
  console.log(`  Journal  : ${result.after.current ? "up to date" : "NOT up to date — rerun this command"}`);
  if (neonAuth.length) {
    console.log(`  neon_auth: ${neonAuth.length} Neon-managed table(s) detected and left untouched.`);
  } else {
    console.log("  neon_auth: not present (not required by Folio).");
  }
  console.log("\n  Done. Run `node scripts/verify-schema.mjs` for a full column-level check.\n");
} finally {
  await pool.end();
}
