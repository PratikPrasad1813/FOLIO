#!/usr/bin/env node
// Deployment migration command. Applies every outstanding Folio schema change:
// the base application schema first, then the Drizzle journal.
//
//   node --env-file=.env.local scripts/migrate-search.mjs
//
// This replaces the previous version, which called the Drizzle migrator
// directly and therefore assumed the base tables (folio_users and friends)
// already existed — it failed on a fresh database with
// `relation "folio_users" does not exist`.
//
// Nothing is dropped, reset or deleted.
import { loadFolioEnv, printTarget } from "./lib/env.mjs";
import { initializeDatabase } from "./lib/initialize-database.mjs";

const applied = loadFolioEnv();
console.log("folio · applying schema migrations");
if (applied.length) console.log(`  Env      : ${applied.join(", ")}`);
if (!process.env.DATABASE_URL) {
  console.error("\n  DATABASE_URL is not set. Add it to .env.local, or run:");
  console.error("    node --env-file=.env.local scripts/migrate-search.mjs\n");
  process.exit(1);
}
printTarget(process.env.DATABASE_URL);
console.log("");

const result = await initializeDatabase();
console.log("");
console.log(`  Base schema : ${result.baseApplied ? "created" : "already present"}`);
console.log(`  Journal     : ${result.journalApplied ? "applied" : "already up to date"}`);
console.log(`  Status      : ${result.after.current ? "up to date" : "INCOMPLETE — rerun this command"}`);
console.log("\n  Existing Folio records preserved.\n");
