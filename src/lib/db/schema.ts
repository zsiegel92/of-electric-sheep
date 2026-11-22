import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PipelineDefinition } from "@/lib/decisions/pipeline-schemas";

type DecisionQuestion = PipelineDefinition["questions"][string];

export const users = pgTable("users", {
  githubId: text("github_id").primaryKey(),
  name: text().notNull(),
  email: text(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.githubId, { onDelete: "cascade" }),
    name: text().notNull(),
    prefix: text().notNull(),
    keyHash: text("key_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("api_keys_user_id_idx").on(table.userId)],
);

export const decisionPipelines = pgTable(
  "decision_pipelines",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.githubId, { onDelete: "cascade" }),
    definitionHash: text("definition_hash").notNull(),
    primaryGroupedPipelineId: uuid("primary_grouped_pipeline_id").notNull(),
    displayName: text("display_name"),
    uiIgnored: boolean("ui_ignored").notNull().default(false),
    baseUrl: text("base_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("decision_pipelines_user_definition_idx").on(
      table.userId,
      table.definitionHash,
    ),
    unique("decision_pipelines_user_id_primary_group_key").on(
      table.userId,
      table.id,
      table.primaryGroupedPipelineId,
    ),
    foreignKey({
      name: "decision_pipelines_primary_grouped_pipeline_fk",
      // The target's ID and its pointer must both match this row's pointer.
      columns: [
        table.userId,
        table.primaryGroupedPipelineId,
        table.primaryGroupedPipelineId,
      ],
      foreignColumns: [table.userId, table.id, table.primaryGroupedPipelineId],
    }),
  ],
);

export const decisionPipelineDefinitions = pgTable(
  "decision_pipeline_definitions",
  {
    pipelineId: uuid("pipeline_id")
      .primaryKey()
      .references(() => decisionPipelines.id, { onDelete: "cascade" }),
    model: text().notNull(),
    options: jsonb().$type<PipelineDefinition["options"]>().notNull(),
  },
);

export const decisionPipelineQuestions = pgTable(
  "decision_pipeline_questions",
  {
    pipelineId: uuid("pipeline_id")
      .notNull()
      // The pipeline invariants migration defers this FK so questions can be inserted first.
      .references(() => decisionPipelineDefinitions.pipelineId, {
        onDelete: "cascade",
      }),
    name: text().notNull(),
    type: text({ enum: ["noul", "choice", "score", "box"] }).notNull(),
    systemPrompt:
      jsonb("system_prompt").$type<DecisionQuestion["instructions"]>(),
    criteria:
      jsonb().$type<Exclude<DecisionQuestion, { type: "box" }>["criteria"]>(),
    answerShape: text("answer_shape")
      .notNull()
      .generatedAlwaysAs(
        sql`public.system_one_answer_shape("type", "criteria")`,
      ),
  },
  (table) => [
    primaryKey({ columns: [table.pipelineId, table.name] }),
    unique("decision_question_answer_shape_key").on(
      table.pipelineId,
      table.name,
      table.answerShape,
    ),
  ],
);

export const decisionQuestionLinks = pgTable(
  "decision_question_links",
  {
    userId: text("user_id").notNull(),
    pipelineId: uuid("pipeline_id").notNull(),
    primaryPipelineId: uuid("primary_pipeline_id").notNull(),
    name: text().notNull(),
    primaryName: text("primary_name").notNull(),
    answerShape: text("answer_shape").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.pipelineId, table.name] }),
    unique("decision_question_links_primary_name_key").on(
      table.pipelineId,
      table.primaryName,
    ),
    check(
      "decision_question_links_non_primary",
      sql`${table.pipelineId} <> ${table.primaryPipelineId}`,
    ),
    foreignKey({
      name: "decision_question_links_group_fk",
      columns: [table.userId, table.pipelineId, table.primaryPipelineId],
      foreignColumns: [
        decisionPipelines.userId,
        decisionPipelines.id,
        decisionPipelines.primaryGroupedPipelineId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "decision_question_links_question_fk",
      columns: [table.pipelineId, table.name, table.answerShape],
      foreignColumns: [
        decisionPipelineQuestions.pipelineId,
        decisionPipelineQuestions.name,
        decisionPipelineQuestions.answerShape,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "decision_question_links_primary_question_fk",
      columns: [table.primaryPipelineId, table.primaryName, table.answerShape],
      foreignColumns: [
        decisionPipelineQuestions.pipelineId,
        decisionPipelineQuestions.name,
        decisionPipelineQuestions.answerShape,
      ],
    }).onDelete("cascade"),
  ],
);

export const decisionTraceAnnotations = pgTable(
  "decision_trace_annotations",
  {
    pipelineId: uuid("pipeline_id").notNull(),
    traceId: text("trace_id").notNull(),
    questionName: text("question_name").notNull(),
    choiceKey: text("choice_key").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "decision_trace_annotations_pk",
      columns: [table.pipelineId, table.traceId, table.questionName],
    }),
    foreignKey({
      name: "decision_trace_annotations_question_fk",
      columns: [table.pipelineId, table.questionName],
      foreignColumns: [
        decisionPipelineQuestions.pipelineId,
        decisionPipelineQuestions.name,
      ],
    }).onDelete("cascade"),
  ],
);
