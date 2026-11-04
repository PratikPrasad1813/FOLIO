CREATE TABLE IF NOT EXISTS "folio_ai_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"reservation_id" uuid,
	"user_message_id" uuid,
	"assistant_message_id" uuid,
	"prompt" text NOT NULL,
	"model_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'Queued' NOT NULL,
	"partial_content" text DEFAULT '' NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"plan" jsonb,
	"results" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folio_ai_tasks_status_chk" CHECK ("folio_ai_tasks"."status" in ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "folio_ai_tasks" ADD CONSTRAINT "folio_ai_tasks_user_id_folio_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_ai_tasks" ADD CONSTRAINT "folio_ai_tasks_conversation_id_folio_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."folio_ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_ai_tasks" ADD CONSTRAINT "folio_ai_tasks_reservation_id_folio_ai_usage_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."folio_ai_usage_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folio_ai_tasks_user_generation_idx" ON "folio_ai_tasks" USING btree ("user_id","generation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_ai_tasks_conversation_idx" ON "folio_ai_tasks" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_ai_tasks_user_status_idx" ON "folio_ai_tasks" USING btree ("user_id","status","heartbeat_at");
