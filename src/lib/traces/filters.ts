import { z } from "zod";
import type { systemOneResponse } from "@/lib/system-one/typesafe-api-schemas";

type DecisionAnswers = z.output<typeof systemOneResponse>["answers"];

export const rankedTraceLimit = 100;
export const traceOrders = [
  { id: "recent", label: "Newest first" },
  {
    id: "least-single",
    label: "Least confident single choice",
    rank: (values: number[]) => Math.min(...values),
  },
  {
    id: "least-average",
    label: "Least confident average choice",
    rank: average,
  },
  {
    id: "most-average",
    label: "Most confident average choice",
    rank: (values: number[]) => -average(values),
  },
] as const;

export const traceOrder = z.enum(traceOrders.map(({ id }) => id));
export const annotationStatus = z.enum(["all", "unannotated", "annotated"]);
export type AnnotationStatus = z.output<typeof annotationStatus>;

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function traceConfidences(answers: DecisionAnswers | undefined) {
  return Object.values(answers ?? {}).flatMap((answer) => {
    if (answer.type === "noul") return Math.max(answer.noul, 1 - answer.noul);
    return answer.confidence ?? [];
  });
}

export function matchesAnnotationStatus(
  status: AnnotationStatus,
  annotated: boolean,
) {
  return status === "all" || (status === "annotated") === annotated;
}
