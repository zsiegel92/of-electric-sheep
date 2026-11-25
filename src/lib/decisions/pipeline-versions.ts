import "@tanstack/react-start/server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/db";
import {
  decisionPipelineDefinitions,
  decisionPipelineQuestions,
  decisionPipelines,
  decisionQuestionLinks,
  pipelineQuestionAliases,
} from "@/lib/db/schema";
import { question } from "@/lib/system-one/typesafe-api-schemas";
import type { PipelineVersion } from "./pipeline-schemas";

export function listPipelineVersions(
  userId: string,
  ids?: string[],
  { includePrimary = false } = {},
) {
  return readPipelineVersions(getDb(), userId, ids, includePrimary);
}

export async function readPipelineVersions(
  db: Pick<ReturnType<typeof getDb>, "select">,
  userId: string,
  ids?: string[],
  includePrimary = false,
) {
  const selected = ids && inArray(decisionPipelines.id, ids);
  const primaryIds =
    selected && includePrimary
      ? db
          .select({ id: decisionPipelines.primaryGroupedPipelineId })
          .from(decisionPipelines)
          .where(and(eq(decisionPipelines.userId, userId), selected))
      : undefined;
  const rows = await db
    .select({
      id: decisionPipelines.id,
      primaryGroupedPipelineId: decisionPipelines.primaryGroupedPipelineId,
      displayName: decisionPipelines.displayName,
      uiIgnored: decisionPipelines.uiIgnored,
      baseUrl: decisionPipelines.baseUrl,
      createdAt: decisionPipelines.createdAt,
      model: decisionPipelineDefinitions.model,
      options: decisionPipelineDefinitions.options,
      name: decisionPipelineQuestions.name,
      alias: pipelineQuestionAliases.alias,
      answerShape: decisionPipelineQuestions.answerShape,
      primaryName: decisionQuestionLinks.primaryName,
      question: sql<unknown>`jsonb_build_object('type', ${decisionPipelineQuestions.type})
        || case when ${decisionPipelineQuestions.systemPrompt} is not null
          then jsonb_build_object('instructions', ${decisionPipelineQuestions.systemPrompt}) else '{}'::jsonb end
        || case when ${decisionPipelineQuestions.criteria} is not null
          then jsonb_build_object('criteria', ${decisionPipelineQuestions.criteria}) else '{}'::jsonb end`,
    })
    .from(decisionPipelines)
    .leftJoin(
      decisionPipelineDefinitions,
      eq(decisionPipelineDefinitions.pipelineId, decisionPipelines.id),
    )
    .leftJoin(
      decisionPipelineQuestions,
      eq(
        decisionPipelineQuestions.pipelineId,
        decisionPipelineDefinitions.pipelineId,
      ),
    )
    .leftJoin(
      pipelineQuestionAliases,
      and(
        eq(
          pipelineQuestionAliases.pipelineId,
          decisionPipelineQuestions.pipelineId,
        ),
        eq(
          pipelineQuestionAliases.questionName,
          decisionPipelineQuestions.name,
        ),
      ),
    )
    .leftJoin(
      decisionQuestionLinks,
      and(
        eq(
          decisionQuestionLinks.pipelineId,
          decisionPipelineQuestions.pipelineId,
        ),
        eq(decisionQuestionLinks.name, decisionPipelineQuestions.name),
      ),
    )
    .where(
      and(
        eq(decisionPipelines.userId, userId),
        primaryIds
          ? or(selected, inArray(decisionPipelines.id, primaryIds))
          : selected,
      ),
    )
    .orderBy(
      desc(decisionPipelines.createdAt),
      decisionPipelines.id,
      decisionPipelineQuestions.name,
    );

  const versions = new Map<string, PipelineVersion>();
  for (const {
    name,
    alias,
    answerShape,
    primaryName,
    question: value,
    createdAt,
    ...pipeline
  } of rows) {
    const version = versions.get(pipeline.id) ?? {
      ...pipeline,
      createdAt: createdAt.toISOString(),
      questions: [],
    };
    versions.set(pipeline.id, version);
    if (name !== null && answerShape !== null) {
      version.questions.push({
        name,
        alias,
        answerShape,
        primaryName,
        question: question.parse(value),
      });
    }
  }
  return [...versions.values()];
}

export async function updatePipelineMetadata(
  userId: string,
  pipelineId: string,
  metadata: { displayName: string | null } | { uiIgnored: boolean },
) {
  const [pipeline] = await getDb()
    .update(decisionPipelines)
    .set(metadata)
    .where(
      and(
        eq(decisionPipelines.id, pipelineId),
        eq(decisionPipelines.userId, userId),
      ),
    )
    .returning({ id: decisionPipelines.id });
  if (!pipeline) throw new Error("Pipeline not found.");
}

export async function setPipelineQuestionAlias(
  userId: string,
  {
    pipelineId,
    questionName,
    alias,
  }: { pipelineId: string; questionName: string; alias: string | null },
) {
  return getDb().transaction(async (tx) => {
    const aliases = pipelineQuestionAliases;
    const [owned] = await tx
      .select({ name: decisionPipelineQuestions.name })
      .from(decisionPipelineQuestions)
      .innerJoin(
        decisionPipelines,
        eq(decisionPipelines.id, decisionPipelineQuestions.pipelineId),
      )
      .where(
        and(
          eq(decisionPipelines.userId, userId),
          eq(decisionPipelineQuestions.pipelineId, pipelineId),
          eq(decisionPipelineQuestions.name, questionName),
        ),
      )
      .for("key share");
    if (!owned) throw new Error("Question not found.");
    if (alias === null) {
      await tx
        .delete(aliases)
        .where(
          and(
            eq(aliases.pipelineId, pipelineId),
            eq(aliases.questionName, questionName),
          ),
        );
    } else {
      await tx
        .insert(aliases)
        .values({ pipelineId, questionName, alias })
        .onConflictDoUpdate({
          target: [aliases.pipelineId, aliases.questionName],
          set: { alias },
        });
    }
    return alias;
  });
}

export async function findPipelineVersions(
  userId: string,
  pipelineId: string,
  exact = false,
) {
  const id = pipelineId.toLowerCase();
  // Fetch both sides in one snapshot so the question links and primary agree.
  const versions = await listPipelineVersions(userId, [id], {
    includePrimary: !exact,
  });
  const version = versions.find((pipeline) => pipeline.id === id);
  const primary = exact
    ? version
    : versions.find(
        (pipeline) => pipeline.id === version?.primaryGroupedPipelineId,
      );
  return { version, primary };
}
