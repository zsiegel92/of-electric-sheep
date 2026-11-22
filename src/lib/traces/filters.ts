import { z } from "zod";
import type { decisionTraces } from "@/lib/db/schema";

type ConfidenceSortColumn = keyof Pick<
  typeof decisionTraces.$inferSelect,
  "minConfidence" | "averageConfidence"
>;

type TraceOrderOption = { id: string; label: string } & (
  | { sort: "startedAt"; direction: "desc" }
  | { sort: ConfidenceSortColumn; direction: "asc" | "desc" }
);
type DefaultTraceOrder = Extract<TraceOrderOption, { sort: "startedAt" }> & {
  id: "recent";
};

export const traceOrders = [
  { id: "recent", label: "Newest first", sort: "startedAt", direction: "desc" },
  {
    id: "least-single",
    label: "Least confident single choice",
    sort: "minConfidence",
    direction: "asc",
  },
  {
    id: "least-average",
    label: "Least confident average choice",
    sort: "averageConfidence",
    direction: "asc",
  },
  {
    id: "most-average",
    label: "Most confident average choice",
    sort: "averageConfidence",
    direction: "desc",
  },
] as const satisfies readonly [DefaultTraceOrder, ...TraceOrderOption[]];

export const traceOrder = z.enum(traceOrders.map(({ id }) => id));
export const annotationStatus = z.enum(["all", "unannotated", "annotated"]);
export type TraceOrder = z.output<typeof traceOrder>;
export type AnnotationStatus = z.output<typeof annotationStatus>;
