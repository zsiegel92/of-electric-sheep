import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { z } from "zod";
import { PipelineQuestions } from "@/components/pipeline-questions";
import { PipelineEditorLink } from "@/components/pipeline-view-links";
import { Content, JsonValueView } from "@/components/question-view";
import { TraceTable, TraceTime } from "@/components/traces/trace-table";
import { Button } from "@/components/ui/button";
import { ViewModeSwitch } from "@/components/view-mode-switch";
import { traceId } from "@/lib/langfuse/schemas";
import { getDecisionTrace, listPipelineTraces } from "@/server/traces";

export const Route = createFileRoute("/traces/$id")({
  validateSearch: z.object({
    json: z.boolean().optional().catch(undefined),
    expanded: z.array(z.string()).optional().catch(undefined),
    after: z.array(z.string().max(4096)).optional().catch(undefined),
    until: z.iso.datetime().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    cursor: search.after?.at(-1),
    until: search.until,
  }),
  loader: async ({ params, deps }) => {
    const id = params.id.toLowerCase();
    if (z.uuid().safeParse(id).success) {
      return {
        kind: "pipeline" as const,
        ...(await listPipelineTraces({ data: { pipelineId: id, ...deps } })),
      };
    }
    if (traceId.safeParse(id).success) {
      return {
        kind: "trace" as const,
        ...(await getDecisionTrace({ data: id })),
      };
    }
    throw notFound();
  },
  component: TracesPage,
});

function TracesPage() {
  const data = Route.useLoaderData();
  return (
    <div className="space-y-6">
      {data.kind === "pipeline" ? (
        <PipelineTraces data={data} />
      ) : (
        <TraceDetail data={data} />
      )}
    </div>
  );
}

type TracePageData = ReturnType<typeof Route.useLoaderData>;

function PipelineTraces({
  data,
}: {
  data: Extract<TracePageData, { kind: "pipeline" }>;
}) {
  const { json = false, expanded = [] } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-2xl font-semibold wrap-anywhere">
            <span className="rounded-md bg-muted px-1.5 font-mono">
              {data.pipeline.name}
            </span>{" "}
            Traces
          </h1>
          <PipelineEditorLink pipelineId={data.pipeline.id} />
        </div>
        <TraceViewMode />
      </header>
      {data.traces.length ? (
        <TraceTable
          questions={data.pipeline.questions}
          traces={data.traces}
          expanded={expanded}
          showJson={json}
          onToggle={(name) =>
            void navigate({
              replace: true,
              resetScroll: false,
              search: (previous) => ({
                ...previous,
                expanded: expanded.includes(name)
                  ? expanded.filter((item) => item !== name)
                  : [...expanded, name],
              }),
            })
          }
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {data.configured
            ? "No traces on this page."
            : "Langfuse is not configured."}
        </p>
      )}
      <TracePagination next={data.next} until={data.until} />
    </>
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
            from="/traces/$id"
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
            from="/traces/$id"
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

function TraceDetail({
  data,
}: {
  data: Extract<TracePageData, { kind: "trace" }>;
}) {
  const { json = false } = Route.useSearch();
  const { pipeline, trace, questions, state, langfuseUrl } = data;
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-2xl font-semibold">Decision trace</h1>
            <PipelineEditorLink pipelineId={pipeline.id} />
          </div>
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
        <div className="flex flex-wrap items-center gap-2">
          <TraceViewMode />
          <LangfuseLink href={langfuseUrl} />
        </div>
      </header>
      <Link
        to="/traces/$id"
        params={{ id: pipeline.id }}
        search={{ json: json || undefined }}
        className="text-sm underline"
      >
        All pipeline traces
      </Link>
      {state !== undefined && (
        <details className="space-y-3 rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Input state
          </summary>
          {json ? <JsonValueView value={state} /> : <Content value={state} />}
        </details>
      )}
      {!trace.answers && (
        <p className="text-sm text-muted-foreground">
          No decision output available.
        </p>
      )}
      <PipelineQuestions
        questions={questions}
        answers={trace.answers}
        showJson={json}
      />
    </>
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

function LangfuseLink({ href }: { href: string | undefined }) {
  if (!href) return null;
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} target="_blank" rel="noreferrer">
        Open in Langfuse <ExternalLink />
      </a>
    </Button>
  );
}
