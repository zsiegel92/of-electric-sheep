import "@tanstack/react-start/server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/db";
import { decisionTraceAnnotations as annotations } from "@/lib/db/schema";
import type { TraceAnnotation } from "./annotations";

export async function listTraceAnnotations(
  pipelineId: string,
  traceIds: string[],
) {
  const byTrace = new Map<string, TraceAnnotation[]>();
  if (!traceIds.length) return byTrace;
  const rows = await getDb()
    .select({
      traceId: annotations.traceId,
      questionName: annotations.questionName,
      choiceKey: annotations.choiceKey,
    })
    .from(annotations)
    .where(
      and(
        eq(annotations.pipelineId, pipelineId),
        inArray(annotations.traceId, traceIds),
      ),
    );
  for (const { traceId, ...annotation } of rows) {
    const saved = byTrace.get(traceId);
    if (saved) saved.push(annotation);
    else byTrace.set(traceId, [annotation]);
  }
  return byTrace;
}

type AnnotationKey = Pick<TraceAnnotation, "questionName"> & {
  pipelineId: string;
  traceId: string;
};

export async function upsertTraceAnnotation(
  data: AnnotationKey & TraceAnnotation,
) {
  await getDb()
    .insert(annotations)
    .values(data)
    .onConflictDoUpdate({
      target: [
        annotations.pipelineId,
        annotations.traceId,
        annotations.questionName,
      ],
      set: { choiceKey: data.choiceKey, updatedAt: sql`now()` },
    });
}

export async function deleteTraceAnnotation(data: AnnotationKey) {
  await getDb()
    .delete(annotations)
    .where(
      and(
        eq(annotations.pipelineId, data.pipelineId),
        eq(annotations.traceId, data.traceId),
        eq(annotations.questionName, data.questionName),
      ),
    );
}
