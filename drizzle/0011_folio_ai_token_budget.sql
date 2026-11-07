ALTER TABLE "folio_ai_daily_usage"
	ADD COLUMN "used_token_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "folio_ai_daily_usage"
	ADD COLUMN "reserved_token_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "folio_ai_usage_reservations"
	ADD COLUMN "reserved_token_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "folio_ai_usage_reservations"
	ADD COLUMN "used_token_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "folio_ai_tasks"
	ADD COLUMN "usage_token_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "folio_ai_usage_reservations"
SET "reserved_token_count" = 6144
WHERE "status" = 'reserved';
--> statement-breakpoint
UPDATE "folio_ai_daily_usage" AS daily
SET "reserved_token_count" = COALESCE((
	SELECT SUM(reservation."reserved_token_count")
	FROM "folio_ai_usage_reservations" AS reservation
	WHERE reservation."user_id" = daily."user_id"
		AND reservation."usage_date" = daily."usage_date"
		AND reservation."status" = 'reserved'
), 0);
--> statement-breakpoint
ALTER TABLE "folio_ai_daily_usage"
	ADD CONSTRAINT "folio_ai_daily_usage_tokens_nonnegative_chk"
	CHECK ("used_token_count" >= 0 AND "reserved_token_count" >= 0);
--> statement-breakpoint
ALTER TABLE "folio_ai_usage_reservations"
	ADD CONSTRAINT "folio_ai_reservations_tokens_nonnegative_chk"
	CHECK ("reserved_token_count" >= 0 AND "used_token_count" >= 0);
