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
import {
  deleteTraceAnnotation,
  listTraceAnnotations,
  upsertTraceAnnotation,
} from "@/lib/traces/annotation-queries";
import { annotationStatus, traceOrder } from "@/lib/traces/filters";

export const listPipelineTraces = createServerFn()
  .validator(
    z.object({
      pipelineId: z.uuid(),
      cursor: z.string().optional(),
      until: z.iso.datetime().optional(),
      status: annotationStatus.optional(),
      order: traceOrder.optional(),
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
    const saved = await listTraceAnnotations(trace.pipeline.id, [data]);
    return { ...trace, annotations: saved.get(data) ?? [] };
  });

export const saveTraceAnnotation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      pipelineId: z.uuid(),
      traceId,
      questionName: z.string().min(1),
      choiceKey: z.string().min(1).nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    const user = requireUser(context.user);
    const [pipeline] = await listPipelineVersions(user.githubId, [
      data.pipelineId,
    ]);
    if (!pipeline) throw notFound();

    const { choiceKey, ...key } = data;
    if (choiceKey === null) {
      await deleteTraceAnnotation(key);
      return;
    }

    const trace = await findDecisionTrace(data.traceId, async (id) =>
      id === pipeline.id ? pipeline : undefined,
    );
    if (!trace) throw notFound();
    const choices = trace.annotationQuestions.find(
      ({ name }) => name === data.questionName,
    )?.choices;
    if (!choices?.some(({ key }) => key === choiceKey)) {
      throw new Error("Choose an option from this trace's question.");
    }
    await upsertTraceAnnotation({ ...key, choiceKey });
  });
