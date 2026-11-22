import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { PipelineEditorLink } from "@/components/pipeline-view-links";
import { TraceTable } from "@/components/traces/trace-table";
import { Button } from "@/components/ui/button";
import { ViewModeSwitch } from "@/components/view-mode-switch";
import { listPipelineTraces } from "@/server/traces";

export const Route = createFileRoute("/traces/$pipelineId")({
  validateSearch: z.object({
    json: z.boolean().optional().catch(undefined),
    after: z.array(z.string().max(4096)).optional().catch(undefined),
    until: z.iso.datetime().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    cursor: search.after?.at(-1),
    until: search.until,
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
  const { json = false } = Route.useSearch();
  return (
    <div className="space-y-6">
      <PageHeader
        title="View Traces"
        pipelineName={data.pipeline.name}
        actions={<PipelineEditorLink pipelineId={data.pipeline.id} />}
        controls={<TraceViewMode />}
      />
      {data.traces.length ? (
        <TraceTable
          questions={data.pipeline.questions}
          traces={data.traces}
          showJson={json}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {data.configured
            ? "No traces on this page."
            : "Langfuse is not configured."}
        </p>
      )}
      <TracePagination next={data.next} until={data.until} />
    </div>
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
