"""SQLModel schema used by Atlas to generate SQL migrations."""

# SQLModel accepts explicit table names and types its default as a declared_attr.
# pyright: reportAssignmentType=false, reportIncompatibleVariableOverride=false

from datetime import datetime
from typing import ClassVar
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Computed,
    DateTime,
    Double,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class UserRow(SQLModel, table=True):
    __tablename__: ClassVar[str] = "users"
    github_id: str = Field(sa_column=Column(Text, primary_key=True))
    name: str = Field(sa_column=Column(Text, nullable=False))
    email: str | None = Field(sa_column=Column(Text))


class ApiKeyRow(SQLModel, table=True):
    __tablename__: ClassVar[str] = "api_keys"
    __table_args__ = (
        UniqueConstraint("key_hash", name="api_keys_key_hash_unique"),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.github_id"],
            name="api_keys_user_id_users_github_id_fk",
            ondelete="CASCADE",
        ),
        Index("api_keys_user_id_idx", "user_id"),
    )
    id: UUID = Field(
        primary_key=True, sa_column_kwargs={"server_default": text("gen_random_uuid()")}
    )
    user_id: str = Field(sa_column=Column(Text, nullable=False))
    name: str = Field(sa_column=Column(Text, nullable=False))
    prefix: str = Field(sa_column=Column(Text, nullable=False))
    key_hash: str = Field(sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True), nullable=False, server_default=text("now()")
        )
    )


class PipelineRow(SQLModel, table=True):
    __tablename__: ClassVar[str] = "decision_pipelines"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "id",
            "primary_grouped_pipeline_id",
            name="decision_pipelines_user_id_primary_group_key",
        ),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.github_id"],
            name="decision_pipelines_user_id_users_github_id_fk",
            ondelete="CASCADE",
        ),
        Index(
            "decision_pipelines_user_definition_idx",
            "user_id",
            "definition_hash",
            unique=True,
        ),
    )
    id: UUID = Field(
        primary_key=True, sa_column_kwargs={"server_default": text("gen_random_uuid()")}
    )
    user_id: str = Field(sa_column=Column(Text, nullable=False))
    definition_hash: str = Field(sa_column=Column(Text, nullable=False))
    primary_grouped_pipeline_id: UUID
    display_name: str | None = Field(sa_column=Column(Text))
    ui_ignored: bool = Field(
        sa_column=Column(Boolean, nullable=False, server_default=text("false"))
    )
    base_url: str | None = Field(sa_column=Column(Text))
    created_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True), nullable=False, server_default=text("now()")
        )
    )


class PipelineDefinitionRow(SQLModel, table=True):
    __tablename__: ClassVar[str] = "decision_pipeline_definitions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["pipeline_id"],
            ["decision_pipelines.id"],
            name="decision_pipeline_definitions_pipeline_id_decision_pipelines_id",
            ondelete="CASCADE",
        ),
    )
    pipeline_id: UUID = Field(primary_key=True)
    model: str = Field(sa_column=Column(Text, nullable=False))
    options: dict = Field(sa_column=Column(JSONB, nullable=False))


class PipelineQuestionRow(SQLModel, table=True):
    __tablename__: ClassVar[str] = "decision_pipeline_questions"
    __table_args__ = (
        PrimaryKeyConstraint(
            "pipeline_id",
            "name",
            name="decision_pipeline_questions_pipeline_id_name_pk",
        ),
        UniqueConstraint(
            "pipeline_id",
            "name",
            "answer_shape",
            name="decision_question_answer_shape_key",
        ),
        ForeignKeyConstraint(
            ["pipeline_id"],
            ["decision_pipeline_definitions.pipeline_id"],
            name="decision_pipeline_questions_pipeline_id_decision_pipeline_defin",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
    )
    pipeline_id: UUID = Field(primary_key=True)
    name: str = Field(sa_column=Column(Text, primary_key=True))
    type: str = Field(sa_column=Column(Text, nullable=False))
    system_prompt: str | dict | list | None = Field(sa_column=Column(JSONB))
    criteria: dict | list | None = Field(sa_column=Column(JSONB))
    answer_shape: str = Field(
        sa_column=Column(
            Text,
            Computed(
                'public.system_one_answer_shape("type", criteria)', persisted=True
            ),
            nullable=False,
        )
    )


class QuestionLinkRow(SQLModel, table=True):
    __tablename__: ClassVar[str] = "decision_question_links"
    __table_args__ = (
        PrimaryKeyConstraint(
            "pipeline_id", "name", name="decision_question_links_pipeline_id_name_pk"
        ),
        UniqueConstraint(
            "pipeline_id",
            "primary_name",
            name="decision_question_links_primary_name_key",
        ),
        CheckConstraint(
            "pipeline_id <> primary_pipeline_id",
            name="decision_question_links_non_primary",
        ),
        ForeignKeyConstraint(
            ["user_id", "pipeline_id", "primary_pipeline_id"],
            [
                "decision_pipelines.user_id",
                "decision_pipelines.id",
                "decision_pipelines.primary_grouped_pipeline_id",
            ],
            name="decision_question_links_group_fk",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["pipeline_id", "name", "answer_shape"],
            [
                "decision_pipeline_questions.pipeline_id",
                "decision_pipeline_questions.name",
                "decision_pipeline_questions.answer_shape",
            ],
            name="decision_question_links_question_fk",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["primary_pipeline_id", "primary_name", "answer_shape"],
            [
                "decision_pipeline_questions.pipeline_id",
                "decision_pipeline_questions.name",
                "decision_pipeline_questions.answer_shape",
            ],
            name="decision_question_links_primary_question_fk",
            ondelete="CASCADE",
        ),
    )
    user_id: str = Field(sa_column=Column(Text, nullable=False))
    pipeline_id: UUID = Field(primary_key=True)
    primary_pipeline_id: UUID
    name: str = Field(sa_column=Column(Text, primary_key=True))
    primary_name: str = Field(sa_column=Column(Text, nullable=False))
    answer_shape: str = Field(sa_column=Column(Text, nullable=False))


class QuestionAliasRow(SQLModel, table=True):
    __tablename__: ClassVar[str] = "pipeline_question_aliases"
    __table_args__ = (
        PrimaryKeyConstraint(
            "pipeline_id", "question_name", name="pipeline_question_aliases_pk"
        ),
        ForeignKeyConstraint(
            ["pipeline_id", "question_name"],
            [
                "decision_pipeline_questions.pipeline_id",
                "decision_pipeline_questions.name",
            ],
            name="pipeline_question_aliases_question_fk",
            ondelete="CASCADE",
        ),
    )
    pipeline_id: UUID = Field(primary_key=True)
    question_name: str = Field(sa_column=Column(Text, primary_key=True))
    alias: str = Field(sa_column=Column(Text, nullable=False))


class TraceRow(SQLModel, table=True):
    __tablename__: ClassVar[str] = "decision_traces"
    __table_args__ = (
        PrimaryKeyConstraint("pipeline_id", "trace_id", name="decision_traces_pk"),
        ForeignKeyConstraint(
            ["pipeline_id"],
            ["decision_pipelines.id"],
            name="decision_traces_pipeline_id_decision_pipelines_id_fk",
            ondelete="CASCADE",
        ),
        Index("decision_traces_id_idx", "trace_id"),
        Index(
            "decision_traces_recent_idx",
            "pipeline_id",
            text("started_at DESC NULLS LAST"),
            text("trace_id DESC NULLS LAST"),
        ),
    )
    pipeline_id: UUID = Field(primary_key=True)
    trace_id: str = Field(sa_column=Column(Text, primary_key=True))
    started_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    ended_at: datetime | None = Field(sa_column=Column(DateTime(timezone=True)))
    recorded_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True), nullable=False, server_default=text("now()")
        )
    )
    model: str | None = Field(sa_column=Column(Text))
    failed: bool = Field(
        sa_column=Column(Boolean, nullable=False, server_default=text("false"))
    )
    state: str | dict | list | None = Field(sa_column=Column(JSONB))
    answers: dict | None = Field(sa_column=Column(JSONB))
    usage: dict | None = Field(sa_column=Column(JSONB))
    min_confidence: float | None = Field(sa_column=Column(Double))
    average_confidence: float | None = Field(sa_column=Column(Double))
    observability_url: str | None = Field(sa_column=Column(Text))
    payload_truncated: bool = Field(
        sa_column=Column(Boolean, nullable=False, server_default=text("false"))
    )
    historical_placeholder: bool = Field(
        sa_column=Column(Boolean, nullable=False, server_default=text("false"))
    )


class TraceAnnotationRow(SQLModel, table=True):
    __tablename__: ClassVar[str] = "decision_trace_annotations"
    __table_args__ = (
        PrimaryKeyConstraint(
            "pipeline_id",
            "trace_id",
            "question_name",
            name="decision_trace_annotations_pk",
        ),
        ForeignKeyConstraint(
            ["pipeline_id", "trace_id"],
            ["decision_traces.pipeline_id", "decision_traces.trace_id"],
            name="decision_trace_annotations_trace_fk",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["pipeline_id", "question_name"],
            [
                "decision_pipeline_questions.pipeline_id",
                "decision_pipeline_questions.name",
            ],
            name="decision_trace_annotations_question_fk",
            ondelete="CASCADE",
        ),
    )
    pipeline_id: UUID = Field(primary_key=True)
    trace_id: str = Field(sa_column=Column(Text, primary_key=True))
    question_name: str = Field(sa_column=Column(Text, primary_key=True))
    choice_key: str = Field(sa_column=Column(Text, nullable=False))
    updated_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True), nullable=False, server_default=text("now()")
        )
    )
