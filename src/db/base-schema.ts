/**
 * Folio's original application schema, expressed as idempotent SQL.
 *
 * These statements predate the Drizzle journal: the base tables were created
 * by this bootstrap rather than by a versioned migration file. They are kept
 * verbatim so that:
 *   - an EMPTY database (for example a fresh Neon project) can be initialised,
 *   - an existing database converges on the same shape,
 *   - and the application and the operator scripts share one definition.
 *
 * Every statement is safe to re-run:
 *   - tables and indexes use IF NOT EXISTS,
 *   - foreign keys are added through a DO block that swallows duplicate_object,
 *   - column additions use ADD COLUMN IF NOT EXISTS.
 *
 * The Drizzle journal in ./drizzle then applies the incremental changes
 * (search & filters, AI usage, onboarding columns, the Neon Auth identity link).
 *
 * The SQL lives in base-schema-statements.json so the Node-based operator scripts
 * (scripts/init-database.mjs, scripts/verify-schema.mjs) can read exactly the
 * same statements without a TypeScript loader.
 */
import baseSchema from "./base-schema-statements.json";

export const BASE_SCHEMA_STATEMENTS: string[] = baseSchema as string[];
