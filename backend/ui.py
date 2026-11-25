from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from psycopg import sql

from backend.auth import SessionUser, User
from backend.contracts import (
    EvolvePipeline,
    PipelineId,
    PipelineQuestion,
    PipelineSummary,
    PipelineVersion,
    RunPipeline,
    RunResult,
    SaveAnnotation,
    SetPipelineIgnored,
    TraceAnnotation,
    TraceDetails,
    TraceId,
    TraceOrder,
    TracePage,
    TraceReference,
    TraceStatus,
    UpdatePipelineName,
    UpdateQuestionAlias,
    UpdateQuestionLinks,
)
from backend.db import pool
from backend.pipelines import (
    evolve,
    get_version,
    promote,
    read_versions,
    save_links,
    summarize,
)
from backend.settings import settings
from backend.system_one import run_stored
from backend.traces import (
    owned_annotations,
    save_annotation,
    stream_export,
    trace_detail,
    trace_page,
)

router = APIRouter(prefix="/api", tags=["Dashboard"])


@router.get("/session", operation_id="getCurrentUser")
def session(user: SessionUser) -> User:
    return user


@router.get("/pipelines", operation_id="listPipelines")
def list_pipelines(user: SessionUser) -> list[PipelineSummary]:
    with pool().connection() as db:
        return [summarize(pipeline) for pipeline in read_versions(db, user.githubId)]


@router.get("/pipelines/versions", operation_id="getPipelineVersions")
def versions(
    user: SessionUser, ids: Annotated[list[UUID], Query(max_length=3)]
) -> list[PipelineVersion]:
    with pool().connection() as db:
        return read_versions(db, user.githubId, ids, include_primary=True)


@router.get("/pipelines/base-urls", operation_id="getEditablePipelineBaseUrls")
def base_urls(user: SessionUser) -> list[str]:
    return settings().pipeline_base_urls()


@router.get("/pipelines/{pipeline_id}/questions", operation_id="getPipelineQuestions")
def questions(user: SessionUser, pipeline_id: UUID) -> list[PipelineQuestion]:
    with pool().connection() as db:
        return get_version(db, user.githubId, pipeline_id).questions


@router.post("/pipelines/evolve", operation_id="evolvePipeline")
def evolve_pipeline(user: SessionUser, data: EvolvePipeline) -> PipelineId:
    with pool().connection() as db:
        return PipelineId(
            pipelineId=evolve(db, user.githubId, data.sourceId, data.draft)
        )


@router.post("/pipelines/primary", operation_id="makePipelinePrimary", status_code=204)
def make_primary(user: SessionUser, data: PipelineId) -> None:
    with pool().connection() as db:
        promote(db, user.githubId, data.pipelineId)


@router.patch("/pipelines", operation_id="updatePipeline", status_code=204)
def update_pipeline(
    user: SessionUser, data: UpdatePipelineName | SetPipelineIgnored
) -> None:
    with pool().connection() as db:
        column, value = (
            ("display_name", data.displayName or None)
            if isinstance(data, UpdatePipelineName)
            else ("ui_ignored", data.uiIgnored)
        )
        updated = db.execute(
            sql.SQL(
                "UPDATE decision_pipelines SET {} = %(value)s WHERE id = %(pipeline_id)s AND user_id = %(user_id)s"
            ).format(sql.Identifier(column)),
            {"value": value, "pipeline_id": data.pipelineId, "user_id": user.githubId},
        )
        if not updated.rowcount:
            raise HTTPException(404, "Pipeline not found.")


@router.put("/pipelines/question-alias", operation_id="updateQuestionAlias")
def update_alias(user: SessionUser, data: UpdateQuestionAlias) -> str | None:

    with pool().connection() as db:
        key = {"pipeline_id": data.pipelineId, "question_name": data.questionName}
        question = db.execute(
            """SELECT 1 FROM decision_pipeline_questions q JOIN decision_pipelines p ON p.id = q.pipeline_id
            WHERE q.pipeline_id = %(pipeline_id)s AND q.name = %(question_name)s AND p.user_id = %(user_id)s
            FOR KEY SHARE""",
            {**key, "user_id": user.githubId},
        ).fetchone()
        if not question:
            raise HTTPException(404, "Question not found.")
        if data.alias is None:
            db.execute(
                "DELETE FROM pipeline_question_aliases WHERE pipeline_id = %(pipeline_id)s AND question_name = %(question_name)s",
                key,
            )
        else:
            db.execute(
                """INSERT INTO pipeline_question_aliases (pipeline_id, question_name, alias)
                VALUES (%(pipeline_id)s, %(question_name)s, %(alias)s)
                ON CONFLICT (pipeline_id, question_name) DO UPDATE SET alias = EXCLUDED.alias""",
                {**key, "alias": data.alias},
            )
    return data.alias


@router.put(
    "/pipelines/question-links", operation_id="updateQuestionLinks", status_code=204
)
def link_questions(user: SessionUser, data: UpdateQuestionLinks) -> None:
    with pool().connection() as db:
        save_links(db, user.githubId, data)


@router.post("/pipelines/run", operation_id="runStoredPipeline")
def run_pipeline(user: SessionUser, data: RunPipeline) -> RunResult:
    return run_stored(data, user)


@router.get("/pipelines/{pipeline_id}/traces", operation_id="listPipelineTraces")
def list_traces(
    user: SessionUser,
    pipeline_id: UUID,
    cursor: TraceId | None = None,
    until: datetime | None = None,
    status: TraceStatus = "all",
    order: TraceOrder = "recent",
) -> TracePage:
    with pool().connection() as db:
        return trace_page(db, user.githubId, pipeline_id, cursor, until, status, order)


@router.get("/traces/{trace_id}", operation_id="getDecisionTrace")
def get_trace(user: SessionUser, trace_id: TraceId) -> TraceDetails:
    with pool().connection() as db:
        return trace_detail(db, user.githubId, trace_id)


@router.get(
    "/traces/{pipeline_id}/{trace_id}/annotations",
    operation_id="getStoredTraceAnnotations",
)
def annotations(
    user: SessionUser, pipeline_id: UUID, trace_id: TraceId
) -> list[TraceAnnotation] | None:
    with pool().connection() as db:
        return owned_annotations(
            db, user.githubId, TraceReference(pipelineId=pipeline_id, traceId=trace_id)
        )


@router.put("/traces/annotation", operation_id="saveTraceAnnotation", status_code=204)
def annotate(user: SessionUser, data: SaveAnnotation) -> None:
    with pool().connection() as db:
        save_annotation(db, user.githubId, data)


@router.get(
    "/traces/{pipeline_id}/export",
    operation_id="exportTraces",
    response_class=StreamingResponse,
    responses={
        200: {"content": {"application/x-ndjson": {"schema": {"type": "string"}}}}
    },
)
def export_traces(
    user: SessionUser,
    pipeline_id: UUID,
    status: TraceStatus = "all",
    order: TraceOrder = "recent",
):
    with pool().connection() as db:
        get_version(db, user.githubId, pipeline_id)
    return StreamingResponse(
        stream_export(user.githubId, pipeline_id, status, order),
        media_type="application/x-ndjson; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{status}-traces-{pipeline_id}.jsonl"'
        },
    )
