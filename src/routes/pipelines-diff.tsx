import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
  PipelineComparison,
  pipelineSnapshot,
} from "@/components/pipeline-diff";
import { Button } from "@/components/ui/button";
import { ViewModeSwitch } from "@/components/view-mode-switch";
import {
  compatibleQuestions,
  matchQuestions,
  type PipelineVersion,
  pipelineQuestionKinds,
} from "@/lib/decisions/question-links";
import {
  getPipelineVersions,
  listPipelines,
  updateQuestionLinks,
} from "@/server/pipelines";

const searchSchema = z.object({
  id1: z.uuid().optional().catch(undefined),
  id2: z.uuid().optional().catch(undefined),
  showIgnored: z.boolean().optional().catch(undefined),
  associate: z.boolean().optional().catch(undefined),
  json: z.boolean().optional().catch(undefined),
});
export const Route = createFileRoute("/pipelines-diff")({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { id1, id2 } }) => ({ id1, id2 }),
  loader: async ({ deps: { id1, id2 } }) => {
    const ids = [id1, id2].flatMap((id) => (id ? [id.toLowerCase()] : []));
    const [pipelines, versions] = await Promise.all([
      listPipelines(),
      ids.length ? getPipelineVersions({ data: ids }) : [],
    ]);
    return {
      pipelines,
      left: versions.find(({ id }) => id === id1?.toLowerCase()),
      right: versions.find(({ id }) => id === id2?.toLowerCase()),
      versions,
    };
  },
  component: PipelineDiff,
});

function PipelineDiff() {
  const { pipelines, left, right, versions } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const choices = pipelines.filter(
    (pipeline) =>
      pipeline.comparabilityKey !== null &&
      (search.showIgnored ||
        !pipeline.uiIgnored ||
        pipeline.id === left?.id ||
        pipeline.id === right?.id),
  );
  const leftKind = left && pipelineQuestionKinds(left.questions);
  const rightKind = right && pipelineQuestionKinds(right.questions);
  const comparable = !!leftKind && leftKind === rightKind;
  const choicesByKind = Map.groupBy(
    choices,
    (pipeline) => pipeline.comparabilityKey,
  );
  const sameGroup =
    left &&
    right &&
    left.primaryGroupedPipelineId === right.primaryGroupedPipelineId;
  const primary = sameGroup
    ? versions.find(
        (version) =>
          version.id === left.primaryGroupedPipelineId &&
          compatibleQuestions(left, version) &&
          compatibleQuestions(right, version),
      )
    : undefined;
  const canAttach =
    left &&
    right &&
    !sameGroup &&
    left.id === left.primaryGroupedPipelineId &&
    right.id === right.primaryGroupedPipelineId &&
    compatibleQuestions(left, right) &&
    !pipelines.some(
      (p) => p.id !== right.id && p.primaryGroupedPipelineId === right.id,
    );
  const anchor = primary ?? (canAttach ? left : undefined);

  return (
    <main className="mx-auto max-w-5xl space-y-6 py-8">
      <Link
        to="/pipelines"
        search={{ showIgnored: search.showIgnored }}
        className="text-sm underline"
      >
        Pipelines
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {search.associate
            ? "Associate with a primary pipeline"
            : "Compare pipelines"}
        </h1>
        <ViewModeSwitch
          showJson={search.json === true}
          onChange={(json) => {
            void navigate({
              search: (previous) => ({ ...previous, json: json || undefined }),
              replace: true,
            });
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["id1", "id2"] as const).map((key, index) => {
          const current = key === "id1" ? left : right;
          const other = key === "id1" ? right : left;
          const otherKind = key === "id1" ? rightKind : leftKind;
          const candidates =
            search.associate && key === "id1"
              ? choices.filter(
                  (pipeline) =>
                    pipeline.id === pipeline.primaryGroupedPipelineId &&
                    pipeline.linkShapeKey ===
                      pipelines.find((row) => row.id === right?.id)
                        ?.linkShapeKey,
                )
              : choices;
          const options = candidates.filter(
            (pipeline) =>
              pipeline.id === current?.id ||
              (other
                ? pipeline.id !== other.id &&
                  pipeline.comparabilityKey === otherKind
                : (choicesByKind.get(pipeline.comparabilityKey)?.length ?? 0) >
                  1),
          );
          return (
            <label key={key} className="min-w-0 space-y-1 text-sm font-medium">
              {search.associate
                ? index === 0
                  ? "Primary pipeline"
                  : "Pipeline to associate"
                : `Version ${index + 1}`}
              <select
                className="block w-full rounded-md border bg-background px-2 py-2 text-sm"
                value={current?.id ?? ""}
                disabled={search.associate === true && key === "id2"}
                onChange={(event) => {
                  void navigate({
                    search: {
                      ...search,
                      [key]: event.currentTarget.value || undefined,
                    },
                  });
                }}
              >
                <option value="">Select a pipeline</option>
                {options.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.displayName ?? pipeline.model ?? "Pending"} ·{" "}
                    {pipeline.id.slice(0, 8)} · {pipeline.comparabilityKey}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {left && right && left.id !== right.id && comparable ? (
        <Comparison
          key={`${left.id}/${right.id}/${anchor?.id ?? ""}`}
          left={left}
          right={right}
          primary={anchor}
          attach={!!canAttach}
          showJson={search.json === true}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {search.id1 && search.id2 && !(left && right)
            ? "One or both pipelines were not found."
            : left && right && left.id !== right.id
              ? "Choose pipelines with the same number of questions of each type."
              : "Select two different pipelines to compare."}
        </p>
      )}
    </main>
  );
}

function Comparison({
  left,
  right,
  primary,
  attach,
  showJson,
}: {
  left: PipelineVersion;
  right: PipelineVersion;
  primary: PipelineVersion | undefined;
  attach: boolean;
  showJson: boolean;
}) {
  const anchor = primary ?? left;
  const version =
    left.id === primary?.id
      ? right
      : right.id === primary?.id
        ? left
        : undefined;
  const [draft, setDraft] = useState(() =>
    version ? matchQuestions(version, anchor) : new Map<string, string>(),
  );
  const router = useRouter();
  const save = useMutation({
    mutationFn: updateQuestionLinks,
    onSuccess: () => router.invalidate(),
  });

  const leftLinks =
    version?.id === left.id ? draft : matchQuestions(left, anchor, !primary);
  const rightLinks =
    version?.id === right.id ? draft : matchQuestions(right, anchor, !primary);
  const rightByPrimary = new Map(
    right.questions.flatMap((question) => {
      const key = rightLinks.get(question.name);
      return key === undefined ? [] : [[key, question] as const];
    }),
  );
  const paired = new Set<string>();
  const pairs = left.questions.map((question) => {
    const key = leftLinks.get(question.name);
    const match = key === undefined ? undefined : rightByPrimary.get(key);
    if (match) paired.add(match.name);
    return {
      key: `left-${question.name}`,
      leftName: question.name,
      rightName: match?.name,
    };
  });
  const rows = [
    ...pairs,
    ...right.questions
      .filter((q) => !paired.has(q.name))
      .map((q) => ({ key: `right-${q.name}`, rightName: q.name })),
  ];
  const needsLinks =
    leftLinks.size !== left.questions.length ||
    rightLinks.size !== right.questions.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        {[left, right].map((pipeline) => (
          <div
            key={pipeline.id}
            className="min-w-0 space-y-1 rounded-lg border bg-muted p-3 text-sm"
          >
            <Link
              to="/pipelines/$id"
              params={{ id: pipeline.id }}
              search={{}}
              className="font-medium underline"
            >
              {pipeline.displayName ?? pipeline.model ?? "Definition pending"}
            </Link>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {pipeline.id}
            </p>
            <p className="break-all">
              {pipeline.displayName && pipeline.model && `${pipeline.model} · `}
              {pipeline.baseUrl ?? "Default upstream"}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {Object.keys(pipeline.options?.headers ?? {}).join(", ") ||
                "Default capabilities"}
            </p>
          </div>
        ))}
      </div>
      {version && primary ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-medium">Question links</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {version.questions.map((question) => (
              <label key={question.name} className="min-w-0 space-y-1 text-sm">
                <span className="break-all font-medium">{question.name}</span>
                <select
                  className="block w-full rounded-md border bg-background px-2 py-2 text-sm"
                  value={draft.get(question.name) ?? ""}
                  onChange={(event) => {
                    save.reset();
                    const value = event.currentTarget.value;
                    setDraft((current) => {
                      const next = new Map(
                        [...current].filter(
                          ([name, target]) =>
                            name !== question.name && target !== value,
                        ),
                      );
                      if (value) next.set(question.name, value);
                      return next;
                    });
                  }}
                >
                  <option value="">Choose primary question</option>
                  {primary.questions
                    .filter(
                      (target) => target.answerShape === question.answerShape,
                    )
                    .map((target) => (
                      <option key={target.name} value={target.name}>
                        {target.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <Button
            type="button"
            disabled={draft.size !== version.questions.length || save.isPending}
            onClick={() =>
              save.mutate({
                data: {
                  pipelineId: version.id,
                  primaryPipelineId: primary.id,
                  links: [...draft].map(([name, primaryName]) => ({
                    name,
                    primaryName,
                  })),
                },
              })
            }
          >
            {attach ? "Link to primary" : "Save links"}
          </Button>
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {save.error.message}
            </p>
          )}
          {save.isSuccess && (
            <p role="status" className="text-sm">
              Links saved.
            </p>
          )}
        </section>
      ) : primary ? (
        <div className="flex flex-wrap gap-4 text-sm">
          {[left, right].map((pipeline, index) => (
            <Link
              key={pipeline.id}
              to="/pipelines-diff"
              search={{ id1: primary.id, id2: pipeline.id }}
              className="underline"
            >
              Edit version {index + 1} links
            </Link>
          ))}
        </div>
      ) : null}
      {needsLinks && (
        <p className="text-sm text-muted-foreground">
          Unlinked questions are shown on their own.
        </p>
      )}
      <PipelineComparison
        left={pipelineSnapshot(left)}
        right={pipelineSnapshot(right)}
        pairs={rows}
        showJson={showJson}
      />
    </div>
  );
}
