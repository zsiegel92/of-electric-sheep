import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/db";
import {
  decisionPipelines,
  decisionQuestionLinks,
  users,
} from "@/lib/db/schema";
import { insertPipelineDefinition } from "./pipeline-definitions";
import {
  type PipelineDraft,
  pipelineExecutionKey,
  pipelineSnapshot,
} from "./pipeline-draft";
import { hashPipelineDefinition } from "./pipeline-key";
import type { PipelineVersion } from "./pipeline-schemas";
import { readPipelineVersions } from "./pipeline-versions";
import { compatibleQuestions, matchQuestions } from "./question-links";

type PipelineTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export async function saveQuestionLinks(
  userId: string,
  pipelineId: string,
  primaryPipelineId: string,
  links: { name: string; primaryName: string }[],
) {
  if (pipelineId === primaryPipelineId)
    throw new Error("Select two different versions.");
  await writePipelineGroup(userId, async (tx) => {
    const versions = await readPipelineVersions(tx, userId, [
      pipelineId,
      primaryPipelineId,
    ]);
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

    await replaceQuestionLinks(tx, userId, version, primary, links);
  });
}

async function replaceQuestionLinks(
  tx: PipelineTransaction,
  userId: string,
  version: PipelineVersion,
  primary: PipelineVersion,
  links: { name: string; primaryName: string }[],
) {
  const { id: pipelineId } = version;
  const { id: primaryPipelineId } = primary;
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
    throw new Error("Link every question to one compatible primary question.");
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
}

function writePipelineGroup<T>(
  userId: string,
  write: (tx: PipelineTransaction) => Promise<T>,
) {
  return getDb().transaction(async (tx) => {
    // Serialize membership changes and promotion for this owner.
    await tx
      .select({ id: users.githubId })
      .from(users)
      .where(eq(users.githubId, userId))
      .for("no key update");
    return write(tx);
  });
}

export function editablePipelineBaseUrls() {
  return (process.env["TYPESAFE_PIPELINE_BASE_URLS"] ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

export async function evolveDecisionPipeline(
  userId: string,
  sourceId: string,
  draft: PipelineDraft,
) {
  const { baseUrl, displayName, uiIgnored, ...definition } = draft;
  return writePipelineGroup(userId, async (tx) => {
    const [source] = await readPipelineVersions(tx, userId, [sourceId]);
    if (!source?.options)
      throw new Error("The source pipeline definition is not ready.");
    if (
      pipelineExecutionKey(draft) ===
      pipelineExecutionKey({
        ...pipelineSnapshot(source),
        options: source.options,
      })
    ) {
      throw new Error(
        "Change the pipeline definition before saving a version.",
      );
    }
    if (
      baseUrl &&
      baseUrl !== source.baseUrl &&
      !editablePipelineBaseUrls().includes(baseUrl)
    ) {
      throw new Error(
        "Choose the default upstream or a configured pipeline URL.",
      );
    }

    const id = randomUUID();
    const row = {
      id,
      userId,
      baseUrl,
      displayName,
      uiIgnored,
      definitionHash: hashPipelineDefinition(definition, baseUrl),
      primaryGroupedPipelineId: id,
    } satisfies typeof decisionPipelines.$inferInsert;
    const [inserted] = await tx
      .insert(decisionPipelines)
      .values(row)
      .onConflictDoNothing({
        target: [decisionPipelines.userId, decisionPipelines.definitionHash],
      })
      .returning({ id: decisionPipelines.id });
    if (!inserted)
      throw new Error("A pipeline with this definition already exists.");
    await insertPipelineDefinition(tx, id, definition);

    const versions = await readPipelineVersions(tx, userId, [
      id,
      source.primaryGroupedPipelineId,
    ]);
    const version = versions.find((row) => row.id === id);
    const primary = versions.find(
      (row) => row.id === source.primaryGroupedPipelineId,
    );
    if (
      !version ||
      !primary ||
      !compatibleQuestions(version, source) ||
      !compatibleQuestions(source, primary)
    )
      return { id };
    const throughSource = matchQuestions(version, source);
    const sourceToPrimary = matchQuestions(source, primary);
    const primaryNames = new Map(
      primary.questions.map((question) => [
        question.name,
        question.answerShape,
      ]),
    );
    const links = version.questions.flatMap(({ name, answerShape }) => {
      const sourceName = throughSource.get(name);
      const primaryName =
        sourceName === undefined ? undefined : sourceToPrimary.get(sourceName);
      return primaryName !== undefined &&
        primaryNames.get(primaryName) === answerShape
        ? [{ name, primaryName }]
        : [];
    });
    if (links.length === version.questions.length) {
      await tx
        .update(decisionPipelines)
        .set({ primaryGroupedPipelineId: primary.id })
        .where(eq(decisionPipelines.id, id));
      await replaceQuestionLinks(tx, userId, version, primary, links);
    }
    return { id };
  });
}

export function promoteDecisionPipeline(userId: string, pipelineId: string) {
  return writePipelineGroup(userId, async (tx) => {
    const [version] = await readPipelineVersions(tx, userId, [pipelineId]);
    if (!version?.options) throw new Error("Pipeline definition is not ready.");
    if (version.primaryGroupedPipelineId === pipelineId) return;

    const group = and(
      eq(decisionPipelines.userId, userId),
      eq(
        decisionPipelines.primaryGroupedPipelineId,
        version.primaryGroupedPipelineId,
      ),
    );
    const members = await tx
      .select({ id: decisionPipelines.id })
      .from(decisionPipelines)
      .where(group);
    const versions = await readPipelineVersions(
      tx,
      userId,
      members.map(({ id }) => id),
    );
    const oldPrimary = versions.find(
      ({ id }) => id === version.primaryGroupedPipelineId,
    );
    if (!oldPrimary) throw new Error("The current primary was not found.");
    const toNewPrimary = new Map(
      [...matchQuestions(version, oldPrimary)].map(([name, oldName]) => [
        oldName,
        name,
      ]),
    );

    await tx.delete(decisionQuestionLinks).where(
      inArray(
        decisionQuestionLinks.pipelineId,
        members.map(({ id }) => id),
      ),
    );
    await tx
      .update(decisionPipelines)
      .set({ primaryGroupedPipelineId: pipelineId })
      .where(group);
    for (const member of versions) {
      if (member.id === pipelineId) continue;
      const links = [...matchQuestions(member, oldPrimary)].flatMap(
        ([name, oldName]) => {
          const primaryName = toNewPrimary.get(oldName);
          return primaryName === undefined ? [] : [{ name, primaryName }];
        },
      );
      await replaceQuestionLinks(tx, userId, member, version, links);
    }
  });
}
