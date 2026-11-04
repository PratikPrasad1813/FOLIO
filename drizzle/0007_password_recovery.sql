-- Additive only: existing users, identities, sessions and neon_auth remain untouched.
CREATE TABLE IF NOT EXISTS "folio_password_resets" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."folio_users"("id") ON DELETE cascade,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_password_resets_user_idx" ON "folio_password_resets" ("user_id");
