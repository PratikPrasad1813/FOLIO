CREATE TABLE "folio_desktop_auth_handoffs" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "folio_auth_flows" ADD COLUMN "desktop" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "folio_desktop_auth_handoffs" ADD CONSTRAINT "folio_desktop_auth_handoffs_user_id_folio_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."folio_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folio_desktop_auth_handoffs_expiry_idx" ON "folio_desktop_auth_handoffs" USING btree ("expires_at");