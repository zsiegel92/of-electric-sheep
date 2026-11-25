import hashlib
from collections import Counter
from uuid import uuid4

import rfc8785
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from backend.contracts import (
    Definition,
    PipelineQuestion,
    PipelineSummary,
    PipelineVersion,
)
from backend.settings import settings

PIPELINE_FIELDS = """
    p.id, p.primary_grouped_pipeline_id AS "primaryGroupedPipelineId",
    p.display_name AS "displayName", p.ui_ignored AS "uiIgnored",
    p.base_url AS "baseUrl", p.created_at AS "createdAt", d.model, d.options
"""


def canonical_json(value):
    # Match the old JS implementation, including JSON.stringify's numeric property order.
    if isinstance(value, dict):

        def key_order(key):
            if (
                len(key) <= 10
                and key.isascii()
                and key.isdecimal()
                and str(int(key)) == key
                and int(key) < 2**32 - 1
            ):
                return (0, int(key))
            return (1, key.encode("utf-16-be", errors="surrogatepass"))

        return (
            b"{"
            + b",".join(
                rfc8785.dumps(key) + b":" + canonical_json(value[key])
                for key in sorted(value, key=key_order)
            )
            + b"}"
        )
    if isinstance(value, list):
        return b"[" + b",".join(canonical_json(item) for item in value) + b"]"
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) >= 2**53:
        value = float(value)
    return rfc8785.dumps(value)


def hash_pipeline(definition, base_url=None):
    digest = hashlib.sha256(
        canonical_json({"version": 1, "definition": definition})
    ).hexdigest()
    return (
        hashlib.sha256(f"{digest}:{base_url}".encode()).hexdigest()
        if base_url
        else digest
    )


def read_versions(db, user_id, ids=None, *, include_primary=False):
    rows = db.execute(
        f"""SELECT {PIPELINE_FIELDS},
            q.name, a.alias, q.answer_shape AS "answerShape", l.primary_name AS "primaryName",
            jsonb_build_object('type', q.type)
              || CASE WHEN q.system_prompt IS NOT NULL
                   THEN jsonb_build_object('instructions', q.system_prompt) ELSE '{{}}'::jsonb END
              || CASE WHEN q.criteria IS NOT NULL
                   THEN jsonb_build_object('criteria', q.criteria) ELSE '{{}}'::jsonb END AS question
        FROM decision_pipelines p
        LEFT JOIN decision_pipeline_definitions d ON d.pipeline_id = p.id
        LEFT JOIN decision_pipeline_questions q ON q.pipeline_id = d.pipeline_id
        LEFT JOIN pipeline_question_aliases a ON (a.pipeline_id, a.question_name) = (q.pipeline_id, q.name)
        LEFT JOIN decision_question_links l ON (l.pipeline_id, l.name) = (q.pipeline_id, q.name)
        WHERE p.user_id = %(user)s AND (
            %(ids)s::uuid[] IS NULL OR p.id = ANY(%(ids)s) OR
            (%(include_primary)s AND p.id IN (
                SELECT primary_grouped_pipeline_id FROM decision_pipelines
                WHERE user_id = %(user)s AND id = ANY(%(ids)s)
            ))
        )
        ORDER BY p.created_at DESC, p.id, q.name""",
        {"user": user_id, "ids": ids, "include_primary": include_primary},
    )
    versions = {}
    for row in rows:
        pipeline = versions.get(row["id"])
        if pipeline is None:
            pipeline = PipelineVersion.model_validate({**row, "questions": []})
            versions[pipeline.id] = pipeline
        if row["name"] is not None:
            pipeline.questions.append(PipelineQuestion.model_validate(row))
    return list(versions.values())


def get_version(db, user_id, pipeline_id):
    versions = read_versions(db, user_id, [pipeline_id])
    if not versions:
        raise HTTPException(404, "Pipeline not found.")
    return versions[0]


def summarize(pipeline):
    counts = Counter(question.question["type"] for question in pipeline.questions)
    shapes = question_shapes(pipeline)
    return PipelineSummary(
        **pipeline.model_dump(exclude={"options", "questions"}),
        questionCount=len(pipeline.questions),
        comparabilityKey=" · ".join(f"{counts[kind]} {kind}" for kind in sorted(counts))
        or None,
        linkShapeKey=hashlib.sha256(shapes.encode()).hexdigest() if shapes else None,
    )


def question_shapes(version):
    return ",".join(sorted(question.answerShape for question in version.questions))


def definition_for(version):
    return Definition(
        model=version.model,
        options=version.options,
        questions={item.name: item.question for item in version.questions},
    ).model_dump()


def match_questions(version, primary):
    links = {}
    available = {question.name: question.answerShape for question in primary.questions}
    for question in version.questions:
        if question.primaryName is not None:
            links[question.name] = question.primaryName
            available.pop(question.primaryName, None)
    for question in version.questions:
        if (
            question.name not in links
            and available.get(question.name) == question.answerShape
        ):
            links[question.name] = question.name
            del available[question.name]
    unmatched = [
        question for question in version.questions if question.name not in links
    ]
    counts = Counter(question.answerShape for question in unmatched)
    for question in unmatched:
        candidates = [
            name for name, shape in available.items() if shape == question.answerShape
        ]
        if len(candidates) == 1 and counts[question.answerShape] == 1:
            links[question.name] = candidates[0]
            del available[candidates[0]]
    return links


def insert_pipeline(
    db, user_id, definition, *, display_name=None, base_url=None, ignored=False
):
    pipeline_id = uuid4()
    inserted = db.execute(
        """INSERT INTO decision_pipelines
            (id, user_id, definition_hash, primary_grouped_pipeline_id, display_name, base_url, ui_ignored)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (user_id, definition_hash) DO NOTHING RETURNING id""",
        (
            pipeline_id,
            user_id,
            hash_pipeline(definition, base_url),
            pipeline_id,
            display_name,
            base_url,
            ignored,
        ),
    ).fetchone()
    if inserted is None:
        return None
    insert_definition(db, pipeline_id, definition)
    return pipeline_id


def insert_definition(db, pipeline_id, definition):
    with db.cursor() as cursor:
        cursor.executemany(
            """INSERT INTO decision_pipeline_questions (pipeline_id, name, type, system_prompt, criteria)
            VALUES (%s, %s, %s, %s, %s)""",
            [
                (
                    pipeline_id,
                    name,
                    question["type"],
                    Jsonb(question["instructions"])
                    if "instructions" in question
                    else None,
                    Jsonb(question["criteria"]) if "criteria" in question else None,
                )
                for name, question in definition["questions"].items()
            ],
        )
    db.execute(
        "INSERT INTO decision_pipeline_definitions (pipeline_id, model, options) VALUES (%s, %s, %s)",
        (pipeline_id, definition["model"], Jsonb(definition["options"])),
    )


def ensure_pipeline(db, user_id, definition):
    pipeline_id = insert_pipeline(db, user_id, definition)
    if pipeline_id is not None:
        pipeline = db.execute(
            "SELECT * FROM decision_pipelines WHERE id = %s", (pipeline_id,)
        ).fetchone()
    else:
        pipeline = db.execute(
            "SELECT * FROM decision_pipelines WHERE user_id = %s AND definition_hash = %s FOR NO KEY UPDATE",
            (user_id, hash_pipeline(definition)),
        ).fetchone()
    if pipeline is None:
        raise RuntimeError("Could not create or retrieve decision pipeline.")
    if pipeline_id is not None:
        return pipeline
    exists = db.execute(
        "SELECT 1 FROM decision_pipeline_definitions WHERE pipeline_id = %s",
        (pipeline["id"],),
    ).fetchone()
    if not exists:
        insert_definition(db, pipeline["id"], definition)
    return pipeline


def lock_owner(db, user_id):
    db.execute("SELECT 1 FROM users WHERE github_id = %s FOR NO KEY UPDATE", (user_id,))


def replace_links(db, user_id, version, primary, links):
    source = {item.name: item.answerShape for item in version.questions}
    target = {item.name: item.answerShape for item in primary.questions}
    if (
        not source
        or set(links) != set(source)
        or set(links.values()) != set(target)
        or len(links) != len(target)
        or any(
            source[name] != target[primary_name] for name, primary_name in links.items()
        )
    ):
        raise HTTPException(
            400, "Link every question to one compatible primary question."
        )
    db.execute(
        "DELETE FROM decision_question_links WHERE pipeline_id = %s", (version.id,)
    )
    with db.cursor() as cursor:
        cursor.executemany(
            """INSERT INTO decision_question_links
                (user_id, pipeline_id, primary_pipeline_id, name, primary_name, answer_shape)
                VALUES (%s, %s, %s, %s, %s, %s)""",
            [
                (user_id, version.id, primary.id, name, primary_name, source[name])
                for name, primary_name in links.items()
            ],
        )


def save_links(db, user_id, data):
    if data.pipelineId == data.primaryPipelineId:
        raise HTTPException(400, "Select two different versions.")
    lock_owner(db, user_id)
    version = get_version(db, user_id, data.pipelineId)
    primary = get_version(db, user_id, data.primaryPipelineId)
    if primary.primaryGroupedPipelineId != primary.id:
        raise HTTPException(400, "Select a pipeline and its primary version.")
    if version.primaryGroupedPipelineId != primary.id:
        member = db.execute(
            """SELECT 1 FROM decision_pipelines
            WHERE user_id = %s AND primary_grouped_pipeline_id = %s AND id <> %s LIMIT 1""",
            (user_id, version.id, version.id),
        ).fetchone()
        if version.primaryGroupedPipelineId != version.id or member:
            raise HTTPException(
                400, "Only a standalone pipeline can join another group."
            )
        db.execute(
            "UPDATE decision_pipelines SET primary_grouped_pipeline_id = %s WHERE id = %s",
            (primary.id, version.id),
        )
    links = {link.name: link.primaryName for link in data.links}
    if len(links) != len(data.links):
        raise HTTPException(
            400, "Link every question to one compatible primary question."
        )
    replace_links(db, user_id, version, primary, links)


def evolve(db, user_id, source_id, draft):
    lock_owner(db, user_id)
    source = get_version(db, user_id, source_id)
    if source.options is None:
        raise HTTPException(409, "The source pipeline definition is not ready.")
    definition = draft.model_dump(exclude={"displayName", "baseUrl", "uiIgnored"})
    if draft.baseUrl == source.baseUrl and canonical_json(definition) == canonical_json(
        definition_for(source)
    ):
        raise HTTPException(
            400, "Change the pipeline definition before saving a version."
        )
    if (
        draft.baseUrl
        and draft.baseUrl != source.baseUrl
        and draft.baseUrl not in settings().pipeline_base_urls()
    ):
        raise HTTPException(
            400, "Choose the default upstream or a configured pipeline URL."
        )

    pipeline_id = insert_pipeline(
        db,
        user_id,
        definition,
        base_url=draft.baseUrl,
        display_name=draft.displayName,
        ignored=draft.uiIgnored,
    )
    if pipeline_id is None:
        raise HTTPException(409, "A pipeline with this definition already exists.")
    version = get_version(db, user_id, pipeline_id)
    primary = get_version(db, user_id, source.primaryGroupedPipelineId)
    if version.questions and question_shapes(version) == question_shapes(
        source
    ) == question_shapes(primary):
        through_source = match_questions(version, source)
        source_to_primary = match_questions(source, primary)
        primary_shapes = {item.name: item.answerShape for item in primary.questions}
        links = {}
        for question in version.questions:
            primary_name = source_to_primary.get(through_source.get(question.name))
            if (
                primary_name is not None
                and primary_shapes.get(primary_name) == question.answerShape
            ):
                links[question.name] = primary_name
        if len(links) == len(version.questions):
            db.execute(
                "UPDATE decision_pipelines SET primary_grouped_pipeline_id = %s WHERE id = %s",
                (primary.id, version.id),
            )
            replace_links(db, user_id, version, primary, links)
    return pipeline_id


def promote(db, user_id, pipeline_id):
    lock_owner(db, user_id)
    version = get_version(db, user_id, pipeline_id)
    if version.options is None:
        raise HTTPException(409, "Pipeline definition is not ready.")
    if version.primaryGroupedPipelineId == pipeline_id:
        return
    old_primary = get_version(db, user_id, version.primaryGroupedPipelineId)
    to_new = {
        target: source
        for source, target in match_questions(version, old_primary).items()
    }
    group = (user_id, old_primary.id)
    member_ids = db.execute(
        "SELECT id FROM decision_pipelines WHERE user_id = %s AND primary_grouped_pipeline_id = %s",
        group,
    ).fetchall()
    ids = [item["id"] for item in member_ids]
    members = read_versions(db, user_id, ids)
    db.execute(
        "DELETE FROM decision_question_links WHERE pipeline_id = ANY(%s)", (ids,)
    )
    db.execute(
        """UPDATE decision_pipelines SET primary_grouped_pipeline_id = %s
        WHERE user_id = %s AND primary_grouped_pipeline_id = %s""",
        (pipeline_id, *group),
    )
    for member in members:
        if member.id != pipeline_id:
            links = {
                source: to_new[target]
                for source, target in match_questions(member, old_primary).items()
                if target in to_new
            }
            replace_links(db, user_id, member, version, links)
