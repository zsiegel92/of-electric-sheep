import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import type { User } from "@/lib/auth";
import { getDb } from "@/lib/db/db";
import { decisionPipelines } from "@/lib/db/schema";
import { hashPipelineDefinition } from "./pipeline-key";
import type { PipelineDefinition } from "./pipeline-schemas";

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
      definition,
    })
    .onConflictDoUpdate({
      target: [decisionPipelines.userId, decisionPipelines.definitionHash],
      // No-op update lets RETURNING retrieve the winner without replacing its ID or endpoint.
      set: { definitionHash: decisionPipelines.definitionHash },
    })
    .returning({
      id: decisionPipelines.id,
      baseUrl: decisionPipelines.baseUrl,
    });
  if (!pipeline)
    throw new Error("Could not create or retrieve decision pipeline");
  return { pipeline, wasCreated: pipeline.id === pipelineId };
}
