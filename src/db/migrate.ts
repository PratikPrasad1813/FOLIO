import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { DatabaseUnavailableError, describeDatabaseError, enableMockDbMode, isConnectionFailure, isMockDbMode, pool } from "@/db";
import { BASE_SCHEMA_STATEMENTS } from "@/db/base-schema";

// Idempotent schema initialisation for Folio.
//
// A Folio database is built in two ordered layers:
//
//   1. The base application schema (`folio_users`, `folio_tasks`,
//      `folio_projects`, …) — see @/db/base-schema. These tables predate the
//      Drizzle journal and were always created by this bootstrap, so they are
//      applied with IF NOT EXISTS statements first.
//   2. The Drizzle journal in ./drizzle — the incremental migrations
//      (search & filters, AI usage, onboarding columns, the Neon Auth identity
//      link). Its first entry references the base tables, so it can only run
//      after layer 1.
//
// Both layers are idempotent, so this is safe on an empty database and on an
// existing one. The Neon-managed `neon_auth` schema is never touched.

const LOCK_KEY = 72_031_917;
let migration: Promise<void> | null = null;

export interface SchemaState {
  /** Base application tables already exist. */
  base: boolean;
  /** The Drizzle journal table exists. */
  journal: boolean;
  /** Folder timestamp of the newest journal entry, for comparison. */
  latestFolderMillis: number | null;
  /** Folder timestamp of the newest applied journal entry. */
  appliedFolderMillis: number | null;
  /** True when the database already matches the newest journal entry. */
  current: boolean;
}

type QueryRunner = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** Reads the current schema state without modifying anything. */
export async function readSchemaState(runner?: QueryRunner): Promise<SchemaState> {
  const files = readMigrationFiles({ migrationsFolder: "./drizzle" });
  const latest = files[files.length - 1];
  const client = runner ?? pool;
  const { rows: [tables] } = (await client.query(
    "select to_regclass('public.folio_users') is not null as base, to_regclass('drizzle.__drizzle_migrations') is not null as journal",
  )) as { rows: { base: boolean; journal: boolean }[] };
  let appliedFolderMillis: number | null = null;
  if (tables?.journal) {
    const { rows: [applied] } = (await client.query(
      "select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1",
    )) as { rows: { created_at: string }[] };
    appliedFolderMillis = applied?.created_at ? Number(applied.created_at) : null;
  }
  const latestFolderMillis = latest?.folderMillis ?? null;
  return {
    base: Boolean(tables?.base),
    journal: Boolean(tables?.journal),
    latestFolderMillis,
    appliedFolderMillis,
    current: Boolean(
      tables?.base &&
        tables?.journal &&
        appliedFolderMillis !== null &&
        latestFolderMillis !== null &&
        appliedFolderMillis >= latestFolderMillis,
    ),
  };
}

/**
 * Applies the base schema, then the Drizzle journal, on ONE dedicated
 * connection.
 *
 * Using a single connection matters: `migrate()` works against the root
 * session, so running it inside a pooled `db.transaction()` would open a second
 * connection and the advisory lock would not cover it. A session-level
 * advisory lock on the dedicated connection covers both layers and is released
 * explicitly, which also works with Neon's transaction pooling.
 */
export async function applySchema(): Promise<{
  state: SchemaState;
  baseApplied: boolean;
  journalApplied: boolean;
}> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      const before = await readSchemaState(client);
      let baseApplied = false;
      if (!before.base) {
        // One transaction for the whole base schema: all-or-nothing.
        await client.query("begin");
        try {
          for (const statement of BASE_SCHEMA_STATEMENTS) await client.query(statement);
          await client.query("commit");
          baseApplied = true;
        } catch (error) {
          await client.query("rollback").catch(() => {});
          throw error;
        }
      }
      await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
      const after = await readSchemaState(client);
      return { state: after, baseApplied, journalApplied: !before.current };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

async function run() {
  const state = await readSchemaState();
  // Normal cold starts perform a read-only journal check and nothing else, so
  // they never take locks or run DDL against a live database.
  if (state.current) return;
  await applySchema();
}

export function ensureSchema() {
  if (isMockDbMode()) {
    return Promise.resolve();
  }
  if (!migration) {
    migration = run().catch((error) => {
      if (isConnectionFailure(error)) {
        enableMockDbMode();
        return;
      }
      // Allow a later request to retry once the environment is fixed.
      migration = null;
      // Connection and credential problems arrive as a classified, actionable
      // error instead of a raw driver message (see DATABASE_SETUP.md).
      throw error instanceof DatabaseUnavailableError ? error : describeDatabaseError(error);
    });
  }
  return migration;
}
