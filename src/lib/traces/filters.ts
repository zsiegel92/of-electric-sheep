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

type TraceAnnotationFilter = {
  id: string;
  label: string;
  annotated: boolean | null;
  exportLabel: string;
};

export const traceAnnotationFilters = [
  {
    id: "all",
    label: "All traces",
    annotated: null,
    exportLabel: "Export all traces as JSONL",
  },
  {
    id: "unannotated",
    label: "Un-Annotated",
    annotated: false,
    exportLabel: "Export unannotated traces as JSONL",
  },
  {
    id: "annotated",
    label: "Annotated",
    annotated: true,
    exportLabel: "Export annotated traces as JSONL",
  },
] as const satisfies readonly [
  TraceAnnotationFilter & { id: "all"; annotated: null },
  ...TraceAnnotationFilter[],
];

export const traceOrder = z.enum(traceOrders.map(({ id }) => id));
export const annotationStatus = z.enum(
  traceAnnotationFilters.map(({ id }) => id),
);
export const traceQuery = z.object({
  status: annotationStatus.optional(),
  order: traceOrder.optional(),
});
export type TraceQuery = z.output<typeof traceQuery>;

export function getTraceAnnotationFilter(status?: TraceQuery["status"]) {
  return (
    traceAnnotationFilters.find(({ id }) => id === status) ??
    traceAnnotationFilters[0]
  );
}
