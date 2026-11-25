import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { listPipelineVersions } from "@/lib/decisions/pipeline-versions";
import {
  deleteTraceAnnotation,
  upsertTraceAnnotation,
} from "@/lib/traces/annotation-queries";
import { annotationChoices } from "@/lib/traces/annotations";
import { traceQuery } from "@/lib/traces/filters";
import {
  findDecisionTrace,
  getOwnedTraceAnnotations,
  getPipelineTracePage,
} from "@/lib/traces/queries";
import { traceId } from "@/lib/traces/schemas";

const traceReference = z.object({ pipelineId: z.uuid(), traceId });

async function requireTracePipeline(userId: string, pipelineId: string) {
  const [pipeline] = await listPipelineVersions(userId, [pipelineId]);
  if (!pipeline) throw notFound();
  const { id, displayName, model, questions } = pipeline;
  return { id, name: displayName ?? model ?? id, questions };
}

export const listPipelineTraces = createServerFn()
  .validator(
    traceQuery.extend({
      pipelineId: traceReference.shape.pipelineId,
      cursor: traceId.optional(),
      until: z.iso.datetime().optional(),
    }),
  )
  .handler(async ({ data: { pipelineId, ...page }, context }) => {
    const user = requireUser(context.user);
    const pipeline = await requireTracePipeline(user.githubId, pipelineId);
    return { pipeline, ...(await getPipelineTracePage(pipelineId, page)) };
  });

export const getDecisionTrace = createServerFn()
  .validator(traceId)
  .handler(async ({ data, context }) => {
    const user = requireUser(context.user);
    const trace = await findDecisionTrace(user.githubId, data);
    if (!trace) throw notFound();
    const { questions, ...pipeline } = await requireTracePipeline(
      user.githubId,
      trace.pipelineId,
    );
    return { pipeline, trace, questions };
  });

export const getStoredTraceAnnotations = createServerFn()
  .validator(traceReference)
  .handler(({ data, context }) =>
    getOwnedTraceAnnotations(
      requireUser(context.user).githubId,
      data.pipelineId,
      data.traceId,
    ),
  );

export const saveTraceAnnotation = createServerFn({ method: "POST" })
  .validator(
    traceReference.extend({
      questionName: z.string().min(1),
      choiceKey: z.string().min(1).nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    const user = requireUser(context.user);
    const { choiceKey, ...key } = data;
    if (
      (await getOwnedTraceAnnotations(
        user.githubId,
        key.pipelineId,
        key.traceId,
      )) === null
    )
      throw notFound();
    if (choiceKey === null) {
      await deleteTraceAnnotation(key);
      return;
    }
    const [pipeline] = await listPipelineVersions(user.githubId, [
      data.pipelineId,
    ]);
    const question = pipeline?.questions.find(
      ({ name }) => name === key.questionName,
    );
    if (
      !question ||
      !annotationChoices(question.question).some(({ key }) => key === choiceKey)
    ) {
      throw new Error("Choose an option from this trace's question.");
    }
    await upsertTraceAnnotation({ ...key, choiceKey });
  });
