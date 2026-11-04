-- Additive only: safe on an existing Folio database. Drizzle records this
-- migration in drizzle.__drizzle_migrations; IF NOT EXISTS also supports
-- installations that previously synchronized the schema with drizzle-kit push.
CREATE TABLE IF NOT EXISTS "folio_recent_searches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "folio_users"("id") ON DELETE CASCADE,
  "query" text NOT NULL,
  "query_key" text NOT NULL,
  "scope" text DEFAULT 'all' NOT NULL,
  "last_used_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folio_recent_searches_unique_idx" ON "folio_recent_searches" ("user_id", "query_key", "scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_recent_searches_recent_idx" ON "folio_recent_searches" ("user_id", "last_used_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folio_saved_filters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "folio_users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "name_key" text NOT NULL,
  "config" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folio_saved_filters_unique_idx" ON "folio_saved_filters" ("user_id", "kind", "name_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_projects_filter_idx" ON "folio_projects" ("user_id", "archived", "status", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_tasks_filter_idx" ON "folio_tasks" ("user_id", "status", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_tasks_project_progress_idx" ON "folio_tasks" ("user_id", "project_id", "completed");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_projects_search_idx" ON "folio_projects" USING gin (to_tsvector('simple', "name" || ' ' || "description" || ' ' || "category"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_tasks_search_idx" ON "folio_tasks" USING gin (to_tsvector('simple', "title" || ' ' || "description" || ' ' || "notes"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_ideas_search_idx" ON "folio_ideas" USING gin (to_tsvector('simple', "title" || ' ' || "description" || ' ' || "category"));
