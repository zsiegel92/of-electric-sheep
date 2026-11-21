import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { User } from "@/lib/auth";
import { getDb } from "@/lib/db/db";
import {
  decisionPipelineDefinitions,
  decisionPipelineQuestions,
  decisionPipelines,
  decisionQuestionLinks,
} from "@/lib/db/schema";
import { question } from "@/lib/system-one/typesafe-api-schemas";
import { hashPipelineDefinition } from "./pipeline-key";
import type { PipelineDefinition } from "./pipeline-schemas";
import type { PipelineVersion } from "./question-links";

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

export async function listPipelineVersions(
  userId: string,
  ids?: string[],
  db: Pick<ReturnType<typeof getDb>, "select"> = getDb(),
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
      baseUrl: decisionPipelines.baseUrl,
      createdAt: decisionPipelines.createdAt,
      model: decisionPipelineDefinitions.model,
      options: decisionPipelineDefinitions.options,
      name: decisionPipelineQuestions.name,
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
        answerShape,
        primaryName,
        question: question.parse(value),
      });
    }
  }
  return [...versions.values()];
}

export async function findPipelineVersions(
  userId: string,
  pipelineId: string,
  exact = false,
) {
  const id = pipelineId.toLowerCase();
  // Fetch both sides in one snapshot so the question links and primary agree.
  const versions = await listPipelineVersions(userId, [id], getDb(), !exact);
  const version = versions.find((pipeline) => pipeline.id === id);
  const primary = exact
    ? version
    : versions.find(
        (pipeline) => pipeline.id === version?.primaryGroupedPipelineId,
      );
  return { version, primary };
}

export async function saveQuestionLinks(
  userId: string,
  pipelineId: string,
  primaryPipelineId: string,
  links: { name: string; primaryName: string }[],
) {
  if (pipelineId === primaryPipelineId)
    throw new Error("Select two different versions.");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .select({ id: decisionPipelines.id })
      .from(decisionPipelines)
      .where(
        and(
          eq(decisionPipelines.userId, userId),
          inArray(decisionPipelines.id, [pipelineId, primaryPipelineId]),
        ),
      )
      .orderBy(decisionPipelines.id)
      .for("update");
    const versions = await listPipelineVersions(
      userId,
      [pipelineId, primaryPipelineId],
      tx,
    );
    const version = versions.find((row) => row.id === pipelineId);
    const primary = versions.find((row) => row.id === primaryPipelineId);
    if (!version || primary?.primaryGroupedPipelineId !== primaryPipelineId) {
      throw new Error("Select a pipeline and its primary version.");
    }
    if (version.primaryGroupedPipelineId !== primaryPipelineId) {
      const [member] = await tx
        .select({ id: decisionPipelines.id })
        .from(decisionPipelines)
        .where(
          and(
            eq(decisionPipelines.userId, userId),
            eq(decisionPipelines.primaryGroupedPipelineId, pipelineId),
            sql`${decisionPipelines.id} <> ${pipelineId}`,
          ),
        )
        .limit(1);
      if (version.primaryGroupedPipelineId !== pipelineId || member) {
        throw new Error("Only a standalone pipeline can join another group.");
      }
      await tx
        .update(decisionPipelines)
        .set({ primaryGroupedPipelineId: primaryPipelineId })
        .where(
          and(
            eq(decisionPipelines.userId, userId),
            eq(decisionPipelines.id, pipelineId),
          ),
        );
    }

    const source = new Map(
      version.questions.map(({ name, answerShape }) => [name, answerShape]),
    );
    const target = new Map(
      primary.questions.map(({ name, answerShape }) => [name, answerShape]),
    );
    if (
      !source.size ||
      links.length !== source.size ||
      links.length !== target.size ||
      new Set(links.map(({ name }) => name)).size !== links.length ||
      new Set(links.map(({ primaryName }) => primaryName)).size !==
        links.length ||
      links.some(
        ({ name, primaryName }) =>
          !source.has(name) || source.get(name) !== target.get(primaryName),
      )
    ) {
      throw new Error(
        "Link every question to one compatible primary question.",
      );
    }
    await tx
      .delete(decisionQuestionLinks)
      .where(eq(decisionQuestionLinks.pipelineId, pipelineId));
    await tx.insert(decisionQuestionLinks).values(
      links.map(({ name, primaryName }) => ({
        userId,
        pipelineId,
        primaryPipelineId,
        name,
        primaryName,
        answerShape: source.get(name) ?? "",
      })),
    );
  });
}
