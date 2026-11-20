-- Insert questions first. The definition row seals the full question set.
ALTER TABLE "decision_pipeline_questions"
	ALTER CONSTRAINT "decision_pipeline_questions_pipeline_id_decision_pipeline_defin"
	DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER guard_pipeline_question_insert
	BEFORE INSERT ON "decision_pipeline_questions"
	FOR EACH ROW EXECUTE FUNCTION guard_pipeline_definition_insert();
--> statement-breakpoint
CREATE TRIGGER guard_pipeline_definition_insert
	BEFORE INSERT ON "decision_pipeline_definitions"
	FOR EACH ROW EXECUTE FUNCTION guard_pipeline_definition_insert();
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER reject_pipeline_definition_change
	BEFORE UPDATE OR DELETE ON "decision_pipeline_definitions"
	FOR EACH ROW EXECUTE FUNCTION reject_pipeline_definition_change();
--> statement-breakpoint
CREATE TRIGGER reject_pipeline_question_change
	BEFORE UPDATE OR DELETE ON "decision_pipeline_questions"
	FOR EACH ROW EXECUTE FUNCTION reject_pipeline_definition_change();
--> statement-breakpoint
CREATE TRIGGER reject_pipeline_definition_hash_change
	BEFORE UPDATE OF "definition_hash" ON "decision_pipelines"
	FOR EACH ROW WHEN (OLD.definition_hash IS DISTINCT FROM NEW.definition_hash)
	EXECUTE FUNCTION reject_pipeline_definition_change();
