"""Request and response types for FastAPI and the generated TypeScript client."""

from datetime import datetime
from typing import Annotated, Literal, NotRequired
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue, StringConstraints
from typing_extensions import TypedDict

Named = Annotated[str, StringConstraints(min_length=1)]
TraceId = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{32}$")]
Content = str | dict[str, JsonValue] | list[JsonValue]
Probability = Annotated[float, Field(ge=0, le=1)]
Images = Literal["true"]


class NoulCriteria(TypedDict, total=False):
    true: Content | None
    false: Content | None


class NoulQuestion(TypedDict):
    type: Literal["noul"]
    instructions: NotRequired[Content | None]
    criteria: NotRequired[NoulCriteria | None]


class ChoiceQuestion(TypedDict):
    type: Literal["choice"]
    instructions: NotRequired[Content | None]
    criteria: Annotated[
        dict[Named, Content | None], Field(min_length=1, max_length=255)
    ]


class ScoreQuestion(TypedDict):
    type: Literal["score"]
    instructions: NotRequired[Content | None]
    criteria: Annotated[list[Content], Field(min_length=2, max_length=10)]


class BoxQuestion(TypedDict):
    type: Literal["box"]
    instructions: NotRequired[Content | None]


Question = Annotated[
    NoulQuestion | ChoiceQuestion | ScoreQuestion | BoxQuestion,
    Field(discriminator="type"),
]
Questions = Annotated[dict[Named, Question], Field(min_length=1)]


class InlineImage(BaseModel):
    type: Literal["image"]
    format: Literal["png", "jpg", "jpeg"]
    data_base64: str


class ImagePart(BaseModel):
    type: Literal["image"]
    part: Named


class SystemOneContent(BaseModel):
    model: Named
    state: Content
    questions: Questions


class SystemOneRequest(SystemOneContent):
    assets: Annotated[dict[Named, InlineImage], Field(min_length=1)] | None = None


class MultipartRequest(SystemOneContent):
    assets: (
        Annotated[dict[Named, InlineImage | ImagePart], Field(min_length=1)] | None
    ) = None


class NoulAnswer(TypedDict):
    type: Literal["noul"]
    noul: Probability


class ChoiceAnswer(TypedDict):
    type: Literal["choice"]
    choice: str
    confidence: Probability
    probabilities: dict[Named, Probability]


class ScoreAnswer(TypedDict):
    type: Literal["score"]
    score: float
    confidence: Probability
    legend: dict[Named, Content]
    probabilities: dict[Named, Probability]


class BoxCoordinates(TypedDict):
    top: Probability
    bottom: Probability
    left: Probability
    right: Probability


class BoxAnswer(TypedDict):
    type: Literal["box"]
    box: BoxCoordinates
    confidence: Probability | None


Answer = Annotated[
    NoulAnswer | ChoiceAnswer | ScoreAnswer | BoxAnswer, Field(discriminator="type")
]
Answers = Annotated[dict[Named, Answer], Field(min_length=1)]


class Usage(TypedDict):
    input_tokens: Annotated[int, Field(ge=0, strict=True)]
    output_tokens: Annotated[int, Field(ge=0, strict=True)]


class Decision(BaseModel):
    model: Named
    answers: Answers
    usage: Usage


class TracedDecision(Decision):
    traceId: TraceId


class ModelCard(BaseModel):
    name: Named
    description: str
    release_date: str


class ModelList(BaseModel):
    models: list[ModelCard]


DecisionHeaders = TypedDict(
    "DecisionHeaders",
    {
        "typesafe-danger-zone-images": Images,
        "typesafe-danger-zone-long-context": Images,
    },
    total=False,
)


class DecisionOptions(TypedDict):
    headers: DecisionHeaders


class Definition(BaseModel):
    model: Named
    questions: Questions
    options: DecisionOptions


class Draft(Definition):
    model_config = ConfigDict(extra="forbid")
    displayName: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None
    )
    baseUrl: str | None
    uiIgnored: bool


class PipelineQuestion(BaseModel):
    name: str
    alias: str | None
    answerShape: str
    primaryName: str | None
    question: Question


class Pipeline(BaseModel):
    id: UUID
    primaryGroupedPipelineId: UUID
    displayName: str | None
    uiIgnored: bool
    baseUrl: str | None
    createdAt: datetime
    model: str | None


class PipelineVersion(Pipeline):
    options: DecisionOptions | None
    questions: list[PipelineQuestion]


class PipelineSummary(Pipeline):
    questionCount: int
    comparabilityKey: str | None
    linkShapeKey: str | None


class EvolvePipeline(BaseModel):
    sourceId: UUID
    draft: Draft


class PipelineId(BaseModel):
    pipelineId: UUID


class UpdatePipelineName(PipelineId):
    displayName: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=100)
    ]


class SetPipelineIgnored(PipelineId):
    uiIgnored: bool


class UpdateQuestionAlias(PipelineId):
    questionName: Named
    alias: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
        ]
        | None
    )


class QuestionLink(BaseModel):
    name: Named
    primaryName: Named


class UpdateQuestionLinks(PipelineId):
    primaryPipelineId: UUID
    links: list[QuestionLink]


class ReplayPipeline(PipelineId):
    state: Content


class RunPipeline(ReplayPipeline):
    exact: bool


class RunAnnotation(PipelineId):
    questionLinks: list[tuple[str, str]]


class RunResult(TracedDecision):
    traceAnnotation: RunAnnotation


class TraceReference(PipelineId):
    traceId: TraceId


class SaveAnnotation(TraceReference):
    questionName: Named
    choiceKey: Named | None


class TraceAnnotation(BaseModel):
    questionName: str
    choiceKey: str


class TraceView(TypedDict):
    traceId: TraceId
    pipelineId: UUID
    startTime: datetime
    endTime: NotRequired[datetime]
    model: str | None
    failed: bool
    state: NotRequired[Content]
    answers: NotRequired[Answers]
    usage: NotRequired[Usage]
    observabilityUrl: NotRequired[str]
    payloadTruncated: bool
    historicalPlaceholder: bool
    annotations: list[TraceAnnotation]


class TracePipelineSummary(BaseModel):
    id: UUID
    name: str


class TracePipeline(TracePipelineSummary):
    questions: list[PipelineQuestion]


class TraceDetails(BaseModel):
    pipeline: TracePipelineSummary
    trace: TraceView
    questions: list[PipelineQuestion]


TraceStatus = Literal["all", "unannotated", "annotated"]
TraceOrder = Literal["recent", "least-single", "least-average", "most-average"]


class TracePage(BaseModel):
    pipeline: TracePipeline
    traces: list[TraceView]
    next: TraceId | None = None
    until: datetime


class ApiKeyName(BaseModel):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]


class ApiKey(BaseModel):
    id: UUID
    name: str
    prefix: str
    createdAt: datetime


class CreatedApiKey(ApiKey):
    secret: str


class DeletedApiKey(BaseModel):
    deleted: Literal[True]
