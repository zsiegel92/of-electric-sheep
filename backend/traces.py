from datetime import UTC, datetime
from typing import Literal, LiteralString
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

from fastapi import HTTPException
from psycopg import sql
from psycopg.types.json import Jsonb

from backend.contracts import (
    TraceDetails,
    TraceOrder,
    TracePage,
    TracePipeline,
    TracePipelineSummary,
)
from backend.db import pool
from backend.pipelines import get_version
from backend.settings import settings

PAGE_SIZE = 10
ANNOTATION_MATCH: LiteralString = (
    "a.pipeline_id = t.pipeline_id AND a.trace_id = t.trace_id"
)
ANNOTATIONS: LiteralString = f"""COALESCE((
    SELECT jsonb_agg(jsonb_build_object('questionName', a.question_name, 'choiceKey', a.choice_key)
      ORDER BY a.question_name)
    FROM decision_trace_annotations a WHERE {ANNOTATION_MATCH}
), '[]'::jsonb)"""
TRACE_FIELDS: LiteralString = f"""
    t.trace_id AS "traceId", t.pipeline_id AS "pipelineId", t.started_at AS "startTime",
    t.ended_at AS "endTime", t.model, t.failed, t.state, t.answers, t.usage,
    t.observability_url AS "observabilityUrl", t.payload_truncated AS "payloadTruncated",
    t.historical_placeholder AS "historicalPlaceholder", {ANNOTATIONS} AS annotations
"""
RECENT = sql.SQL("t.started_at DESC NULLS LAST, t.trace_id DESC NULLS LAST")
CONFIDENCE_ORDER: dict[
    TraceOrder, tuple[str, Literal["ASC", "DESC"], Literal[">", "<"]]
] = {
    "least-single": ("min_confidence", "ASC", ">"),
    "least-average": ("average_confidence", "ASC", ">"),
    "most-average": ("average_confidence", "DESC", "<"),
}


def observability_url(trace_id):
    conf = settings()
    if not (project := conf.langfuse_project_id.strip()):
        return None
    base = urlsplit(conf.langfuse_base_url)
    if base.scheme not in {"http", "https"} or not base.hostname:
        return None
    path = f"{base.path.rstrip('/')}/project/{quote(project, safe='')}/traces/{quote(trace_id, safe='')}"
    return urlunsplit(
        base._replace(path=path, query=urlencode({"traceId": trace_id}), fragment="")
    )


def store_trace(db, pipeline_id, trace_id, started, payload, *, result=None, url=None):
    answers = result.answers if result else {}
    confidence = [
        max(answer["noul"], 1 - answer["noul"])
        if answer["type"] == "noul"
        else answer["confidence"]
        for answer in answers.values()
    ]
    confidence = [score for score in confidence if score is not None]
    db.execute(
        """INSERT INTO decision_traces
          (pipeline_id, trace_id, started_at, ended_at, model, failed, state, answers, usage,
           min_confidence, average_confidence, observability_url)
        VALUES (%s, %s, %s, now(), %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (pipeline_id, trace_id) DO NOTHING""",
        (
            pipeline_id,
            trace_id,
            started,
            result.model if result else payload.model,
            result is None,
            Jsonb(payload.state),
            Jsonb(answers) if result else None,
            Jsonb(result.usage) if result else None,
            min(confidence) if confidence else None,
            sum(confidence) / len(confidence) if confidence else None,
            url,
        ),
    )


def trace_view(row):
    if row["historicalPlaceholder"] and not row["observabilityUrl"]:
        row["observabilityUrl"] = observability_url(row["traceId"])
    optional = {"endTime", "state", "answers", "usage", "observabilityUrl"}
    return {
        key: value
        for key, value in row.items()
        if value is not None or key not in optional
    }


def trace_pipeline(db, user_id, pipeline_id):
    version = get_version(db, user_id, pipeline_id)
    return TracePipeline(
        id=version.id,
        name=version.displayName or version.model or str(version.id),
        questions=version.questions,
    )


def trace_selection(status, order):
    condition = sql.SQL("")
    if status != "all":
        exists = sql.SQL(
            f"EXISTS (SELECT FROM decision_trace_annotations a WHERE {ANNOTATION_MATCH})"
        )
        condition = sql.SQL("AND ") + (
            exists if status == "annotated" else sql.SQL("NOT ") + exists
        )
    if order not in CONFIDENCE_ORDER:
        return condition, RECENT
    column, direction, _ = CONFIDENCE_ORDER[order]
    sorting = sql.SQL("t.{} {} NULLS LAST, ").format(
        sql.Identifier(column), sql.SQL(direction)
    )
    return condition, sorting + RECENT


def trace_page(db, user_id, pipeline_id, cursor, until, status, order):
    pipeline = trace_pipeline(db, user_id, pipeline_id)
    until = until or datetime.now(UTC)
    condition, sorting = trace_selection(status, order)
    params = {"pipeline": pipeline_id, "until": until, "limit": PAGE_SIZE + 1}
    if cursor:
        anchor = db.execute(
            """SELECT started_at, trace_id, min_confidence, average_confidence FROM decision_traces
            WHERE pipeline_id = %s AND trace_id = %s""",
            (pipeline_id, cursor),
        ).fetchone()
        if anchor:
            params.update(anchor)
            older = sql.SQL(
                "(t.started_at, t.trace_id) < (%(started_at)s, %(trace_id)s)"
            )
            bounds = older
            if order in CONFIDENCE_ORDER:
                name, _, operator = CONFIDENCE_ORDER[order]
                column = sql.SQL("t.{}").format(sql.Identifier(name))
                if anchor[name] is None:
                    bounds = sql.SQL("{} IS NULL AND {}").format(column, older)
                else:
                    params["score"] = anchor[name]
                    bounds = sql.SQL(
                        "{col} {op} %(score)s OR {col} IS NULL OR ({col} = %(score)s AND {older})"
                    ).format(col=column, op=sql.SQL(operator), older=older)
            condition += sql.SQL(" AND ({})").format(bounds)
    rows = db.execute(
        sql.SQL(f"""SELECT {TRACE_FIELDS} FROM decision_traces t
            WHERE t.pipeline_id = %(pipeline)s AND t.recorded_at <= %(until)s
            {{}} ORDER BY {{}} LIMIT %(limit)s""").format(condition, sorting),
        params,
    ).fetchall()
    return TracePage.model_validate(
        {
            "pipeline": pipeline,
            "traces": [trace_view(row) for row in rows[:PAGE_SIZE]],
            "next": rows[PAGE_SIZE - 1]["traceId"] if len(rows) > PAGE_SIZE else None,
            "until": until,
        }
    )


def trace_detail(db, user_id, trace_id):
    row = db.execute(
        f"""SELECT {TRACE_FIELDS} FROM decision_traces t
        JOIN decision_pipelines p ON p.id = t.pipeline_id
        WHERE p.user_id = %s AND t.trace_id = %s
        ORDER BY t.started_at DESC, t.trace_id DESC, t.pipeline_id LIMIT 1""",
        (user_id, trace_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Trace not found.")
    pipeline = trace_pipeline(db, user_id, row["pipelineId"])
    return TraceDetails.model_validate(
        {
            "pipeline": TracePipelineSummary(id=pipeline.id, name=pipeline.name),
            "questions": pipeline.questions,
            "trace": trace_view(row),
        }
    )


def owned_annotations(db, user_id, key):
    row = db.execute(
        f"""SELECT {ANNOTATIONS} AS annotations FROM decision_traces t
        JOIN decision_pipelines p ON p.id = t.pipeline_id
        WHERE p.user_id = %s AND t.pipeline_id = %s AND t.trace_id = %s""",
        (user_id, key.pipelineId, key.traceId),
    ).fetchone()
    return row["annotations"] if row else None


def choice_keys(question):
    match question["type"]:
        case "noul":
            return ("true", "false")
        case "score":
            return (str(index) for index in range(len(question["criteria"])))
        case "choice":
            return question["criteria"]
        case _:
            return ()


def save_annotation(db, user_id, data):
    if owned_annotations(db, user_id, data) is None:
        raise HTTPException(404, "Trace not found.")
    key = (data.pipelineId, data.traceId, data.questionName)
    if data.choiceKey is None:
        db.execute(
            """DELETE FROM decision_trace_annotations WHERE (pipeline_id, trace_id, question_name) = (%s, %s, %s)""",
            key,
        )
        return
    version = get_version(db, user_id, data.pipelineId)
    question = next(
        (item.question for item in version.questions if item.name == data.questionName),
        None,
    )
    if question is None or data.choiceKey not in choice_keys(question):
        raise HTTPException(400, "Choose an option from this trace's question.")
    db.execute(
        """INSERT INTO decision_trace_annotations (pipeline_id, trace_id, question_name, choice_key)
        VALUES (%s, %s, %s, %s) ON CONFLICT (pipeline_id, trace_id, question_name)
        DO UPDATE SET choice_key = EXCLUDED.choice_key, updated_at = now()""",
        (*key, data.choiceKey),
    )


def stream_export(user_id, pipeline_id, status, order):
    condition, sorting = trace_selection(status, order)
    query = sql.SQL(
        f"""SELECT to_jsonb(export)::text AS line FROM (
            SELECT {TRACE_FIELDS} FROM decision_traces t JOIN decision_pipelines p ON p.id = t.pipeline_id
            WHERE p.id = %s AND p.user_id = %s {{}} ORDER BY {{}}
        ) export"""
    ).format(condition, sorting)
    with pool().connection() as db, db.cursor("trace_export") as cursor:
        cursor.itersize = 16
        cursor.execute(query, (pipeline_id, user_id))
        for row in cursor:
            yield row["line"] + "\n"
