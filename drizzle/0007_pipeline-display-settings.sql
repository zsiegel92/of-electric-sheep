ALTER TABLE "decision_pipelines" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "decision_pipelines" ADD COLUMN "ui_ignored" boolean DEFAULT false NOT NULL;