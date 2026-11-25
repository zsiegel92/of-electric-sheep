import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { ExpandableDataValue } from "@/components/expandable-data-value";
import { PageHeader } from "@/components/page-header";
import { PipelineViewLinks } from "@/components/pipeline-view-links";
import { ObservabilityLink } from "@/components/traces/observability-link";
import { TraceAnnotationEditor } from "@/components/traces/trace-annotation";
import { TraceQuestions } from "@/components/traces/trace-questions";
import { TraceTime } from "@/components/traces/trace-table";
import { TraceViewMode } from "@/components/traces/trace-view-mode";
import { traceId } from "@/lib/traces/schemas";
import { getDecisionTrace } from "@/server/traces";

export const Route = createFileRoute("/trace/$traceId")({
  validateSearch: z.object({
    json: z.boolean().optional().catch(undefined),
  }),
  loader: ({ params }) => {
    const id = traceId.safeParse(params.traceId.toLowerCase());
    if (!id.success) throw notFound();
    return getDecisionTrace({ data: id.data });
  },
  component: TraceDetail,
});

function TraceDetail() {
  const { json = false } = Route.useSearch();
  const { pipeline, trace, questions } = Route.useLoaderData();
  return (
    <TraceAnnotationEditor
      key={trace.traceId}
      pipelineId={pipeline.id}
      traceId={trace.traceId}
      annotations={trace.annotations}
    >
      <div className="space-y-6">
        <div className="space-y-1">
          <PageHeader
            title="Decision trace"
            pipelineName={pipeline.name}
            actions={
              <PipelineViewLinks pipelineId={pipeline.id} showJson={json} />
            }
            controls={
              <div className="flex flex-wrap items-center gap-2">
                <TraceViewMode from={Route.fullPath} />
                <ObservabilityLink href={trace.observabilityUrl} />
              </div>
            }
          />
          <p className="font-mono text-sm wrap-anywhere">{trace.traceId}</p>
          <p className="text-sm text-muted-foreground">
            <TraceTime value={trace.startTime} />
            {trace.model && ` · ${trace.model}`}
            {trace.usage &&
              ` · ${trace.usage.input_tokens} input tokens · ${trace.usage.output_tokens} output tokens`}
          </p>
          {trace.failed && (
            <p className="text-sm text-destructive">Decision failed.</p>
          )}
        </div>
        {trace.state !== undefined && (
          <ExpandableDataValue
            key={trace.traceId}
            label="Input state"
            value={trace.state}
            showJson={json}
          />
        )}
        {trace.historicalPlaceholder && (
          <p className="text-sm text-muted-foreground">
            Only the saved labels are available for this historical trace.
          </p>
        )}
        {trace.payloadTruncated && (
          <p className="text-sm text-muted-foreground">
            Some trace data exceeded the event size limit.
          </p>
        )}
        {!trace.answers && (
          <p className="text-sm text-muted-foreground">
            No decision output available.
          </p>
        )}
        <TraceQuestions
          questions={questions}
          answers={trace.answers}
          showJson={json}
        />
      </div>
    </TraceAnnotationEditor>
  );
}
