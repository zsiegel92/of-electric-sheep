DROP INDEX "decision_pipelines_user_definition_idx";--> statement-breakpoint
ALTER TABLE "decision_pipelines" ADD COLUMN "accepts_request" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_pipelines_user_definition_idx" ON "decision_pipelines" USING btree ("user_id","definition_hash") WHERE "decision_pipelines"."accepts_request";