-- Generated answer signatures constrain which questions a member can link to.
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
