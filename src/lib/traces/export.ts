import "@tanstack/react-start/server-only";
import { and, eq, type SQLWrapper, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/db";
import { decisionPipelines, decisionTraces } from "@/lib/db/schema";
import type { TraceQuery } from "./filters";
import {
  type TraceView,
  traceColumns,
  tracePipelineJoin,
  traceSelection,
} from "./queries";

const { startedAt, endedAt, ...exportColumns } = traceColumns;
const traceExportFields = {
  ...exportColumns,
  startTime: startedAt,
  endTime: endedAt,
} satisfies Record<keyof TraceView, SQLWrapper>;

const traceJsonLine = sql<string>`jsonb_build_object(${sql.join(
  Object.entries(traceExportFields).map(
    ([key, column]) => sql`${key}::text, ${column}`,
  ),
  sql`, `,
)})::text`.as("line");

export async function openPipelineTraceExport(
  userId: string,
  pipelineId: string,
  filters: TraceQuery,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array> | undefined> {
  const db = getDb();
  const ownedPipeline = and(
    eq(decisionPipelines.id, pipelineId),
    eq(decisionPipelines.userId, userId),
  );
  const [pipeline] = await db
    .select({ id: decisionPipelines.id })
    .from(decisionPipelines)
    .where(ownedPipeline)
    .limit(1);
  if (!pipeline) return;

  const { annotations, orderBy } = traceSelection(filters);
  // Stream a single Postgres cursor so the export sees a consistent snapshot.
  const query = db
    .select({ line: traceJsonLine })
    .from(decisionTraces)
    .innerJoin(decisionPipelines, tracePipelineJoin)
    .where(and(ownedPipeline, annotations))
    .orderBy(...orderBy)
    .toSQL();
  const params = z.array(z.json()).parse(query.params);
  const cursor = db.$client
    .unsafe<{ line: string }[]>(query.sql, params)
    .signal(signal)
    .cursor(16);
  const lines = encodeTraceLines(cursor);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const line = await lines.next();
      if (line.done) controller.close();
      else controller.enqueue(line.value);
    },
    async cancel() {
      await lines.return(undefined);
    },
  });
}

async function* encodeTraceLines(cursor: AsyncIterable<{ line: string }[]>) {
  const encoder = new TextEncoder();
  for await (const rows of cursor) {
    for (const { line } of rows) yield encoder.encode(`${line}\n`);
  }
}
