CREATE FUNCTION public.system_one_answer_shape(question_type text, criteria jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
	SELECT encode(sha256(convert_to(jsonb_build_array(
		question_type,
		CASE question_type
			WHEN 'choice' THEN (
				SELECT jsonb_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(criteria) AS key
			)
			WHEN 'score' THEN to_jsonb(jsonb_array_length(criteria))
		END
	)::text, 'UTF8')), 'hex')
$$;
--> statement-breakpoint
CREATE TABLE "decision_question_links" (
	"user_id" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"primary_pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"primary_name" text NOT NULL,
	"answer_shape" text NOT NULL,
	CONSTRAINT "decision_question_links_pipeline_id_name_pk" PRIMARY KEY("pipeline_id","name"),
	CONSTRAINT "decision_question_links_primary_name_key" UNIQUE("pipeline_id","primary_name"),
	CONSTRAINT "decision_question_links_non_primary" CHECK ("decision_question_links"."pipeline_id" <> "decision_question_links"."primary_pipeline_id")
);
--> statement-breakpoint
ALTER TABLE "decision_pipeline_questions" ADD COLUMN "answer_shape" text GENERATED ALWAYS AS (public.system_one_answer_shape("type", "criteria")) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_pipeline_questions" ADD CONSTRAINT "decision_question_answer_shape_key" UNIQUE("pipeline_id","name","answer_shape");--> statement-breakpoint
ALTER TABLE "decision_question_links" ADD CONSTRAINT "decision_question_links_group_fk" FOREIGN KEY ("user_id","pipeline_id","primary_pipeline_id") REFERENCES "public"."decision_pipelines"("user_id","id","primary_grouped_pipeline_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_question_links" ADD CONSTRAINT "decision_question_links_question_fk" FOREIGN KEY ("pipeline_id","name","answer_shape") REFERENCES "public"."decision_pipeline_questions"("pipeline_id","name","answer_shape") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_question_links" ADD CONSTRAINT "decision_question_links_primary_question_fk" FOREIGN KEY ("primary_pipeline_id","primary_name","answer_shape") REFERENCES "public"."decision_pipeline_questions"("pipeline_id","name","answer_shape") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- New group membership and link edits require a complete mapping by commit.
CREATE OR REPLACE FUNCTION public.check_decision_question_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	version_ids uuid[];
	version_id uuid;
	link_count integer;
	primary_id uuid;
BEGIN
	IF TG_TABLE_NAME = 'decision_pipelines' THEN
		version_ids := ARRAY[NEW.id];
	ELSE
		version_ids := ARRAY[OLD.pipeline_id, NEW.pipeline_id];
	END IF;

	FOR version_id IN SELECT DISTINCT id FROM unnest(version_ids) AS id WHERE id IS NOT NULL LOOP
		SELECT primary_grouped_pipeline_id INTO primary_id FROM public.decision_pipelines WHERE id = version_id;
		CONTINUE WHEN primary_id IS NULL OR primary_id = version_id;

		SELECT count(*) INTO link_count FROM public.decision_question_links WHERE pipeline_id = version_id;
		IF link_count = 0
			OR link_count <> (SELECT count(*) FROM public.decision_pipeline_questions WHERE pipeline_id = version_id)
			OR link_count <> (SELECT count(*) FROM public.decision_pipeline_questions WHERE pipeline_id = primary_id)
		THEN
			RAISE EXCEPTION 'Saved question links must cover both pipeline versions'
				USING ERRCODE = '23514', CONSTRAINT = 'decision_question_links_complete';
		END IF;
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER decision_question_links_complete
	AFTER INSERT OR UPDATE OR DELETE ON "decision_question_links"
	DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_decision_question_links();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER decision_pipeline_group_links_complete
	AFTER INSERT OR UPDATE OF "primary_grouped_pipeline_id" ON "decision_pipelines"
	DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
	WHEN (NEW.id <> NEW.primary_grouped_pipeline_id)
	EXECUTE FUNCTION public.check_decision_question_links();
