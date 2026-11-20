CREATE TABLE "decision_pipeline_definitions" (
	"pipeline_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"options" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_pipeline_questions" (
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"system_prompt" jsonb,
	"criteria" jsonb,
	CONSTRAINT "decision_pipeline_questions_pipeline_id_name_pk" PRIMARY KEY("pipeline_id","name")
);
--> statement-breakpoint
ALTER TABLE "decision_pipelines" ADD COLUMN "primary_grouped_pipeline_id" uuid;--> statement-breakpoint
UPDATE "decision_pipelines" SET "primary_grouped_pipeline_id" = "id";--> statement-breakpoint
ALTER TABLE "decision_pipelines" ALTER COLUMN "primary_grouped_pipeline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_user_id_id_key" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "decision_pipeline_definitions" ADD CONSTRAINT "decision_pipeline_definitions_pipeline_id_decision_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."decision_pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pipeline_questions" ADD CONSTRAINT "decision_pipeline_questions_pipeline_id_decision_pipeline_definitions_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."decision_pipeline_definitions"("pipeline_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_primary_grouped_pipeline_fk" FOREIGN KEY ("user_id","primary_grouped_pipeline_id") REFERENCES "public"."decision_pipelines"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "decision_pipeline_definitions" ("pipeline_id", "model", "options")
SELECT "id", "definition"->>'model', "definition"->'options'
FROM "decision_pipelines";--> statement-breakpoint
INSERT INTO "decision_pipeline_questions" ("pipeline_id", "name", "type", "system_prompt", "criteria")
SELECT "id", question.key, question.value->>'type', question.value->'instructions', question.value->'criteria'
FROM "decision_pipelines"
CROSS JOIN LATERAL jsonb_each("definition"->'questions') AS question;--> statement-breakpoint
ALTER TABLE "decision_pipelines" DROP COLUMN "definition";
