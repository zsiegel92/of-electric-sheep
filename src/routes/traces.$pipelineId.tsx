import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { PipelineEditorLink } from "@/components/pipeline-view-links";
import { usePipelineQuestions } from "@/components/question-name";
import { TraceTable } from "@/components/traces/trace-table";
import { Button } from "@/components/ui/button";
import { ViewModeSwitch } from "@/components/view-mode-switch";
import {
  annotationStatus,
  traceOrder,
  traceOrders,
} from "@/lib/traces/filters";
import { traceId } from "@/lib/traces/schemas";
import { listPipelineTraces } from "@/server/traces";

export const Route = createFileRoute("/traces/$pipelineId")({
  validateSearch: z.object({
    json: z.boolean().optional().catch(undefined),
    after: z.array(traceId).optional().catch(undefined),
    until: z.iso.datetime().optional().catch(undefined),
    status: annotationStatus.optional().catch(undefined),
    order: traceOrder.optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    cursor: search.after?.at(-1),
    until: search.until,
    status: search.status,
    order: search.order,
  }),
  loader: ({ params, deps }) => {
    const pipelineId = z.uuid().safeParse(params.pipelineId.toLowerCase());
    if (!pipelineId.success) throw notFound();
    return listPipelineTraces({
      data: { pipelineId: pipelineId.data, ...deps },
    });
  },
  component: PipelineTraces,
});

function PipelineTraces() {
  const data = Route.useLoaderData();
  const { data: questions = data.pipeline.questions } = usePipelineQuestions(
    data.pipeline.id,
    data.pipeline.questions,
  );
  const { json = false, status, order, after, until } = Route.useSearch();
  return (
    <div className="space-y-6">
      <PageHeader
        title="View Traces"
        pipelineName={data.pipeline.name}
        actions={<PipelineEditorLink pipelineId={data.pipeline.id} />}
        controls={<TraceViewMode />}
      />
      <TraceFilters />
      {(data.traces.length > 0 || questions.length > 0) && (
        <TraceTable
          key={JSON.stringify([data.pipeline.id, status, order, after, until])}
          pipelineId={data.pipeline.id}
          removeFinished={status === "unannotated"}
          questions={questions}
          traces={data.traces}
          showJson={json}
        />
      )}
      {!data.traces.length && (
        <p className="text-sm text-muted-foreground">
          No matching traces on this page.
        </p>
      )}
      <TracePagination next={data.next} until={data.until} />
    </div>
  );
}

function TraceFilters() {
  const { status = "all", order = "recent" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <fieldset className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <legend className="sr-only">Trace filters</legend>
      <label className="grid gap-1 text-xs font-medium">
        Annotation status
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={status}
          onChange={(event) => {
            const status = annotationStatus.parse(event.currentTarget.value);
            void navigate({
              search: (previous) => ({
                ...previous,
                status: status === "all" ? undefined : status,
                after: undefined,
                until: undefined,
              }),
            });
          }}
        >
          <option value="all">All traces</option>
          <option value="unannotated">Un-Annotated</option>
          <option value="annotated">Annotated</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium">
        Order by
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={order}
          onChange={(event) => {
            const order = traceOrder.parse(event.currentTarget.value);
            void navigate({
              search: (previous) => ({
                ...previous,
                order: order === "recent" ? undefined : order,
                after: undefined,
                until: undefined,
              }),
            });
          }}
        >
          {traceOrders.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {order !== "recent" && (
        <p className="text-xs text-muted-foreground sm:pb-2">
          Traces without confidence appear last.
        </p>
      )}
    </fieldset>
  );
}

function TracePagination({
  next,
  until,
}: {
  next: string | null | undefined;
  until: string;
}) {
  const { after = [] } = Route.useSearch();
  if (!after.length && !next) return null;
  return (
    <nav aria-label="Trace pages" className="flex items-center gap-3">
      {after.length > 0 && (
        <Button asChild variant="outline" size="sm">
          <Link
            from="/traces/$pipelineId"
            to="."
            search={(previous) => ({
              ...previous,
              after: after.slice(0, -1),
              until,
            })}
          >
            <ArrowLeft /> Previous
          </Link>
        </Button>
      )}
      <span className="text-sm text-muted-foreground">
        Page {after.length + 1}
      </span>
      {next && (
        <Button asChild variant="outline" size="sm">
          <Link
            from="/traces/$pipelineId"
            to="."
            search={(previous) => ({
              ...previous,
              after: [...after, next],
              until,
            })}
          >
            Next <ArrowRight />
          </Link>
        </Button>
      )}
    </nav>
  );
}

function TraceViewMode() {
  const { json = false } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ViewModeSwitch
      showJson={json}
      onChange={(json) =>
        void navigate({
          replace: true,
          resetScroll: false,
          search: (previous) => ({ ...previous, json: json || undefined }),
        })
      }
    />
  );
}
