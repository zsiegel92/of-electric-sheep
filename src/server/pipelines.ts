import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { processStoredDecision } from "@/lib/decisions/decide";
import { pipelineDraftSchema } from "@/lib/decisions/pipeline-draft";
import {
  editablePipelineBaseUrls,
  evolveDecisionPipeline,
  listPipelineVersions,
  promoteDecisionPipeline,
  saveQuestionLinks,
  updatePipelineMetadata,
} from "@/lib/decisions/queries";
import {
  pipelineQuestionKinds,
  questionAnswerShapes,
} from "@/lib/decisions/question-links";
import { systemOneRequest } from "@/lib/system-one/typesafe-api-schemas";

const id = z.uuid().transform((value) => value.toLowerCase());

export const listPipelines = createServerFn().handler(async ({ context }) => {
  const user = requireUser(context.user);
  return (await listPipelineVersions(user.githubId)).map(
    ({ questions, options: _options, ...pipeline }) => ({
      ...pipeline,
      questionCount: questions.length,
      comparabilityKey: pipelineQuestionKinds(questions),
      linkShapeKey: questions.length
        ? createHash("sha256")
            .update(questionAnswerShapes(questions))
            .digest("hex")
        : null,
    }),
  );
});

export const getPipelineVersions = createServerFn()
  .validator(z.array(id).max(3))
  .handler(({ data, context }) =>
    listPipelineVersions(
      requireUser(context.user).githubId,
      data,
      undefined,
      true,
    ),
  );

export const getPipelineQuestions = createServerFn()
  .validator(id)
  .handler(async ({ data, context }) => {
    const [pipeline] = await listPipelineVersions(
      requireUser(context.user).githubId,
      [data],
    );
    if (!pipeline) throw new Error("Pipeline not found.");
    return pipeline.questions;
  });

export const getEditablePipelineBaseUrls = createServerFn().handler(
  ({ context }) => {
    requireUser(context.user);
    return editablePipelineBaseUrls();
  },
);

export const evolvePipeline = createServerFn({ method: "POST" })
  .validator(z.object({ sourceId: id, draft: pipelineDraftSchema }))
  .handler(({ data, context }) =>
    evolveDecisionPipeline(
      requireUser(context.user).githubId,
      data.sourceId,
      data.draft,
    ),
  );

export const makePipelinePrimary = createServerFn({ method: "POST" })
  .validator(id)
  .handler(({ data, context }) =>
    promoteDecisionPipeline(requireUser(context.user).githubId, data),
  );

export const updatePipeline = createServerFn({ method: "POST" })
  .validator(
    z.object({ pipelineId: id }).and(
      z.union([
        z.object({
          displayName: z
            .string()
            .trim()
            .max(100)
            .transform((name) => name || null),
        }),
        z.object({ uiIgnored: z.boolean() }),
      ]),
    ),
  )
  .handler(({ data: { pipelineId, ...metadata }, context }) =>
    updatePipelineMetadata(
      requireUser(context.user).githubId,
      pipelineId,
      metadata,
    ),
  );

export const updateQuestionLinks = createServerFn({ method: "POST" })
  .validator(
    z.object({
      pipelineId: id,
      primaryPipelineId: id,
      links: z.array(
        z.object({ name: z.string().min(1), primaryName: z.string().min(1) }),
      ),
    }),
  )
  .handler(({ data, context }) =>
    saveQuestionLinks(
      requireUser(context.user).githubId,
      data.pipelineId,
      data.primaryPipelineId,
      data.links,
    ),
  );

export const runStoredPipeline = createServerFn({ method: "POST" })
  .validator(
    z.object({
      pipelineId: id,
      state: systemOneRequest.shape.state,
      exact: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await processStoredDecision(
      data.pipelineId,
      data.state,
      requireUser(context.user),
      data.exact,
    );
    if (!result) throw new Error("Pipeline definition is not ready.");
    return result;
  });
