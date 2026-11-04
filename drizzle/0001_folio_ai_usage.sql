CREATE TABLE "folio_ai_daily_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"completed_message_count" integer DEFAULT 0 NOT NULL,
	"reserved_message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folio_ai_daily_usage_counts_nonnegative_chk" CHECK ("folio_ai_daily_usage"."completed_message_count" >= 0 AND "folio_ai_daily_usage"."reserved_message_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "folio_ai_usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "folio_ai_reservations_status_chk" CHECK ("folio_ai_usage_reservations"."status" in ('reserved', 'completed', 'failed', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "folio_ai_daily_usage" ADD CONSTRAINT "folio_ai_daily_usage_user_id_folio_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_ai_usage_reservations" ADD CONSTRAINT "folio_ai_usage_reservations_user_id_folio_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "folio_ai_daily_usage_user_date_idx" ON "folio_ai_daily_usage" USING btree ("user_id","usage_date");--> statement-breakpoint
CREATE INDEX "folio_ai_daily_usage_date_idx" ON "folio_ai_daily_usage" USING btree ("usage_date");--> statement-breakpoint
CREATE UNIQUE INDEX "folio_ai_reservations_user_generation_idx" ON "folio_ai_usage_reservations" USING btree ("user_id","generation_id");--> statement-breakpoint
CREATE INDEX "folio_ai_reservations_expiry_idx" ON "folio_ai_usage_reservations" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "folio_ai_reservations_user_date_idx" ON "folio_ai_usage_reservations" USING btree ("user_id","usage_date");