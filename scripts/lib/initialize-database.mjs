// The canonical Folio database initialisation routine.
//
//   Layer 1  base application schema  (src/db/base-schema-statements.json)
//   Layer 2  Drizzle journal          (drizzle/*.sql)
//
// Layer 2's first migration references the Layer 1 tables, so Layer 1 must run
// first on an empty database. Both layers are idempotent.
//
// Everything runs on ONE dedicated connection so the advisory lock covers the
// whole operation, which is safe with Neon's transaction pooling.
//
// The Neon-managed `neon_auth` schema is never created, altered or dropped.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

export const LOCK_KEY = 72_031_917;

export function readBaseSchemaStatements(root = process.cwd()) {
  const raw = readFileSync(resolve(root, "src/db/base-schema-statements.json"), "utf8");
  const statements = JSON.parse(raw);
  if (!Array.isArray(statements) || !statements.length) throw new Error("src/db/base-schema-statements.json is empty or malformed.");
  return statements;
}

/** Reads the current state without changing anything. */
export async function readState(client) {
  const files = readMigrationFiles({ migrationsFolder: resolve(process.cwd(), "drizzle") });
  const latest = files[files.length - 1];
  const { rows: [tables] } = await client.query(
    "select to_regclass('public.folio_users') is not null as base, to_regclass('drizzle.__drizzle_migrations') is not null as journal",
  );
  let applied = null;
  if (tables?.journal) {
    const { rows } = await client.query("select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1");
    applied = rows[0]?.created_at ? Number(rows[0].created_at) : null;
  }
  return {
    base: Boolean(tables?.base),
    journal: Boolean(tables?.journal),
    latestFolderMillis: latest?.folderMillis ?? null,
    appliedFolderMillis: applied,
    current: Boolean(tables?.base && tables?.journal && applied !== null && latest?.folderMillis !== null && applied >= latest.folderMillis),
    journalEntries: files.map(file => ({ tag: file.folderMillis === latest?.folderMillis ? "latest" : "", sql: file.sql.length })),
  };
}

/** Lists the public tables currently present (read-only). */
export async function listTables(client) {
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  return rows.map(row => row.table_name);
}

/** Reports whether Neon's managed auth schema is present (read-only, never modified). */
export async function detectNeonAuth(client) {
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'neon_auth' order by table_name",
  );
  return rows.map(row => row.table_name);
}

/**
 * Applies Layer 1 then Layer 2 on one dedicated connection.
 * Safe to re-run: both layers are idempotent and nothing is dropped.
 */
export async function initializeDatabase({ root = process.cwd(), log = console.log } = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required. Add it to .env.local (or pass --env-file=.env.local).");

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      const before = await readState(client);
      log(`  Before   : base schema ${before.base ? "present" : "missing"}, journal ${before.journal ? "present" : "missing"}, up to date ${before.current ? "yes" : "no"}`);

      let baseApplied = false;
      if (!before.base) {
        log("  Layer 1  : creating the base application schema…");
        const statements = readBaseSchemaStatements(root);
        await client.query("begin");
        try {
          for (const statement of statements) await client.query(statement);
          await client.query("commit");
          baseApplied = true;
        } catch (error) {
          await client.query("rollback").catch(() => {});
          throw error;
        }
        log(`  Layer 1  : applied ${statements.length} idempotent statements.`);
      } else {
        log("  Layer 1  : already present — skipped.");
      }

      log("  Layer 2  : applying the Drizzle journal…");
      await migrate(drizzle(client), { migrationsFolder: resolve(root, "drizzle") });
      const after = await readState(client);
      log(`  Layer 2  : journal now ${after.current ? "up to date" : "incomplete"}.`);

      return { before, after, baseApplied, journalApplied: !before.current };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
    await pool.end();
  }
}
