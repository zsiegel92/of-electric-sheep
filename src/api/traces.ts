import * as api from "@/generated/sdk.gen";
import type { SaveAnnotation, TraceView } from "@/generated/types.gen";
import {
  systemOneRequest,
  systemOneResponse,
} from "@/lib/system-one/typesafe-api-schemas";
import type { TraceQuery } from "@/lib/traces/filters";
import { readApi } from "./http";
import { parseQuestion } from "./pipelines";

function parseTrace({ state, answers, observabilityUrl, ...trace }: TraceView) {
  return {
    ...trace,
    observabilityUrl,
    state:
      state === undefined
        ? undefined
        : systemOneRequest.shape.state.parse(state),
    answers:
      answers === undefined
        ? undefined
        : systemOneResponse.shape.answers.parse(answers),
  };
}

export async function listPipelineTraces({
  data: { pipelineId, cursor, until, status, order },
}: {
  data: TraceQuery & {
    pipelineId: string;
    cursor?: string | undefined;
    until?: string | undefined;
  };
}) {
  const page = await readApi(
    api.listPipelineTraces({
      path: { pipeline_id: pipelineId },
      query: {
        ...(cursor && { cursor }),
        ...(until && { until }),
        ...(status && { status }),
        ...(order && { order }),
      },
    }),
  );
  return {
    ...page,
    pipeline: {
      ...page.pipeline,
      questions: page.pipeline.questions.map(parseQuestion),
    },
    traces: page.traces.map(parseTrace),
  };
}

export async function getDecisionTrace({ data }: { data: string }) {
  const result = await readApi(
    api.getDecisionTrace({ path: { trace_id: data } }),
  );
  return {
    ...result,
    trace: parseTrace(result.trace),
    questions: result.questions.map(parseQuestion),
  };
}

export function getStoredTraceAnnotations({
  data,
}: {
  data: { pipelineId: string; traceId: string };
}) {
  return readApi(
    api.getStoredTraceAnnotations({
      path: { pipeline_id: data.pipelineId, trace_id: data.traceId },
    }),
  );
}

export async function saveTraceAnnotation({ data }: { data: SaveAnnotation }) {
  await readApi(api.saveTraceAnnotation({ body: data }));
}
