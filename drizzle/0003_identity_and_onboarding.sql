CREATE TABLE "folio_auth_flows" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"browser_hash" text NOT NULL,
	"provider" text NOT NULL,
	"verifier_enc" text NOT NULL,
	"return_to" text NOT NULL,
	"link_user_id" uuid,
	"link_session_hash" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folio_auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folio_auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "folio_users" ADD COLUMN "personal" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "folio_users" ADD COLUMN "onboarding_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "folio_users" ADD COLUMN "onboarding_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "folio_users" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "folio_auth_flows" ADD CONSTRAINT "folio_auth_flows_link_user_id_folio_users_id_fk" FOREIGN KEY ("link_user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_auth_identities" ADD CONSTRAINT "folio_auth_identities_user_id_folio_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folio_auth_flows_expiry_idx" ON "folio_auth_flows" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "folio_auth_identity_subject_idx" ON "folio_auth_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "folio_auth_identity_user_idx" ON "folio_auth_identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "folio_auth_rate_reset_idx" ON "folio_auth_rate_limits" USING btree ("reset_at");
--> statement-breakpoint
-- Preserve direct workspace access for every account that predates this
-- migration. New accounts have NULL completion and follow onboarding.
UPDATE "folio_users" SET "onboarding_completed_at" = "created_at" AT TIME ZONE 'UTC', "onboarding_step" = 10 WHERE "onboarding_completed_at" IS NULL;
