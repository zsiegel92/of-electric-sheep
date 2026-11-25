-- SQLAlchemy deduplicates identical source columns in a composite foreign key.
ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_primary_grouped_pipeline_fk" FOREIGN KEY ("user_id","primary_grouped_pipeline_id","primary_grouped_pipeline_id") REFERENCES "public"."decision_pipelines"("user_id","id","primary_grouped_pipeline_id") ON DELETE no action ON UPDATE no action;

CREATE FUNCTION guard_pipeline_definition_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_TABLE_NAME = 'decision_pipeline_questions' THEN
		-- Serialize question inserts with the worker assembling this pipeline.
		PERFORM 1 FROM public.decision_pipelines WHERE id = NEW.pipeline_id FOR NO KEY UPDATE;
		IF EXISTS (
			SELECT 1 FROM public.decision_pipeline_definitions WHERE pipeline_id = NEW.pipeline_id
		) THEN
			RAISE EXCEPTION 'Pipeline definitions are immutable. Create a new pipeline version.'
				USING ERRCODE = '23514', CONSTRAINT = 'decision_pipeline_definition_immutable';
		END IF;
	ELSIF NOT EXISTS (
		SELECT 1 FROM public.decision_pipeline_questions WHERE pipeline_id = NEW.pipeline_id
	) THEN
		RAISE EXCEPTION 'A pipeline definition must have at least one question.'
			USING ERRCODE = '23514', CONSTRAINT = 'decision_pipeline_definition_requires_questions';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER guard_pipeline_question_insert
	BEFORE INSERT ON "decision_pipeline_questions"
	FOR EACH ROW EXECUTE FUNCTION guard_pipeline_definition_insert();

CREATE TRIGGER guard_pipeline_definition_insert
	BEFORE INSERT ON "decision_pipeline_definitions"
	FOR EACH ROW EXECUTE FUNCTION guard_pipeline_definition_insert();

CREATE FUNCTION reject_pipeline_definition_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		-- Allow the foreign-key cascade when the owning pipeline was deleted.
		IF NOT EXISTS (SELECT 1 FROM public.decision_pipelines WHERE id = OLD.pipeline_id) THEN
			RETURN OLD;
		END IF;
	END IF;
	RAISE EXCEPTION 'Pipeline definitions are immutable. Create a new pipeline version.'
		USING ERRCODE = '23514', CONSTRAINT = 'decision_pipeline_definition_immutable';
END;
$$;

CREATE TRIGGER reject_pipeline_definition_change
	BEFORE UPDATE OR DELETE ON "decision_pipeline_definitions"
	FOR EACH ROW EXECUTE FUNCTION reject_pipeline_definition_change();

CREATE TRIGGER reject_pipeline_question_change
	BEFORE UPDATE OR DELETE ON "decision_pipeline_questions"
	FOR EACH ROW EXECUTE FUNCTION reject_pipeline_definition_change();

CREATE TRIGGER reject_pipeline_definition_hash_change
	BEFORE UPDATE OF "definition_hash" ON "decision_pipelines"
	FOR EACH ROW WHEN (OLD.definition_hash IS DISTINCT FROM NEW.definition_hash)
	EXECUTE FUNCTION reject_pipeline_definition_change();

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

CREATE CONSTRAINT TRIGGER decision_question_links_complete
	AFTER INSERT OR UPDATE OR DELETE ON "decision_question_links"
	DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_decision_question_links();

CREATE CONSTRAINT TRIGGER decision_pipeline_group_links_complete
	AFTER INSERT OR UPDATE OF "primary_grouped_pipeline_id" ON "decision_pipelines"
	DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
	WHEN (NEW.id <> NEW.primary_grouped_pipeline_id)
	EXECUTE FUNCTION public.check_decision_question_links();
