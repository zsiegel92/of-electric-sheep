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
  pipelineQuestionAliases,
  users,
} from "@/lib/db/schema";
import { question } from "@/lib/system-one/typesafe-api-schemas";
import { type PipelineDraft, pipelineExecutionKey } from "./pipeline-draft";
import { hashPipelineDefinition } from "./pipeline-key";
import type { PipelineDefinition } from "./pipeline-schemas";
import {
  compatibleQuestions,
  matchQuestions,
  type PipelineVersion,
} from "./question-links";

type PipelineTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

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

    await insertPipelineDefinition(tx, pipelineId, definition);
  });
}

async function insertPipelineDefinition(
  tx: PipelineTransaction,
  pipelineId: string,
  definition: PipelineDefinition,
) {
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
  await writePipelineGroup(userId, async (tx) => {
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
    const [source] = await listPipelineVersions(userId, [sourceId], tx);
    if (!source?.options)
      throw new Error("The source pipeline definition is not ready.");
    if (
      pipelineExecutionKey(draft) ===
      pipelineExecutionKey({
        baseUrl: source.baseUrl,
        model: source.model,
        options: source.options,
        questions: Object.fromEntries(
          source.questions.map(({ name, question }) => [name, question]),
        ),
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

    const versions = await listPipelineVersions(
      userId,
      [id, source.primaryGroupedPipelineId],
      tx,
    );
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
    const [version] = await listPipelineVersions(userId, [pipelineId], tx);
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
    const versions = await listPipelineVersions(
      userId,
      members.map(({ id }) => id),
      tx,
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
