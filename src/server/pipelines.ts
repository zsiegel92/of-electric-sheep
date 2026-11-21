import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { processStoredDecision } from "@/lib/decisions/decide";
import {
  listPipelineVersions,
  saveQuestionLinks,
} from "@/lib/decisions/queries";
import { systemOneRequest } from "@/lib/system-one/typesafe-api-schemas";

const id = z.uuid().transform((value) => value.toLowerCase());

export const listPipelines = createServerFn().handler(async ({ context }) => {
  const user = requireUser(context.user);
  return (await listPipelineVersions(user.githubId)).map(
    ({ questions, options: _options, ...pipeline }) => ({
      ...pipeline,
      questionCount: questions.length,
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
