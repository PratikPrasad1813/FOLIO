import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * LAZY-INIT CONTRACT (desktop-build post-mortem): this module must NEVER throw
 * at import time. `next build` evaluates every route module during "Collecting
 * page data" — including the statically exported desktop routes, whose module
 * graph pulls in `@/lib/auth` → `@/db` even though the desktop runtime never
 * queries PostgreSQL (it reads SQLite through @tauri-apps/plugin-sql). A
 * module-scope throw when DATABASE_URL is unset therefore killed
 * `build:desktop` on CI machines that have no .env.local:
 *
 *   Error: Failed to collect page data for /[view]
 *   [cause]: Error: DATABASE_URL is not set. … at src/db/index.ts
 *
 * The pool and the Drizzle handle below are created on FIRST USE instead:
 * importing `@/db` is always safe, and a genuinely missing DATABASE_URL
 * surfaces as a descriptive DatabaseUnavailableError at query time — where
 * currentUserSafe() and the API routes already know how to report it calmly.
 */
export type FolioDatabase = NodePgDatabase<Record<string, never>>;

/** Resolves DATABASE_URL on demand — the only place a missing value throws. */
function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new DatabaseUnavailableError(
      "DATABASE_URL is not set. Copy .env.example to .env.local in the project root and set DATABASE_URL " +
      "to your PostgreSQL connection string (Neon: Dashboard → Connect → copy the full string). " +
      "Then restart the dev server. You can verify a connection string with `npm run db:check` — see DATABASE_SETUP.md.",
      "Set DATABASE_URL in .env.local (Neon: Dashboard → Connect → copy the full string), restart the dev server, and verify it with `npm run db:check` — see DATABASE_SETUP.md → Troubleshooting.",
    );
  }
  return databaseUrl;
}

/**
 * node-postgres currently treats the SSL modes `prefer`, `require` and
 * `verify-ca` as aliases of `verify-full`, but emits a deprecation warning and
 * announces weaker libpq semantics for its next major version. Upgrading those
 * modes explicitly to `verify-full` keeps exactly today's verified-TLS behavior
 * and silences the warning. Connection strings without those modes (local
 * development, `disable`, `no-verify`) are returned untouched.
 */
function withVerifiedTls(url: string): string {
  return url.replace(/([?&])sslmode=(?:prefer|require|verify-ca)\b/i, "$1sslmode=verify-full");
}

export class DatabaseUnavailableError extends Error {
  /** Concrete, operator-facing steps to resolve the problem. */
  readonly hint: string;
  constructor(message: string, hint: string, cause?: unknown) {
    super(message);
    this.name = "DatabaseUnavailableError";
    this.hint = hint;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Translates raw PostgreSQL/driver failures into a calm message plus concrete
 * fix steps. Pg errors never include the password itself, so the details are
 * safe to surface on auth screens.
 */
export function describeDatabaseError(error: unknown): DatabaseUnavailableError {
  const raw = error instanceof Error ? error.message : String(error);
  // Node's multi-address connect rejects with an AggregateError whose top-level
  // message is empty; the useful text lives in its `errors` array.
  const subErrors = Array.isArray((error as { errors?: unknown })?.errors)
    ? (error as { errors: unknown[] }).errors.map((e) => (e instanceof Error ? e.message : String(e))).filter(Boolean)
    : [];
  const detail = [raw, ...subErrors].filter(Boolean).join(" | ");
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  const underlying = `Underlying error: ${detail || raw}`;

  if (code === "28P01" || /password authentication failed/i.test(detail)) {
    return new DatabaseUnavailableError(
      "The database rejected the sign-in: the password in DATABASE_URL is not valid for this PostgreSQL server.",
      "Fix: copy a fresh connection string from your database provider (Neon: console.neon.tech → your project → Dashboard → Connect → copy the full string). URL-encode special characters in the password first (@ → %40, # → %23, % → %25, ? → %3F, / → %2F). Put it in .env.local as DATABASE_URL, restart the dev server, and verify with `npm run db:check`. See DATABASE_SETUP.md → Troubleshooting.",
      error,
    );
  }
  if (code === "28000" || /role "[^"]+" does not exist/i.test(detail)) {
    return new DatabaseUnavailableError(
      "The database user in DATABASE_URL does not exist on this PostgreSQL server.",
      "Fix: check the username part of DATABASE_URL (the segment before the colon). On Neon it is usually `neondb_owner`. Then restart the dev server and run `npm run db:check`.",
      error,
    );
  }
  if (code === "3D000" || /database "[^"]+" does not exist/i.test(detail)) {
    return new DatabaseUnavailableError(
      "The database named in DATABASE_URL does not exist on this PostgreSQL server.",
      "Fix: create the database (Neon creates it with the project) or correct the name after the slash in DATABASE_URL. Then restart the dev server and run `npm run db:check`.",
      error,
    );
  }
  if (code === "ECONNREFUSED" || code === "08001" || code === "08006") {
    return new DatabaseUnavailableError(
      "Nothing is listening at the host and port in DATABASE_URL.",
      "Fix: for local development, start PostgreSQL first (Docker: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres`). For hosted databases, verify the host and port in DATABASE_URL. Then restart the dev server and run `npm run db:check`.",
      error,
    );
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new DatabaseUnavailableError(
      "The host name in DATABASE_URL could not be resolved.",
      "Fix: check the host part of DATABASE_URL for typos and confirm your network can reach the provider. Then restart the dev server and run `npm run db:check`.",
      error,
    );
  }
  if (code === "ETIMEDOUT" || /timeout/i.test(detail)) {
    return new DatabaseUnavailableError(
      "The connection to the database timed out.",
      "Fix: check your network, firewall, or the provider's IP allowlist, then run `npm run db:check`.",
      error,
    );
  }
  if (code === "42501" || /permission denied/i.test(detail)) {
    return new DatabaseUnavailableError(
      "The database user in DATABASE_URL lacks the permissions Folio needs.",
      "Fix: connect as the database owner (on Neon: `neondb_owner`), then run `npm run db:check`.",
      error,
    );
  }
  return new DatabaseUnavailableError(
    "Folio could not reach or initialize its PostgreSQL database.",
    `Fix: check DATABASE_URL in .env.local and run \`npm run db:check\`. ${underlying}`,
    error,
  );
}

const globalForDb = globalThis as typeof globalThis & {
  __folioPostgresqlPool?: Pool;
  __folioDrizzleDb?: FolioDatabase;
};

let poolInstance: Pool | null = null;
let dbInstance: FolioDatabase | null = null;

/** The shared pg Pool, created on first use — never at import time. */
export function getPool(): Pool {
  const cached = process.env.NODE_ENV !== "production" ? globalForDb.__folioPostgresqlPool : undefined;
  if (cached) return cached;
  if (!poolInstance) {
    poolInstance = new Pool({ connectionString: withVerifiedTls(requireDatabaseUrl()) });
    if (process.env.NODE_ENV !== "production") globalForDb.__folioPostgresqlPool = poolInstance;
  }
  return poolInstance;
}

/** The shared Drizzle handle, created on first use — never at import time. */
export function getDb(): FolioDatabase {
  const cached = process.env.NODE_ENV !== "production" ? globalForDb.__folioDrizzleDb : undefined;
  if (cached) return cached;
  if (!dbInstance) {
    dbInstance = drizzle(getPool());
    if (process.env.NODE_ENV !== "production") globalForDb.__folioDrizzleDb = dbInstance;
  }
  return dbInstance;
}

/**
 * Import-safe stand-ins for the old eager exports. Every existing
 * `import { db, pool } from "@/db"` keeps working unchanged: the real pool /
 * Drizzle instance is created transparently on the first property access,
 * and methods arrive pre-bound to it (drizzle's fluent builders included).
 * The `then` guard keeps the proxies from ever looking like promises, so
 * `await db` / `Promise.resolve(pool)` cannot trigger an initialization.
 */
function lazyInstance<T extends object>(init: () => T): T {
  return new Proxy({} as T, {
    get(_target: T, property: string | symbol): unknown {
      if (property === "then") return undefined;
      const instance = init() as unknown as Record<string | symbol, unknown>;
      const value = instance[property];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
    },
  });
}

export const pool: Pool = lazyInstance(getPool);
export const db: FolioDatabase = lazyInstance(getDb);
