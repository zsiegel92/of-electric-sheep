import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { listPipelineVersions } from "@/lib/decisions/queries";
import {
  findDecisionTrace,
  getPipelineTracePage,
} from "@/lib/langfuse/decision-traces";
import { traceId } from "@/lib/langfuse/schemas";

export const listPipelineTraces = createServerFn()
  .validator(
    z.object({
      pipelineId: z.uuid(),
      cursor: z.string().optional(),
      until: z.iso.datetime().optional(),
    }),
  )
  .handler(async ({ data: { pipelineId, ...page }, context }) => {
    const user = requireUser(context.user);
    const [pipeline] = await listPipelineVersions(user.githubId, [pipelineId]);
    if (!pipeline) throw notFound();
    return {
      pipeline: {
        id: pipeline.id,
        name: pipeline.displayName ?? pipeline.model ?? pipeline.id,
        questions: pipeline.questions,
      },
      ...(await getPipelineTracePage(pipeline, page)),
    };
  });

export const getDecisionTrace = createServerFn()
  .validator(traceId)
  .handler(async ({ data, context }) => {
    const user = requireUser(context.user);
    const trace = await findDecisionTrace(data, async (pipelineId) => {
      const [pipeline] = await listPipelineVersions(user.githubId, [
        pipelineId,
      ]);
      return pipeline;
    });
    if (!trace) throw notFound();
    return trace;
  });
