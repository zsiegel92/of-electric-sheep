import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowUpRight, Pencil } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { PipelineQuestions } from "@/components/pipeline-questions";
import { Button } from "@/components/ui/button";
import {
  getPipelineQuestions,
  listPipelines,
  updatePipeline,
} from "@/server/pipelines";

export const Route = createFileRoute("/pipelines/")({
  validateSearch: z.object({
    showIgnored: z.boolean().optional().catch(undefined),
  }),
  loader: () => listPipelines(),
  component: Pipelines,
});

type PipelineSummary = Awaited<ReturnType<typeof listPipelines>>[number];

function Pipelines() {
  const pipelines = Route.useLoaderData();
  const { showIgnored } = Route.useSearch();
  const navigate = Route.useNavigate();
  const visible = showIgnored
    ? pipelines
    : pipelines.filter((pipeline) => !pipeline.uiIgnored);
  const comparableGroups = Map.groupBy(
    visible,
    (pipeline) => pipeline.comparabilityKey,
  );
  const canCompare = [...comparableGroups].some(
    ([key, pipelines]) => key !== null && pipelines.length > 1,
  );
  return (
    <main className="mx-auto max-w-5xl space-y-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Pipelines</h1>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showIgnored === true}
              onChange={(event) => {
                void navigate({
                  search: {
                    showIgnored: event.currentTarget.checked || undefined,
                  },
                  replace: true,
                });
              }}
            />
            Show ignored
          </label>
          <Button
            asChild={canCompare}
            disabled={!canCompare}
            variant="outline"
            size="sm"
          >
            {canCompare ? (
              <Link to="/pipelines-diff" search={{ showIgnored }}>
                Compare pipelines
              </Link>
            ) : (
              "Compare pipelines"
            )}
          </Button>
        </div>
      </div>
      {visible.length === 0 && (
        <p className="rounded-md border p-5 text-sm text-muted-foreground">
          {pipelines.length
            ? "All pipelines are ignored."
            : "No pipelines yet. A pipeline is created the first time you send a System One decision."}
        </p>
      )}
      {[...comparableGroups].map(([kind, group]) => (
        <section key={kind ?? "pending"} className="space-y-3">
          <h2 className="text-sm font-semibold">
            {kind ?? "Definitions pending"}
          </h2>
          {[
            ...Map.groupBy(
              group,
              (pipeline) => pipeline.primaryGroupedPipelineId,
            ),
          ].map(([primaryId, versions]) => {
            const primary = versions.find(
              (pipeline) => pipeline.id === primaryId,
            );
            const ordered = primary
              ? [
                  primary,
                  ...versions.filter((pipeline) => pipeline.id !== primaryId),
                ]
              : versions;
            return (
              <ul
                className="divide-y overflow-hidden rounded-lg border"
                key={primaryId}
              >
                {ordered.map((pipeline) => (
                  <PipelineRow
                    key={pipeline.id}
                    pipeline={pipeline}
                    canCompareWithPrimary={
                      kind !== null && !!primary && pipeline.id !== primaryId
                    }
                  />
                ))}
              </ul>
            );
          })}
        </section>
      ))}
    </main>
  );
}

function PipelineRow({
  pipeline,
  canCompareWithPrimary,
}: {
  pipeline: PipelineSummary;
  canCompareWithPrimary: boolean;
}) {
  const router = useRouter();
  const [draftName, setDraftName] = useState<string>();
  const update = useMutation({
    mutationFn: updatePipeline,
    onSuccess: async () => {
      await router.invalidate();
      setDraftName(undefined);
    },
  });
  const isPrimary = pipeline.id === pipeline.primaryGroupedPipelineId;

  return (
    <li
      className={`flex flex-wrap items-stretch gap-3 px-4 py-3 ${isPrimary ? "bg-muted" : ""}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        {draftName === undefined ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-all text-sm font-medium">
              {pipeline.displayName ?? pipeline.model ?? "Definition pending"}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Rename pipeline"
              title="Rename pipeline"
              disabled={update.isPending}
              onClick={() => {
                update.reset();
                setDraftName(pipeline.displayName ?? "");
              }}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => {
                update.mutate({
                  data: {
                    pipelineId: pipeline.id,
                    uiIgnored: !pipeline.uiIgnored,
                  },
                });
              }}
            >
              {pipeline.uiIgnored ? "Unignore" : "Ignore"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {isPrimary ? "Primary" : "Version"}
              {pipeline.uiIgnored && " · Ignored"}
            </span>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate({
                data: { pipelineId: pipeline.id, displayName: draftName },
              });
            }}
          >
            <input
              aria-label="Pipeline name"
              className="min-w-0 rounded-md border bg-background px-2 py-1 text-sm"
              value={draftName}
              maxLength={100}
              placeholder={pipeline.model ?? "Pipeline name"}
              onChange={(event) => setDraftName(event.currentTarget.value)}
            />
            <Button type="submit" size="xs" disabled={update.isPending}>
              Save
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => {
                update.reset();
                setDraftName(undefined);
              }}
            >
              Cancel
            </Button>
          </form>
        )}
        <p className="break-all font-mono text-xs text-muted-foreground">
          {pipeline.id}
        </p>
        <p className="break-all text-xs text-muted-foreground">
          {pipeline.displayName && pipeline.model && `${pipeline.model} · `}
          {pipeline.questionCount} questions · {pipeline.createdAt.slice(0, 10)}{" "}
          · {pipeline.baseUrl ?? "Default upstream"}
        </p>
        {update.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not update the pipeline. Try again.
          </p>
        )}
      </div>
      <div className="flex items-stretch gap-4 text-sm">
        {canCompareWithPrimary && (
          <Link
            to="/pipelines-diff"
            search={{
              id1: pipeline.primaryGroupedPipelineId,
              id2: pipeline.id,
            }}
            className="self-center underline"
          >
            Compare
          </Link>
        )}
        <Link
          to="/pipelines/$id"
          params={{ id: pipeline.id }}
          search={{}}
          className="-my-3 -mr-4 flex min-h-20 min-w-28 items-center justify-center gap-2 border-l border-foreground/25 bg-gradient-to-r from-muted to-background px-4 font-medium transition-colors hover:from-accent hover:to-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <PipelineQuestionDetails pipelineId={pipeline.id} />
    </li>
  );
}

function PipelineQuestionDetails({ pipelineId }: { pipelineId: string }) {
  const [open, setOpen] = useState(false);
  const questions = useQuery({
    queryKey: ["pipeline-questions", pipelineId],
    queryFn: () => getPipelineQuestions({ data: pipelineId }),
    enabled: open,
    retry: false,
  });
  return (
    <details
      className="basis-full"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm text-muted-foreground">
        Questions in this version
      </summary>
      {open && (
        <div className="mt-3">
          {questions.isError ? (
            <div className="flex items-center gap-2 text-sm">
              <p role="alert" className="text-destructive">
                Could not load questions.
              </p>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void questions.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : questions.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading questions…
            </p>
          ) : questions.data?.length ? (
            <PipelineQuestions questions={questions.data} />
          ) : (
            <p className="text-sm text-muted-foreground">Definition pending.</p>
          )}
        </div>
      )}
    </details>
  );
}
