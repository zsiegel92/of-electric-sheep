import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PipelineDefinition } from "@/lib/decisions/pipeline-schemas";

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
    definition: jsonb().$type<PipelineDefinition>().notNull(),
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
  ],
);
