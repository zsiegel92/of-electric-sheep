import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { systemOneRequest } from "@/lib/system-one/typesafe-api-schemas";
import { getPipelineVersions, runStoredPipeline } from "@/server/pipelines";

export const Route = createFileRoute("/pipelines/$id")({
  validateSearch: z.object({ exact: z.boolean().optional().catch(undefined) }),
  loader: async ({ params }) => {
    const id = z.uuid().safeParse(params.id.toLowerCase());
    if (!id.success) throw notFound();
    const pipeline = (await getPipelineVersions({ data: [id.data] })).find(
      (version) => version.id === id.data,
    );
    if (!pipeline) throw notFound();
    return pipeline;
  },
  component: PipelinePage,
});

function PipelinePage() {
  const pipeline = Route.useLoaderData();
  return <PipelineRunner key={pipeline.id} />;
}

function PipelineRunner() {
  const pipeline = Route.useLoaderData();
  const { exact } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [error, setError] = useState("");
  const run = useMutation({ mutationFn: runStoredPipeline });
  const isVersion = pipeline.id !== pipeline.primaryGroupedPipelineId;

  return (
    <main className="mx-auto max-w-4xl space-y-6 py-8">
      <Link to="/pipelines" className="text-sm underline">
        Pipelines
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {pipeline.model ?? "Definition pending"}
        </h1>
        <p className="break-all font-mono text-sm text-muted-foreground">
          {pipeline.id}
        </p>
        <p className="break-all text-sm text-muted-foreground">
          {pipeline.questions.length} questions ·{" "}
          {pipeline.baseUrl ?? "Default upstream"}
        </p>
        {isVersion && (
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
            <input type="checkbox" name="json" /> Parse state as JSON
          </label>
          {isVersion && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={exact === true}
                onChange={(event) => {
                  void navigate({
                    search: { exact: event.currentTarget.checked || undefined },
                    replace: true,
                  });
                }}
              />
              Run this version directly
            </label>
          )}
        </div>
        <Button type="submit" disabled={run.isPending || !pipeline.model}>
          {run.isPending ? "Running…" : "Run decision"}
        </Button>
        {(error || run.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || run.error?.message}
          </p>
        )}
      </form>
      {run.data && (
        <section className="space-y-2">
          <h2 className="font-medium">Decision output</h2>
          <pre className="overflow-auto rounded-lg border bg-muted p-4 text-sm">
            {JSON.stringify(run.data, null, 2)}
          </pre>
        </section>
      )}
      {pipeline.questions.length > 0 && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Questions in this version
          </summary>
          <pre className="mt-3 overflow-auto text-sm">
            {JSON.stringify(
              Object.fromEntries(
                pipeline.questions.map(({ name, question }) => [
                  name,
                  question,
                ]),
              ),
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </main>
  );
}
