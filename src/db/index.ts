import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  // If building for desktop static export or in CI, provide a dummy fallback so compilation passes
  if (process.env.NEXT_PUBLIC_DESKTOP_BUILD === "1" || process.env.CI) {
    databaseUrl = "postgres://dummy:dummy@localhost:5432/dummy";
  } else {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local in the project root and set DATABASE_URL " +
      "to your PostgreSQL connection string (Neon: Dashboard → Connect → copy the full string). " +
      "Then restart the dev server. You can verify a connection string with `npm run db:check` — see DATABASE_SETUP.md.",
    );
  }
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
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: withVerifiedTls(databaseUrl),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);