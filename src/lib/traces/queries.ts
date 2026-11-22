import "@tanstack/react-start/server-only";
import {
  and,
  eq,
  exists,
  gt,
  isNull,
  lt,
  lte,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { getDb } from "@/lib/db/db";
import {
  decisionPipelines,
  decisionTraceAnnotations,
  decisionTraces,
} from "@/lib/db/schema";
import { getObservabilityUrl } from "@/lib/langfuse/links";
import type { TraceAnnotation } from "./annotations";
import { type AnnotationStatus, type TraceOrder, traceOrders } from "./filters";
import type { TraceRecord } from "./schemas";

function summarizeTraceConfidence(
  answers: TraceRecord["answers"],
): Pick<
  typeof decisionTraces.$inferSelect,
  "minConfidence" | "averageConfidence"
> {
  const values = Object.values(answers ?? {}).flatMap((answer) => {
    if (answer.type === "noul") return Math.max(answer.noul, 1 - answer.noul);
    return answer.confidence ?? [];
  });
  if (!values.length) return { minConfidence: null, averageConfidence: null };
  return {
    minConfidence: Math.min(...values),
    averageConfidence:
      values.reduce((total, value) => total + value, 0) / values.length,
  };
}

export async function storeTrace(record: TraceRecord) {
  const row = {
    ...record,
    startedAt: new Date(record.startedAt),
    endedAt: record.endedAt ? new Date(record.endedAt) : null,
    ...summarizeTraceConfidence(record.answers),
  } satisfies typeof decisionTraces.$inferInsert;
  await getDb()
    .insert(decisionTraces)
    .values(row)
    .onConflictDoNothing({
      target: [decisionTraces.pipelineId, decisionTraces.traceId],
    });
}

const annotationMatches = and(
  eq(decisionTraceAnnotations.traceId, decisionTraces.traceId),
  eq(decisionTraceAnnotations.pipelineId, decisionTraces.pipelineId),
);
type StoredTraceRow = Omit<
  typeof decisionTraces.$inferSelect,
  "recordedAt" | "minConfidence" | "averageConfidence"
>;

const traceColumns = {
  traceId: decisionTraces.traceId,
  pipelineId: decisionTraces.pipelineId,
  startedAt: decisionTraces.startedAt,
  endedAt: decisionTraces.endedAt,
  model: decisionTraces.model,
  failed: decisionTraces.failed,
  state: decisionTraces.state,
  answers: decisionTraces.answers,
  usage: decisionTraces.usage,
  observabilityUrl: decisionTraces.observabilityUrl,
  payloadTruncated: decisionTraces.payloadTruncated,
  historicalPlaceholder: decisionTraces.historicalPlaceholder,
  annotations: sql<TraceAnnotation[]>`coalesce((
    select jsonb_agg(jsonb_build_object('questionName', ${decisionTraceAnnotations.questionName}, 'choiceKey', ${decisionTraceAnnotations.choiceKey}) order by ${decisionTraceAnnotations.questionName})
    from ${decisionTraceAnnotations} where ${annotationMatches}
  ), '[]'::jsonb)`,
} satisfies Pick<typeof decisionTraces, keyof StoredTraceRow> & {
  annotations: SQL<TraceAnnotation[]>;
};

function traceView({
  startedAt,
  endedAt,
  state,
  answers,
  usage,
  observabilityUrl,
  ...trace
}: StoredTraceRow & { annotations: TraceAnnotation[] }) {
  return {
    ...trace,
    startTime: startedAt.toISOString(),
    endTime: endedAt?.toISOString(),
    state: state ?? undefined,
    answers: answers ?? undefined,
    usage: usage ?? undefined,
    observabilityUrl:
      observabilityUrl ??
      (trace.historicalPlaceholder
        ? getObservabilityUrl(trace.traceId)
        : undefined),
  };
}

const newestDecisionTracesFirst: readonly SQL[] = [
  sql`${decisionTraces.startedAt} desc nulls last`,
  sql`${decisionTraces.traceId} desc nulls last`,
];

const TRACE_PAGE_SIZE = 10;
type TraceOrdering = (typeof traceOrders)[number];
type TracePageAnchor = Pick<
  typeof decisionTraces.$inferSelect,
  "traceId" | "minConfidence" | "averageConfidence"
> & { startedAt: string };

export async function getPipelineTracePage(
  pipelineId: string,
  {
    cursor,
    until,
    status = "all",
    order = "recent",
  }: {
    cursor?: string | undefined;
    until?: string | undefined;
    status?: AnnotationStatus | undefined;
    order?: TraceOrder | undefined;
  },
) {
  const snapshot = until ? new Date(until) : new Date();
  const ordering = traceOrders.find(({ id }) => id === order) ?? traceOrders[0];
  const anchor = cursor
    ? await findTracePageAnchor(pipelineId, cursor)
    : undefined;
  const rows = await getDb()
    .select(traceColumns)
    .from(decisionTraces)
    .where(
      and(
        eq(decisionTraces.pipelineId, pipelineId),
        lte(decisionTraces.recordedAt, snapshot),
        traceAnnotationFilter(status),
        anchor && tracesAfterAnchor(anchor, ordering),
      ),
    )
    .orderBy(...tracePageOrderBy(ordering))
    .limit(TRACE_PAGE_SIZE + 1);

  const traces = rows.slice(0, TRACE_PAGE_SIZE).map(traceView);
  return {
    traces,
    next: rows.length > TRACE_PAGE_SIZE ? traces.at(-1)?.traceId : undefined,
    until: snapshot.toISOString(),
  };
}

async function findTracePageAnchor(
  pipelineId: string,
  traceId: string,
): Promise<TracePageAnchor | undefined> {
  const [anchor] = await getDb()
    .select({
      // Preserve Postgres timestamp precision when comparing against the cursor.
      startedAt: sql<string>`${decisionTraces.startedAt}::text`,
      traceId: decisionTraces.traceId,
      minConfidence: decisionTraces.minConfidence,
      averageConfidence: decisionTraces.averageConfidence,
    })
    .from(decisionTraces)
    .where(
      and(
        eq(decisionTraces.pipelineId, pipelineId),
        eq(decisionTraces.traceId, traceId),
      ),
    )
    .limit(1);
  return anchor;
}

function tracesAfterAnchor(anchor: TracePageAnchor, ordering: TraceOrdering) {
  const anchorTime = sql`${anchor.startedAt}::timestamptz`;
  const older = or(
    lt(decisionTraces.startedAt, anchorTime),
    and(
      eq(decisionTraces.startedAt, anchorTime),
      lt(decisionTraces.traceId, anchor.traceId),
    ),
  );
  if (ordering.sort === "startedAt") return older;

  const column = decisionTraces[ordering.sort];
  const score = anchor[ordering.sort];
  if (score === null) return and(isNull(column), older);
  return or(
    ordering.direction === "asc" ? gt(column, score) : lt(column, score),
    isNull(column),
    and(eq(column, score), older),
  );
}

function traceAnnotationFilter(status: AnnotationStatus) {
  if (status === "all") return undefined;
  const annotated = exists(
    getDb()
      .select({ one: sql`1` })
      .from(decisionTraceAnnotations)
      .where(annotationMatches),
  );
  return status === "annotated" ? annotated : not(annotated);
}

function tracePageOrderBy(ordering: TraceOrdering): readonly SQL[] {
  if (ordering.sort === "startedAt") return newestDecisionTracesFirst;
  const column = decisionTraces[ordering.sort];
  const confidenceFirst =
    ordering.direction === "asc"
      ? sql`${column} asc nulls last`
      : sql`${column} desc nulls last`;
  return [confidenceFirst, ...newestDecisionTracesFirst];
}

export async function findDecisionTrace(userId: string, traceId: string) {
  const [row] = await getDb()
    .select(traceColumns)
    .from(decisionTraces)
    .innerJoin(
      decisionPipelines,
      eq(decisionPipelines.id, decisionTraces.pipelineId),
    )
    .where(
      and(
        eq(decisionPipelines.userId, userId),
        eq(decisionTraces.traceId, traceId),
      ),
    )
    .orderBy(...newestDecisionTracesFirst, decisionTraces.pipelineId)
    .limit(1);
  return row && traceView(row);
}

export async function getOwnedTraceAnnotations(
  userId: string,
  pipelineId: string,
  traceId: string,
) {
  const [row] = await getDb()
    .select({ annotations: traceColumns.annotations })
    .from(decisionTraces)
    .innerJoin(
      decisionPipelines,
      eq(decisionPipelines.id, decisionTraces.pipelineId),
    )
    .where(
      and(
        eq(decisionPipelines.userId, userId),
        eq(decisionTraces.pipelineId, pipelineId),
        eq(decisionTraces.traceId, traceId),
      ),
    );
  return row?.annotations ?? null;
}
