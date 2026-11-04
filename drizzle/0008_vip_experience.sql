-- Additive VIP experience migration: email verification, welcome email idempotency, and persistent first-login guide state.
ALTER TABLE "folio_users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "folio_users" ADD COLUMN IF NOT EXISTS "welcome_email_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "folio_users" ADD COLUMN IF NOT EXISTS "guide_dismissed_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folio_email_verifications" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "email" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "folio_email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_email_verifications_user_idx" ON "folio_email_verifications" USING btree ("user_id");
