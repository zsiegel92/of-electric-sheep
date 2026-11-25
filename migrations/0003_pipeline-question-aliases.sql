CREATE TABLE "pipeline_question_aliases" (
	"pipeline_id" uuid NOT NULL,
	"question_name" text NOT NULL,
	"alias" text NOT NULL,
	CONSTRAINT "pipeline_question_aliases_pk" PRIMARY KEY("pipeline_id","question_name")
);
ALTER TABLE "pipeline_question_aliases" ADD CONSTRAINT "pipeline_question_aliases_question_fk" FOREIGN KEY ("pipeline_id","question_name") REFERENCES "public"."decision_pipeline_questions"("pipeline_id","name") ON DELETE cascade ON UPDATE no action;