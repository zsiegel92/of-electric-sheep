import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { User } from "@/lib/auth";
import { getDb } from "@/lib/db/db";
import {
  decisionPipelineDefinitions,
  decisionPipelineQuestions,
  decisionPipelines,
} from "@/lib/db/schema";
import { hashPipelineDefinition } from "./pipeline-key";
import {
  type PipelineDefinition,
  pipelineDefinitionSchema,
} from "./pipeline-schemas";

export async function ensureDecisionPipeline(
  user: User,
  definition: PipelineDefinition,
) {
  const pipelineId = randomUUID();
  const definitionHash = hashPipelineDefinition(definition);
  const [pipeline] = await getDb()
    .insert(decisionPipelines)
    .values({
      id: pipelineId,
      userId: user.githubId,
      definitionHash,
      primaryGroupedPipelineId: pipelineId,
    })
    .onConflictDoUpdate({
      target: [decisionPipelines.userId, decisionPipelines.definitionHash],
      // No-op update lets RETURNING retrieve the winner without replacing its ID or endpoint.
      set: { definitionHash: decisionPipelines.definitionHash },
    })
    .returning({
      id: decisionPipelines.id,
      baseUrl: decisionPipelines.baseUrl,
      primaryGroupedPipelineId: decisionPipelines.primaryGroupedPipelineId,
      hasDefinition: sql<boolean>`exists (${sql`
        select 1 from ${decisionPipelineDefinitions}
        where ${decisionPipelineDefinitions.pipelineId} = ${decisionPipelines.id}
      `})`,
    });
  if (!pipeline)
    throw new Error("Could not create or retrieve decision pipeline");
  return { pipeline, wasCreated: pipeline.id === pipelineId };
}

export async function saveDecisionPipelineDefinition(
  pipelineId: string,
  userId: string,
  definition: PipelineDefinition,
) {
  await getDb().transaction(async (tx) => {
    const [pipeline] = await tx
      .select({ id: decisionPipelines.id })
      .from(decisionPipelines)
      .where(
        and(
          eq(decisionPipelines.id, pipelineId),
          eq(decisionPipelines.userId, userId),
          eq(
            decisionPipelines.definitionHash,
            hashPipelineDefinition(definition),
          ),
        ),
      )
      .for("no key update");
    if (!pipeline) return;

    const [stored] = await tx
      .select({ pipelineId: decisionPipelineDefinitions.pipelineId })
      .from(decisionPipelineDefinitions)
      .where(eq(decisionPipelineDefinitions.pipelineId, pipelineId));
    if (stored) return;

    // SQL NULL represents omission. JSON null represents a supplied null.
    const jsonNull = sql`'null'::jsonb`;
    await tx.insert(decisionPipelineQuestions).values(
      Object.entries(definition.questions).map(([name, question]) => ({
        pipelineId,
        name,
        type: question.type,
        systemPrompt:
          question.instructions === null
            ? jsonNull
            : (question.instructions ?? null),
        criteria:
          "criteria" in question
            ? question.criteria === null
              ? jsonNull
              : (question.criteria ?? null)
            : null,
      })),
    );
    // The FK is deferred until commit. Inserting the definition seals its question set.
    await tx.insert(decisionPipelineDefinitions).values({
      pipelineId,
      model: definition.model,
      options: definition.options,
    });
  });
}

export async function findDecisionPipeline(userId: string, pipelineId: string) {
  const primary = alias(decisionPipelines, "primary_pipeline");
  const rows = await getDb()
    .select({
      id: primary.id,
      baseUrl: primary.baseUrl,
      model: decisionPipelineDefinitions.model,
      options: decisionPipelineDefinitions.options,
      name: decisionPipelineQuestions.name,
      type: decisionPipelineQuestions.type,
      instructions: sql<
        string | null
      >`${decisionPipelineQuestions.systemPrompt}::text`,
      criteria: sql<string | null>`${decisionPipelineQuestions.criteria}::text`,
    })
    .from(decisionPipelines)
    .innerJoin(
      primary,
      eq(primary.id, decisionPipelines.primaryGroupedPipelineId),
    )
    .innerJoin(
      decisionPipelineDefinitions,
      eq(decisionPipelineDefinitions.pipelineId, primary.id),
    )
    .innerJoin(
      decisionPipelineQuestions,
      eq(decisionPipelineQuestions.pipelineId, primary.id),
    )
    .where(
      and(
        eq(decisionPipelines.id, pipelineId),
        eq(decisionPipelines.userId, userId),
      ),
    );

  const first = rows[0];
  if (!first) return;

  const definition = pipelineDefinitionSchema.parse({
    model: first.model,
    options: first.options,
    questions: Object.fromEntries(
      rows.map(({ name, type, instructions, criteria }) => [
        name,
        {
          type,
          ...(instructions !== null && {
            instructions: JSON.parse(instructions),
          }),
          ...(criteria !== null && { criteria: JSON.parse(criteria) }),
        },
      ]),
    ),
  });
  return {
    definition,
    pipeline: { id: first.id, baseUrl: first.baseUrl, hasDefinition: true },
  };
}
