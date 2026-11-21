import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PipelineQuestions } from "@/components/pipeline-questions";
import { Button } from "@/components/ui/button";
import { pipelineQuestionKinds } from "@/lib/decisions/question-links";
import { systemOneRequest } from "@/lib/system-one/typesafe-api-schemas";
import { getPipelineVersions, runStoredPipeline } from "@/server/pipelines";

export const Route = createFileRoute("/pipelines/$id")({
  validateSearch: z.object({ exact: z.boolean().optional().catch(undefined) }),
  loader: async ({ params }) => {
    const id = z.uuid().safeParse(params.id.toLowerCase());
    if (!id.success) throw notFound();
    const versions = await getPipelineVersions({ data: [id.data] });
    const pipeline = versions.find((version) => version.id === id.data);
    if (!pipeline) throw notFound();
    const primary = versions.find(
      (version) => version.id === pipeline.primaryGroupedPipelineId,
    );
    const kinds = pipelineQuestionKinds(pipeline.questions);
    return {
      pipeline,
      canCompareWithPrimary:
        !!primary &&
        !!kinds &&
        kinds === pipelineQuestionKinds(primary.questions),
    };
  },
  component: PipelinePage,
});

function PipelinePage() {
  const { pipeline } = Route.useLoaderData();
  return <PipelineRunner key={pipeline.id} />;
}

function PipelineRunner() {
  const { pipeline, canCompareWithPrimary } = Route.useLoaderData();
  const { exact } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [error, setError] = useState("");
  const run = useMutation({ mutationFn: runStoredPipeline });
  const isVersion = pipeline.id !== pipeline.primaryGroupedPipelineId;

  return (
    <main className="mx-auto max-w-5xl space-y-6 py-8">
      <Link to="/pipelines" className="text-sm underline">
        Pipelines
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {pipeline.displayName ?? pipeline.model ?? "Definition pending"}
        </h1>
        <p className="break-all font-mono text-sm text-muted-foreground">
          {pipeline.id}
        </p>
        <p className="break-all text-sm text-muted-foreground">
          {pipeline.displayName && pipeline.model && `${pipeline.model} · `}
          {pipeline.questions.length} questions ·{" "}
          {pipeline.baseUrl ?? "Default upstream"}
        </p>
        {isVersion && canCompareWithPrimary && (
          <Link
            to="/pipelines-diff"
            search={{
              id1: pipeline.primaryGroupedPipelineId,
              id2: pipeline.id,
            }}
            className="text-sm underline"
          >
            Compare with primary
          </Link>
        )}
      </header>
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError("");
          run.reset();
          const value = form.get("state");
          if (typeof value !== "string") return;
          let state: unknown = value;
          if (form.has("json")) {
            try {
              state = JSON.parse(value);
            } catch {
              setError("Enter valid JSON.");
              return;
            }
          }
          const parsed = systemOneRequest.shape.state.safeParse(state);
          if (!parsed.success) {
            setError("State must be text, a JSON object, or a JSON array.");
            return;
          }
          run.mutate({
            data: {
              pipelineId: pipeline.id,
              state: parsed.data,
              exact: exact === true,
            },
          });
        }}
      >
        <label className="block space-y-2 text-sm font-medium">
          State
          <textarea
            name="state"
            rows={8}
            className="block w-full rounded-md border px-3 py-2 font-mono"
            placeholder="Paste the state to evaluate"
          />
        </label>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="json"
              aria-describedby="state-format-help"
            />{" "}
            Send structured JSON
          </label>
          {isVersion && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={exact === true}
                onChange={(event) => {
                  void navigate({
                    search: {
                      exact: event.currentTarget.checked || undefined,
                    },
                    replace: true,
                  });
                }}
              />
              Run this version directly
            </label>
          )}
        </div>
        <p id="state-format-help" className="text-xs text-muted-foreground">
          Use JSON to send an object or array as state. Leave unchecked to send
          your input as text.
        </p>
        <Button type="submit" disabled={run.isPending || !pipeline.model}>
          {run.isPending ? "Running…" : "Run decision"}
        </Button>
        {(error || run.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || run.error?.message}
          </p>
        )}
      </form>
      <section className="space-y-3" aria-labelledby="pipeline-questions">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pipeline-questions" className="font-medium">
            Questions in this version
          </h2>
          <p role="status" className="text-xs text-muted-foreground">
            {run.isPending
              ? "Waiting for answers…"
              : run.data
                ? `${run.data.model} · ${run.data.usage.input_tokens} input tokens · ${run.data.usage.output_tokens} output tokens`
                : ""}
          </p>
        </div>
        {pipeline.questions.length ? (
          <PipelineQuestions
            questions={pipeline.questions}
            answers={run.data?.answers}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Definition pending.</p>
        )}
      </section>
    </main>
  );
}
