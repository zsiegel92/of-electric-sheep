CREATE TABLE "decision_traces" (
	"pipeline_id" uuid NOT NULL,
	"trace_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text,
	"failed" boolean DEFAULT false NOT NULL,
	"state" jsonb,
	"answers" jsonb,
	"usage" jsonb,
	"min_confidence" double precision,
	"average_confidence" double precision,
	"observability_url" text,
	"payload_truncated" boolean DEFAULT false NOT NULL,
	"historical_placeholder" boolean DEFAULT false NOT NULL,
	CONSTRAINT "decision_traces_pk" PRIMARY KEY("pipeline_id","trace_id")
);
ALTER TABLE "decision_traces" ADD CONSTRAINT "decision_traces_pipeline_id_decision_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."decision_pipelines"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "decision_traces_id_idx" ON "decision_traces" USING btree ("trace_id");
CREATE INDEX "decision_traces_recent_idx" ON "decision_traces" USING btree ("pipeline_id","started_at" DESC NULLS LAST,"trace_id" DESC NULLS LAST);
-- Keep previously saved annotations attached to a trace even when the old payload is unavailable.
INSERT INTO "decision_traces" ("pipeline_id", "trace_id", "started_at", "historical_placeholder")
SELECT "pipeline_id", "trace_id", min("updated_at"), true
FROM "decision_trace_annotations"
GROUP BY "pipeline_id", "trace_id";
ALTER TABLE "decision_trace_annotations" ADD CONSTRAINT "decision_trace_annotations_trace_fk" FOREIGN KEY ("pipeline_id","trace_id") REFERENCES "public"."decision_traces"("pipeline_id","trace_id") ON DELETE cascade ON UPDATE no action;