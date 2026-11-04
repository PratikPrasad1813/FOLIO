CREATE TABLE "folio_ai_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assistant_name" text DEFAULT 'Folio AI' NOT NULL,
	"presentation" text DEFAULT 'neutral' NOT NULL,
	"style" text DEFAULT 'friendly' NOT NULL,
	"model_preference" text DEFAULT 'automatic' NOT NULL,
	"selected_model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folio_ai_preferences_presentation_chk" CHECK ("folio_ai_preferences"."presentation" in ('feminine', 'masculine', 'neutral', 'custom')),
	CONSTRAINT "folio_ai_preferences_style_chk" CHECK ("folio_ai_preferences"."style" in ('professional', 'friendly', 'concise', 'motivational', 'calm')),
	CONSTRAINT "folio_ai_preferences_model_chk" CHECK ("folio_ai_preferences"."model_preference" in ('automatic', 'lightweight', 'balanced', 'high'))
);
--> statement-breakpoint
ALTER TABLE "folio_ai_preferences" ADD CONSTRAINT "folio_ai_preferences_user_id_folio_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "folio_ai_preferences_user_idx" ON "folio_ai_preferences" USING btree ("user_id");