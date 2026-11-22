CREATE TABLE "decision_trace_annotations" (
	"pipeline_id" uuid NOT NULL,
	"trace_id" text NOT NULL,
	"question_name" text NOT NULL,
	"choice_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_trace_annotations_pk" PRIMARY KEY("pipeline_id","trace_id","question_name")
);
--> statement-breakpoint
ALTER TABLE "decision_trace_annotations" ADD CONSTRAINT "decision_trace_annotations_question_fk" FOREIGN KEY ("pipeline_id","question_name") REFERENCES "public"."decision_pipeline_questions"("pipeline_id","name") ON DELETE cascade ON UPDATE no action;