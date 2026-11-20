ALTER TABLE "decision_pipelines" ADD COLUMN "canonical_pipeline_id" uuid GENERATED ALWAYS AS (case when "id" = "primary_grouped_pipeline_id" then "id" end) STORED;--> statement-breakpoint
-- Flatten existing chains to their self-pointing primary before validating the new foreign key.
WITH RECURSIVE "group_members" AS (
	SELECT "id", "id" AS "primary_id"
	FROM "decision_pipelines"
	WHERE "id" = "primary_grouped_pipeline_id"
	UNION ALL
	SELECT "member"."id", "group_members"."primary_id"
	FROM "decision_pipelines" AS "member"
	JOIN "group_members" ON "member"."primary_grouped_pipeline_id" = "group_members"."id"
	WHERE "member"."id" <> "group_members"."id"
)
UPDATE "decision_pipelines" AS "pipeline"
SET "primary_grouped_pipeline_id" = "group_members"."primary_id"
FROM "group_members"
WHERE "pipeline"."id" = "group_members"."id"
	AND "pipeline"."primary_grouped_pipeline_id" <> "group_members"."primary_id";
--> statement-breakpoint
ALTER TABLE "decision_pipelines" DROP CONSTRAINT "decision_pipelines_primary_grouped_pipeline_fk";--> statement-breakpoint
ALTER TABLE "decision_pipelines" DROP CONSTRAINT "decision_pipelines_user_id_id_key";--> statement-breakpoint
ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_user_canonical_pipeline_id_key" UNIQUE("user_id","canonical_pipeline_id");--> statement-breakpoint
-- Validation rejects existing cycles, which have no self-pointing primary.
ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_primary_grouped_pipeline_fk" FOREIGN KEY ("user_id","primary_grouped_pipeline_id") REFERENCES "public"."decision_pipelines"("user_id","canonical_pipeline_id") ON DELETE no action ON UPDATE no action;
