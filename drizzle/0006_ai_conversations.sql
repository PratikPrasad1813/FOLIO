CREATE TABLE "folio_ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folio_ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"generation_id" text,
	"generation_status" text,
	"plan" jsonb,
	"results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folio_ai_messages_role_chk" CHECK ("folio_ai_messages"."role" in ('user', 'assistant')),
	CONSTRAINT "folio_ai_messages_status_chk" CHECK ("folio_ai_messages"."generation_status" is null or "folio_ai_messages"."generation_status" in ('complete', 'cancelled', 'error'))
);
--> statement-breakpoint
ALTER TABLE "folio_ai_conversations" ADD CONSTRAINT "folio_ai_conversations_user_id_folio_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_ai_messages" ADD CONSTRAINT "folio_ai_messages_user_id_folio_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_ai_messages" ADD CONSTRAINT "folio_ai_messages_conversation_id_folio_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."folio_ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folio_ai_conversations_user_idx" ON "folio_ai_conversations" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "folio_ai_messages_conversation_idx" ON "folio_ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "folio_ai_messages_user_idx" ON "folio_ai_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "folio_ai_messages_generation_idx" ON "folio_ai_messages" USING btree ("user_id","generation_id");