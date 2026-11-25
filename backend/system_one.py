import base64
import binascii
import json
import logging
import re
import secrets
from contextlib import nullcontext
from datetime import UTC, datetime
from functools import cache
from typing import Annotated

import httpx
import zstandard
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.routing import APIRoute
from langfuse import Langfuse
from pydantic import ValidationError
from starlette.datastructures import UploadFile

from backend.api_keys import ApiUser
from backend.contracts import (
    Decision,
    DecisionHeaders,
    Definition,
    Images,
    InlineImage,
    ModelList,
    MultipartRequest,
    ReplayPipeline,
    RunAnnotation,
    RunResult,
    SystemOneRequest,
    TracedDecision,
)
from backend.db import pool
from backend.pipelines import (
    definition_for,
    ensure_pipeline,
    match_questions,
    read_versions,
)
from backend.settings import settings
from backend.traces import observability_url, store_trace

IMAGES = "typesafe-danger-zone-images"
LONG_CONTEXT = "typesafe-danger-zone-long-context"
EXACT = "x-use-exact-pipeline"
MAX_DECOMPRESSED = 16 * 1024 * 1024
LOG = logging.getLogger(__name__)
REFERENCES = re.compile(r"<image:[0-9a-f]{32}>")


def mime_type(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    return "application/octet-stream"


async def replace_body(request, body, *, content_type=None):
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    headers = [
        (key, value)
        for key, value in request.scope["headers"]
        if key not in {b"content-encoding", b"content-length"}
        and (content_type is None or key != b"content-type")
    ]
    if content_type is not None:
        headers.append((b"content-type", content_type))
    return Request({**request.scope, "headers": headers}, receive)


async def read_multipart(request):
    async with request.form(max_part_size=MAX_DECOMPRESSED) as form:
        parts = form.multi_items()
        requests = form.getlist("request")
        if len(requests) != 1:
            raise HTTPException(400, "Include one multipart request part.")
        raw = requests[0]
        if isinstance(raw, UploadFile):
            raw = await raw.read()
        try:
            data = MultipartRequest.model_validate_json(raw)
        except ValidationError as exc:
            raise HTTPException(
                400, "The request part must match the System One request schema."
            ) from exc
        files = {}
        for name, value in parts:
            if name == "request":
                continue
            if name in files or not isinstance(value, UploadFile):
                raise HTTPException(
                    400, "Image parts must be uniquely named file uploads."
                )
            files[name] = value
        assets = {}
        for name, asset in (data.assets or {}).items():
            if isinstance(asset, InlineImage):
                assets[name] = asset
            else:
                file = files.pop(asset.part, None)
                if file is None:
                    raise HTTPException(
                        400,
                        "Each image asset part must reference a unique uploaded file.",
                    )
                blob = await file.read()
                assets[name] = InlineImage(
                    type="image",
                    format="png" if mime_type(blob) == "image/png" else "jpeg",
                    data_base64=base64.b64encode(blob).decode(),
                )
        if files:
            raise HTTPException(
                400, "Every uploaded file must be referenced by an image asset."
            )
        return SystemOneRequest(
            **data.model_dump(exclude={"assets"}), assets=assets or None
        )


class SystemOneRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request):
            if request.headers.get("content-encoding", "").lower() == "zstd":
                try:
                    compressed = await request.body()
                    if zstandard.frame_content_size(compressed) > MAX_DECOMPRESSED:
                        raise ValueError("Request too large")
                    payload = zstandard.ZstdDecompressor().decompress(
                        compressed,
                        max_output_size=MAX_DECOMPRESSED,
                        allow_extra_data=False,
                    )
                    if len(payload) > MAX_DECOMPRESSED:
                        raise ValueError("Request too large")
                except (zstandard.ZstdError, ValueError) as exc:
                    raise HTTPException(
                        400, "Invalid or oversized zstd request body."
                    ) from exc
                request = await replace_body(request, payload)
            if (
                request.headers.get("content-type", "")
                .lower()
                .startswith("multipart/form-data")
            ):
                body = await read_multipart(request)
                request = await replace_body(
                    request,
                    body.model_dump_json().encode(),
                    content_type=b"application/json",
                )
            return await original(request)

        return handle


router = APIRouter(prefix="/api", tags=["System One · TypeSafe"])
compressed_router = APIRouter(
    prefix="/api", tags=["System One · TypeSafe"], route_class=SystemOneRoute
)


@cache
def upstream_client():
    return httpx.Client(timeout=55, follow_redirects=False, trust_env=False)


def upstream(method, path, response_type, *, base_url=None, headers=None, **kwargs):
    conf = settings()
    key = conf.typesafe_api_key.get_secret_value().strip()
    url = httpx.URL(base_url or conf.typesafe_base_url)
    if not key or url.scheme not in {"http", "https"} or not url.host:
        raise HTTPException(503, "TypeSafe credentials are not configured")
    bad_gateway = HTTPException(502, "TypeSafe returned an unexpected response")
    try:
        response = upstream_client().request(
            method,
            str(url).rstrip("/") + path,
            headers={"Authorization": f"Bearer {key}", **(headers or {})},
            **kwargs,
        )
        if response.status_code == 429:
            raise HTTPException(429, "TypeSafe rate limit reached")
        if response.status_code in {400, 422}:
            detail = response.json().get("detail")
            if isinstance(detail, (str, dict) if response.status_code == 400 else list):
                raise HTTPException(response.status_code, detail)
        response.raise_for_status()
        return response_type.model_validate_json(response.content)
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        raise bad_gateway from exc


def upstream_payload(payload):
    data = payload.model_dump(exclude={"assets"})
    for name, question in payload.questions.items():
        if question["type"] == "noul" and not any(
            criterion is not None
            for criterion in (
                question.get("instructions"),
                *(question.get("criteria") or {}).values(),
            )
        ):
            raise HTTPException(
                400,
                f'Noul question "{name}" needs instructions or a described outcome.',
            )
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    assets = payload.assets or {}
    for name in assets:
        if json.dumps(name, ensure_ascii=False)[1:-1] not in encoded:
            raise HTTPException(
                400, f'Image asset "{name}" is not referenced in the request.'
            )
    if missing := set(REFERENCES.findall(encoded)) - assets.keys():
        raise HTTPException(
            400,
            f"Image references without an attached image: {', '.join(sorted(missing))}.",
        )
    if not assets:
        return {"json": data}

    files = []
    refs = {}
    for index, (name, image) in enumerate(assets.items()):
        try:
            blob = base64.b64decode(image.data_base64, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(
                400, "Image data must contain valid base64 text."
            ) from exc
        if not blob:
            raise HTTPException(400, "Image data is empty.")
        field = f"asset-{index}"
        refs[name] = {"type": "image", "part": field}
        files.append((field, (field, blob, mime_type(blob))))
    data["assets"] = refs
    return {
        "files": [("request", (None, json.dumps(data), "application/json")), *files]
    }


@cache
def tracing_client():
    conf = settings()
    if (
        conf.langfuse_public_key.strip()
        and conf.langfuse_secret_key.get_secret_value().strip()
    ):
        return Langfuse(
            public_key=conf.langfuse_public_key,
            secret_key=conf.langfuse_secret_key.get_secret_value(),
            base_url=conf.langfuse_base_url,
            timeout=2,
        )
    return None


def run(pipeline, payload, headers):
    trace_id = secrets.token_hex(16)
    started = datetime.now(UTC)
    client = tracing_client()
    url = observability_url(trace_id) if client else None
    result = None
    try:
        context = (
            client.start_as_current_observation(
                name="decisions.process",
                as_type="generation",
                model=payload.model,
                trace_context={"trace_id": trace_id},
                metadata={"pipelineId": str(pipeline.id), "decisionTraceId": trace_id},
            )
            if client
            else nullcontext()
        )
        with context as generation:
            if generation:
                trace_input = payload.model_dump(exclude={"assets"})
                if payload.assets:
                    trace_input["assets"] = {
                        name: f"data:image/{'png' if image.format == 'png' else 'jpeg'};base64,{image.data_base64}"
                        for name, image in payload.assets.items()
                    }
                generation.update(
                    input={**trace_input, "options": {"headers": headers}}
                )
            result = upstream(
                "POST",
                "/v1/systemone",
                Decision,
                base_url=pipeline.baseUrl,
                headers=headers,
                **upstream_payload(payload),
            )
            if generation:
                generation.update(
                    model=result.model,
                    output=result.model_dump(),
                    usage_details={
                        "input": result.usage["input_tokens"],
                        "output": result.usage["output_tokens"],
                    },
                )
    finally:
        if client:
            try:
                client.flush()
            except Exception:
                LOG.warning("Could not flush Langfuse traces", exc_info=True)
        try:
            with pool().connection() as db:
                store_trace(
                    db, pipeline.id, trace_id, started, payload, result=result, url=url
                )
        except Exception:
            if result is not None:
                raise
            LOG.exception("Could not save failed decision trace %s", trace_id)
    if result is None:
        raise RuntimeError("Decision completed without a result.")
    return TracedDecision(**result.model_dump(), traceId=trace_id)


def pipeline_pair(db, user_id, pipeline_id, exact):
    versions = {
        pipeline.id: pipeline
        for pipeline in read_versions(
            db, user_id, [pipeline_id], include_primary=not exact
        )
    }
    version = versions.get(pipeline_id)
    primary = (
        versions.get(version.primaryGroupedPipelineId)
        if version and not exact
        else version
    )
    if (
        version is None
        or version.options is None
        or primary is None
        or primary.options is None
    ):
        raise HTTPException(
            404, "Decision pipeline not found or its definition is not ready"
        )
    return version, primary


def run_version(version, primary, state, assets=None):
    definition = definition_for(primary)
    links = {} if version.id == primary.id else match_questions(version, primary)
    if version.id != primary.id and not len(links) == len(version.questions) == len(
        primary.questions
    ):
        raise HTTPException(409, "Pipeline versions need compatible question links")
    result = run(
        primary,
        SystemOneRequest(
            model=definition["model"],
            questions=definition["questions"],
            state=state,
            assets=assets,
        ),
        definition["options"]["headers"],
    )
    if links:
        remapped = {}
        for question in version.questions:
            answer = result.answers.get(links[question.name])
            if answer is None or answer["type"] != question.question["type"]:
                raise HTTPException(502, "TypeSafe returned an unexpected answer")
            remapped[question.name] = answer
        result.answers = remapped
    return result, links


@router.get(
    "/v1/models",
    operation_id="listModels",
    responses={401: {"description": "An active API key is required"}},
)
def models(user: ApiUser) -> ModelList:
    return upstream("GET", "/v1/models", ModelList)


@compressed_router.post(
    "/v1/systemone",
    operation_id="decide",
    description="Evaluate named questions against shared state. Supports multipart images and zstd encoding (up to 16 MiB decoded).",
    openapi_extra={
        "requestBody": {
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["request"],
                        "properties": {
                            "request": {
                                "type": "string",
                                "description": "JSON System One request with image assets referencing uploaded part names.",
                            },
                        },
                        "additionalProperties": {"type": "string", "format": "binary"},
                    },
                    "encoding": {"request": {"contentType": "application/json"}},
                }
            }
        }
    },
    responses={401: {"description": "An active API key is required"}},
)
def decide(
    payload: SystemOneRequest,
    user: ApiUser,
    images: Annotated[Images | None, Header(alias=IMAGES)] = None,
    long_context: Annotated[Images | None, Header(alias=LONG_CONTEXT)] = None,
    exact: Annotated[Images | None, Header(alias=EXACT)] = None,
) -> TracedDecision:
    headers: DecisionHeaders = {}
    if images:
        headers[IMAGES] = images
    if long_context:
        headers[LONG_CONTEXT] = long_context
    definition = Definition(
        model=payload.model, questions=payload.questions, options={"headers": headers}
    )
    with pool().connection() as db:
        pipeline = ensure_pipeline(db, user.githubId, definition.model_dump())
        version, primary = pipeline_pair(db, user.githubId, pipeline["id"], bool(exact))
    if version.id == primary.id:
        return run(version, payload, headers)
    result, _ = run_version(version, primary, payload.state, payload.assets)
    return result


@router.post("/system-one/decide-by-pipeline", operation_id="decideByPipeline")
def decide_by_pipeline(
    payload: ReplayPipeline,
    user: ApiUser,
    exact: Annotated[Images | None, Header(alias=EXACT)] = None,
) -> TracedDecision:
    with pool().connection() as db:
        version, primary = pipeline_pair(
            db, user.githubId, payload.pipelineId, bool(exact)
        )
    result, _ = run_version(version, primary, payload.state)
    return result


def run_stored(payload, user):
    with pool().connection() as db:
        version, primary = pipeline_pair(
            db, user.githubId, payload.pipelineId, payload.exact
        )
    result, links = run_version(version, primary, payload.state)
    return RunResult(
        **result.model_dump(),
        traceAnnotation=RunAnnotation(
            pipelineId=primary.id, questionLinks=list(links.items())
        ),
    )
