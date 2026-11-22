import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { PipelineVersion } from "@/lib/decisions/question-links";
import {
  systemOneRequest,
  systemOneResponse,
} from "@/lib/system-one/typesafe-api-schemas";
import { getLangfuseConfig, getObservationPage } from "./queries";
import { decisionObservationName, type observation, traceId } from "./schemas";

type Observation = z.output<typeof observation>;

const recordedState = systemOneRequest.pick({ state: true });
const recordedQuestions = systemOneRequest.pick({ questions: true });

function decisionPipelineId(span: Observation) {
  if (span.name !== decisionObservationName || span.type !== "GENERATION")
    return;
  return z.uuid().safeParse(span.metadata?.["pipelineId"]).data;
}

function decisionTrace(span: Observation) {
  const output = systemOneResponse.safeParse(span.output).data;
  return {
    id: span.id,
    traceId: span.traceId,
    startTime: span.startTime,
    model: output?.model ?? span.model,
    failed: span.level === "ERROR",
    state: recordedState.safeParse(span.input).data?.state,
    answers: output?.answers,
    usage: output?.usage,
  };
}

export async function getPipelineTracePage(
  { id: pipelineId, createdAt }: Pick<PipelineVersion, "id" | "createdAt">,
  {
    cursor,
    until,
  }: { cursor?: string | undefined; until?: string | undefined },
) {
  const to = until ? new Date(until) : new Date();
  const config = getLangfuseConfig();
  const page =
    config &&
    (await getObservationPage(
      config,
      {
        pipelineId,
        cursor,
        limit: 10,
        from: new Date(createdAt),
        to,
      },
      decisionObservationName,
    ));
  const traces = new Map<string, ReturnType<typeof decisionTrace>>();
  for (const span of page?.data ?? []) {
    if (
      decisionPipelineId(span) === pipelineId &&
      traceId.safeParse(span.traceId).success &&
      !traces.has(span.traceId)
    ) {
      traces.set(span.traceId, decisionTrace(span));
    }
  }
  return {
    traces: [...traces.values()],
    configured: !!config,
    next: page?.meta.cursor,
    until: to.toISOString(),
  };
}

export async function findDecisionTrace(
  id: string,
  findOwnedPipeline: (
    pipelineId: string,
  ) => Promise<PipelineVersion | undefined>,
) {
  const config = getLangfuseConfig();
  if (!config) return undefined;

  const to = new Date();
  let cursor: string | undefined;
  do {
    const page = await getObservationPage(
      config,
      { traceId: id, cursor, limit: 10, from: new Date(0), to },
      decisionObservationName,
    );
    for (const span of page.data) {
      const pipelineId = decisionPipelineId(span);
      if (!pipelineId || span.traceId !== id) continue;
      const pipeline = await findOwnedPipeline(pipelineId);
      if (!pipeline) continue;
      const input = recordedQuestions.safeParse(span.input).data;
      return {
        pipeline: {
          id: pipeline.id,
          name: pipeline.displayName ?? pipeline.model ?? pipeline.id,
        },
        trace: decisionTrace(span),
        questions: input
          ? Object.entries(input.questions).map(([name, question]) => ({
              name,
              question,
            }))
          : pipeline.questions,
        langfuseUrl: langfuseTraceUrl(config.baseUrl, span),
      };
    }
    cursor = page.meta.cursor ?? undefined;
  } while (cursor);
  return undefined;
}

function langfuseTraceUrl(baseUrl: string, span: Observation) {
  if (!span.projectId) return;
  const time = Date.parse(span.startTime);
  const hour = 60 * 60 * 1000;
  const query = new URLSearchParams({
    peek: span.id,
    observation: span.id,
    traceId: span.traceId,
    timestamp: span.startTime,
    search: span.traceId,
    searchType: "id",
    dateRange: `${time - hour}-${time + hour}`,
  });
  return `${baseUrl.replace(/\/$/, "")}/project/${encodeURIComponent(span.projectId)}/traces?${query}`;
}
