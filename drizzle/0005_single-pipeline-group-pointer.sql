ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_user_id_primary_group_key" UNIQUE("user_id","id","primary_grouped_pipeline_id");--> statement-breakpoint
ALTER TABLE "decision_pipelines" DROP CONSTRAINT "decision_pipelines_primary_grouped_pipeline_fk";--> statement-breakpoint
-- Match the member's pointer against both the target's ID and its own pointer.
ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_primary_grouped_pipeline_fk" FOREIGN KEY ("user_id","primary_grouped_pipeline_id","primary_grouped_pipeline_id") REFERENCES "public"."decision_pipelines"("user_id","id","primary_grouped_pipeline_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pipelines" DROP CONSTRAINT "decision_pipelines_user_canonical_pipeline_id_key";--> statement-breakpoint
ALTER TABLE "decision_pipelines" DROP COLUMN "canonical_pipeline_id";
