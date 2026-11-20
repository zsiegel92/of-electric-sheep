import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";
import { saveUser } from "@/lib/api-keys/queries";
import type { User } from "@/lib/auth";
import { getDb } from "@/lib/db/db";
import { decisionPipelines } from "@/lib/db/schema";
import { hashPipelineDefinition } from "./pipeline-key";
import type { PipelineDefinition } from "./pipeline-schemas";

export async function findDecisionPipeline(user: User, definitionHash: string) {
  const [pipeline] = await getDb()
    .select({ id: decisionPipelines.id, baseUrl: decisionPipelines.baseUrl })
    .from(decisionPipelines)
    .where(
      and(
        eq(decisionPipelines.userId, user.githubId),
        eq(decisionPipelines.definitionHash, definitionHash),
      ),
    );
  return pipeline ?? null;
}

export async function ensureDecisionPipeline(
  user: User,
  definition: PipelineDefinition,
) {
  const definitionHash = hashPipelineDefinition(definition);
  await getDb().transaction(async (tx) => {
    await saveUser(user, tx);
    await tx
      .insert(decisionPipelines)
      .values({ userId: user.githubId, definitionHash, definition })
      .onConflictDoNothing({
        target: [decisionPipelines.userId, decisionPipelines.definitionHash],
      });
  });
  return { userId: user.githubId, definitionHash };
}
