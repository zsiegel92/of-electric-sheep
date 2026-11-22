import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { PipelineVersion } from "@/lib/decisions/question-links";
import {
  systemOneRequest,
  systemOneResponse,
} from "@/lib/system-one/typesafe-api-schemas";
import { listTraceAnnotations } from "@/lib/traces/annotation-queries";
import { annotationChoices } from "@/lib/traces/annotations";
import {
  type AnnotationStatus,
  matchesAnnotationStatus,
  rankedTraceLimit,
  traceConfidences,
  type traceOrder,
  traceOrders,
} from "@/lib/traces/filters";
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

function decisionTrace(
  span: Observation,
  {
    baseUrl,
    projectId = span.projectId,
  }: NonNullable<ReturnType<typeof getLangfuseConfig>>,
) {
  const output = systemOneResponse.safeParse(span.output).data;
  return {
    id: span.id,
    traceId: span.traceId,
    observabilityUrl: projectId
      ? `${baseUrl.replace(/\/$/, "")}/project/${encodeURIComponent(projectId)}/traces/${span.traceId}?${new URLSearchParams({ traceId: span.traceId })}`
      : undefined,
    startTime: span.startTime,
    model: output?.model ?? span.model,
    failed: span.level === "ERROR",
    state: recordedState.safeParse(span.input).data?.state,
    answers: output?.answers,
    usage: output?.usage,
  };
}

const pageSize = 10;

type TracePage = {
  cursor?: string | undefined;
  until?: string | undefined;
  status?: AnnotationStatus | undefined;
  order?: z.output<typeof traceOrder> | undefined;
};

export async function getPipelineTracePage(
  { id: pipelineId, createdAt }: Pick<PipelineVersion, "id" | "createdAt">,
  { cursor, until, status = "all", order = "recent" }: TracePage,
) {
  const to = until ? new Date(until) : new Date();
  const config = getLangfuseConfig();
  const base = { configured: !!config, until: to.toISOString() };
  if (!config) return { ...base, traces: [], next: undefined };

  const fetchPage = (limit: number, cursor: string | undefined) =>
    getObservationPage(
      config,
      { pipelineId, cursor, limit, from: new Date(createdAt), to },
      decisionObservationName,
    );
  const annotate = async (spans: Observation[]) => {
    const traces = new Map<string, ReturnType<typeof decisionTrace>>();
    for (const span of spans) {
      if (
        decisionPipelineId(span) === pipelineId &&
        traceId.safeParse(span.traceId).success &&
        !traces.has(span.traceId)
      ) {
        traces.set(span.traceId, decisionTrace(span, config));
      }
    }
    const annotations = await listTraceAnnotations(pipelineId, [
      ...traces.keys(),
    ]);
    return [...traces.values()].map((trace) => ({
      ...trace,
      annotations: annotations.get(trace.traceId) ?? [],
    }));
  };
  const matches = (trace: Awaited<ReturnType<typeof annotate>>[number]) =>
    matchesAnnotationStatus(status, trace.annotations.length > 0);

  const ordering = traceOrders.find((entry) => entry.id === order);
  if (ordering && "rank" in ordering) {
    const candidates: Observation[] = [];
    let sourceCursor: string | undefined;
    for (
      let request = 0;
      request < 3 && candidates.length < rankedTraceLimit;
      request++
    ) {
      const page = await fetchPage(
        rankedTraceLimit - candidates.length,
        sourceCursor,
      );
      candidates.push(...page.data);
      sourceCursor = page.meta.cursor ?? undefined;
      if (!sourceCursor) break;
    }
    const ranked = (await annotate(candidates))
      .map((trace) => {
        const values = traceConfidences(trace.answers);
        return {
          trace,
          rank: values.length ? ordering.rank(values) : Infinity,
        };
      })
      .sort((a, b) => (a.rank === b.rank ? 0 : a.rank - b.rank));
    const offset = cursor && /^\d{1,3}$/.test(cursor) ? Number(cursor) : 0;
    // Keep offsets relative to the ranked candidates when annotations change.
    const eligible = ranked
      .slice(offset)
      .flatMap(({ trace }, index) =>
        matches(trace) ? [{ trace, index: offset + index }] : [],
      );
    return {
      ...base,
      traces: eligible.slice(0, pageSize).map(({ trace }) => trace),
      next: eligible[pageSize] && String(eligible[pageSize].index),
    };
  }

  if (status === "all") {
    const page = await fetchPage(pageSize, cursor);
    return {
      ...base,
      traces: await annotate(page.data),
      next: page.meta.cursor,
    };
  }

  // Resume inside a source page so a filtered page can fill without dropping rows.
  const resume = cursor?.match(/^~(\d{1,2}):(.*)$/);
  let skip = resume ? Number(resume[1]) : 0;
  let sourceCursor = resume ? resume[2] || undefined : cursor;
  const traces: Awaited<ReturnType<typeof annotate>> = [];
  for (let request = 0; request < 3; request++) {
    const page = await fetchPage(50, sourceCursor);
    const eligible = (await annotate(page.data.slice(skip))).filter(matches);
    const seen = new Set(traces.map(({ traceId }) => traceId));
    for (const trace of eligible) {
      if (seen.has(trace.traceId)) continue;
      if (traces.length === pageSize) {
        const index = page.data.findIndex(
          (span, index) =>
            index >= skip &&
            span.id === trace.id &&
            span.traceId === trace.traceId,
        );
        return { ...base, traces, next: `~${index}:${sourceCursor ?? ""}` };
      }
      traces.push(trace);
    }
    sourceCursor = page.meta.cursor ?? undefined;
    if (!sourceCursor || traces.length === pageSize) break;
    skip = 0;
  }
  return { ...base, traces, next: sourceCursor };
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
      const stored = new Map(
        pipeline.questions.map((question) => [question.name, question]),
      );
      const input = recordedQuestions.safeParse(span.input).data;
      const questions = input
        ? Object.entries(input.questions).map(([name, question]) => ({
            name,
            alias: stored.get(name)?.alias ?? null,
            question,
          }))
        : pipeline.questions;
      const annotationQuestions = questions.flatMap(({ name, question }) => {
        const definition = stored.get(name)?.question;
        if (definition?.type !== question.type) return [];
        const keys = new Set(
          annotationChoices(definition).map(({ key }) => key),
        );
        const choices = annotationChoices(question).filter(({ key }) =>
          keys.has(key),
        );
        return choices.length ? [{ name, choices }] : [];
      });
      return {
        pipeline: {
          id: pipeline.id,
          name: pipeline.displayName ?? pipeline.model ?? pipeline.id,
        },
        trace: decisionTrace(span, config),
        questions,
        annotationQuestions,
      };
    }
    cursor = page.meta.cursor ?? undefined;
  } while (cursor);
  return undefined;
}
