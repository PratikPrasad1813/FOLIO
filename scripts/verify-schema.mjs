#!/usr/bin/env node
// Read-only verification of a Folio database.
//
//   node --env-file=.env.local scripts/verify-schema.mjs
//
// Compares the live database against the Drizzle schema definitions in
// src/db/schema.ts — introspected at runtime, so it can never drift from the
// schema the application actually uses.
//
// This script NEVER writes to the database.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadFolioEnv, printTarget } from "./lib/env.mjs";

const require = createRequire(import.meta.url);

/** Introspects the Drizzle schema to get the exact expected tables/columns. */
function expectedFromSchema(root = process.cwd()) {
  require(resolve(root, "scripts/folio-test-loader.cjs"));
  const schema = require(resolve(root, "src/db/schema.ts"));
  const { getTableName, getTableColumns, isTable } = require("drizzle-orm");
  const tables = new Map();
  for (const table of Object.values(schema)) {
    if (!isTable(table)) continue;
    const name = String(getTableName(table)).replace(/^public\./, "");
    // Use each column's SQL name (`user_id`), not its TypeScript property key
    // (`userId`), so the comparison matches information_schema.columns.
    tables.set(name, new Set(Object.values(getTableColumns(table)).map((column) => column.name)));
  }
  return tables;
}

async function main() {
  loadFolioEnv();
  if (!process.env.DATABASE_URL) {
    console.error("\n  DATABASE_URL is not set. Run:");
    console.error("    node --env-file=.env.local scripts/verify-schema.mjs\n");
    process.exitCode = 1;
    return;
  }

  const expected = expectedFromSchema();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const problems = [];
  let ok = true;

  try {
    console.log("folio · schema verification (read-only)");
    printTarget(process.env.DATABASE_URL);
    console.log("");

    const { rows: tableRows } = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
    );
    const present = new Set(tableRows.map((row) => row.table_name));

    const { rows: columnRows } = await client.query(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position",
    );
    const columnsByTable = new Map();
    for (const row of columnRows) {
      if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set());
      columnsByTable.get(row.table_name).add(row.column_name);
    }

    console.log(`  Expected tables (${expected.size})`);
    for (const [table, columns] of [...expected].sort()) {
      if (!present.has(table)) {
        ok = false;
        problems.push(`missing table: ${table}`);
        console.log(`    x ${table.padEnd(34)} MISSING`);
        continue;
      }
      const live = columnsByTable.get(table) ?? new Set();
      const missing = [...columns].filter((column) => !live.has(column));
      if (missing.length) {
        ok = false;
        problems.push(`${table}: missing column(s) ${missing.join(", ")}`);
        console.log(`    x ${table.padEnd(34)} missing column(s): ${missing.join(", ")}`);
      } else {
        console.log(`    + ${table.padEnd(34)} ${columns.size} column(s)`);
      }
    }

    const extra = [...present].filter((table) => !expected.has(table)).sort();
    if (extra.length) console.log(`\n  Additional tables in "public" (not part of Folio's schema): ${extra.join(", ")}`);

    const { rows: fkRows } = await client.query(`
      select tc.table_name, kcu.column_name, ccu.table_name as foreign_table
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
      order by tc.table_name
    `);
    const userRefs = fkRows.filter((row) => row.foreign_table === "folio_users").length;
    console.log(`\n  Foreign keys : ${fkRows.length} total, ${userRefs} reference folio_users`);

    const { rows: neonRows } = await client.query(
      "select table_name from information_schema.tables where table_schema = 'neon_auth' order by table_name",
    );
    console.log(`  neon_auth    : ${neonRows.length ? `${neonRows.length} Neon-managed table(s) present, untouched` : "not enabled yet"}`);

    const journal = await client
      .query("select count(*)::int as count from drizzle.__drizzle_migrations")
      .then((result) => result.rows[0].count)
      .catch(() => 0);
    console.log(`  Journal     : ${journal} migration(s) applied`);

    console.log("");
    if (ok) {
      console.log("  + Schema matches the Drizzle definitions.\n");
    } else {
      console.log("  x Schema does not match. Run `node scripts/init-database.mjs` to apply the missing parts.\n");
      for (const problem of problems) console.log(`    - ${problem}`);
      console.log("");
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("\n  Verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
