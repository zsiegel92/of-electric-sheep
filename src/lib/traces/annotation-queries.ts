import "@tanstack/react-start/server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/db";
import { decisionTraceAnnotations as annotations } from "@/lib/db/schema";
import type { TraceAnnotation } from "./annotations";

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
