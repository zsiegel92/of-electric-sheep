import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { listPipelines, updatePipeline } from "@/api/pipelines";
import { PipelineName } from "@/components/pipeline-name";
import { PipelineQuestions } from "@/components/pipeline-questions";
import { PipelineViewLinks } from "@/components/pipeline-view-links";
import { usePipelineQuestions } from "@/components/question-name";
import { Button } from "@/components/ui/button";

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
    <div className="space-y-6">
      <h1 className="sr-only">Pipelines</h1>
      <div className="flex flex-wrap items-center justify-end gap-4 text-sm">
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
                    canAssociate={
                      pipeline.id === primaryId &&
                      !!pipeline.linkShapeKey &&
                      !pipelines.some(
                        (member) =>
                          member.id !== pipeline.id &&
                          member.primaryGroupedPipelineId === pipeline.id,
                      ) &&
                      group.some(
                        (target) =>
                          target.id !== pipeline.id &&
                          target.id === target.primaryGroupedPipelineId &&
                          target.linkShapeKey === pipeline.linkShapeKey,
                      )
                    }
                    showIgnored={showIgnored}
                  />
                ))}
              </ul>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function PipelineRow({
  pipeline,
  canCompareWithPrimary,
  canAssociate,
  showIgnored,
}: {
  pipeline: PipelineSummary;
  canCompareWithPrimary: boolean;
  canAssociate: boolean;
  showIgnored: boolean | undefined;
}) {
  const router = useRouter();
  const update = useMutation({
    mutationFn: updatePipeline,
    onSuccess: () => router.invalidate(),
  });
  const isPrimary = pipeline.id === pipeline.primaryGroupedPipelineId;

  return (
    <li
      className={`flex flex-wrap items-stretch gap-3 px-4 py-3 ${isPrimary ? "bg-muted" : ""}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 text-sm font-medium">
            <PipelineName pipeline={pipeline} />
          </span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                data: {
                  pipelineId: pipeline.id,
                  uiIgnored: !pipeline.uiIgnored,
                },
              })
            }
          >
            {pipeline.uiIgnored ? "Unignore" : "Ignore"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {isPrimary ? "Primary" : "Version"}
            {pipeline.uiIgnored && " · Ignored"}
          </span>
        </div>
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
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {canAssociate && (
          <Link
            to="/pipelines-diff"
            search={{ id2: pipeline.id, associate: true, showIgnored }}
            className="self-center underline"
          >
            Associate with primary
          </Link>
        )}
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
        <PipelineViewLinks pipelineId={pipeline.id} />
      </div>
      <PipelineQuestionDetails pipelineId={pipeline.id} />
    </li>
  );
}

function PipelineQuestionDetails({ pipelineId }: { pipelineId: string }) {
  const [open, setOpen] = useState(false);
  const questions = usePipelineQuestions(pipelineId, undefined, open);
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
            <PipelineQuestions
              pipelineId={pipelineId}
              questions={questions.data}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Definition pending.</p>
          )}
        </div>
      )}
    </details>
  );
}
