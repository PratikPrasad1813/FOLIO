ALTER TABLE "folio_projects" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "folio_tasks" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'folio_milestones' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE "folio_milestones" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
    UPDATE "folio_milestones" SET "updated_at" = COALESCE("completed_at", "created_at");
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "folio_milestones" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'folio_subtasks' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE "folio_subtasks" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
    UPDATE "folio_subtasks" SET "updated_at" = COALESCE("completed_at", "created_at");
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "folio_subtasks" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'folio_ideas' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE "folio_ideas" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
    UPDATE "folio_ideas" SET "updated_at" = "created_at";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "folio_ideas" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_projects_sync_idx" ON "folio_projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_tasks_sync_idx" ON "folio_tasks" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_ideas_sync_idx" ON "folio_ideas" USING btree ("user_id","updated_at");
