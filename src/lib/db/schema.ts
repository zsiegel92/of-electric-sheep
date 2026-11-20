import {
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
      // Migration 0004 defers this FK so question rows can be inserted before the definition.
      .references(() => decisionPipelineDefinitions.pipelineId, {
        onDelete: "cascade",
      }),
    name: text().notNull(),
    type: text({ enum: ["noul", "choice", "score", "box"] }).notNull(),
    systemPrompt:
      jsonb("system_prompt").$type<DecisionQuestion["instructions"]>(),
    criteria:
      jsonb().$type<Exclude<DecisionQuestion, { type: "box" }>["criteria"]>(),
  },
  (table) => [primaryKey({ columns: [table.pipelineId, table.name] })],
);
