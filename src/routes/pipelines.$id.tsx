import { useMutation } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { z } from "zod";
import { CurlPreview } from "@/components/curl-preview";
import { PipelineQuestions } from "@/components/pipeline-questions";
import { Button } from "@/components/ui/button";
import { apiKeyHeader } from "@/lib/api-keys/schemas";
import {
  type PipelineVersion,
  pipelineQuestionKinds,
} from "@/lib/decisions/question-links";
import { buildCurl } from "@/lib/system-one/curl";
import { exactPipelineHeader } from "@/lib/system-one/type-helpers";
import { systemOneRequest } from "@/lib/system-one/typesafe-api-schemas";
import { typeSafeDecisionPath } from "@/lib/typesafe-api/paths";
import { getTypeSafeApiBaseUrl } from "@/server/functions";
import {
  getPipelineVersions,
  makePipelinePrimary,
  runStoredPipeline,
} from "@/server/pipelines";
import { systemOneRoutes } from "@/server/system-one/routes";

const testTab = z.enum(["ui", "typesafe-curl", "pipeline-curl"]);

export const Route = createFileRoute("/pipelines/$id")({
  validateSearch: z.object({
    exact: z.boolean().optional().catch(undefined),
    test: testTab.optional().catch(undefined),
  }),
  loader: async ({ params }) => {
    const id = z.uuid().safeParse(params.id.toLowerCase());
    if (!id.success) throw notFound();
    const [versions, baseUrl] = await Promise.all([
      getPipelineVersions({ data: [id.data] }),
      getTypeSafeApiBaseUrl(),
    ]);
    const pipeline = versions.find((version) => version.id === id.data);
    if (!pipeline) throw notFound();
    const primary = versions.find(
      (version) => version.id === pipeline.primaryGroupedPipelineId,
    );
    const kinds = pipelineQuestionKinds(pipeline.questions);
    return {
      pipeline,
      baseUrl,
      canCompareWithPrimary:
        !!primary &&
        !!kinds &&
        kinds === pipelineQuestionKinds(primary.questions),
    };
  },
  component: PipelinePage,
});

function PipelinePage() {
  const data = Route.useLoaderData();
  return <PipelineRunner key={data.pipeline.id} {...data} />;
}

function PipelineRunner({
  pipeline,
  canCompareWithPrimary,
  baseUrl,
}: {
  pipeline: PipelineVersion;
  canCompareWithPrimary: boolean;
  baseUrl: string;
}) {
  const { exact, test } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [error, setError] = useState("");
  const [stateText, setStateText] = useState("");
  const [structured, setStructured] = useState(false);
  const [useTypeSafeBaseUrl, setUseTypeSafeBaseUrl] = useState(false);
  const [usePipelineBaseUrl, setUsePipelineBaseUrl] = useState(true);
  const [stateFromFile, setStateFromFile] = useState(false);
  const run = useMutation({ mutationFn: runStoredPipeline });
  const promote = useMutation({
    mutationFn: makePipelinePrimary,
    onSuccess: () => router.invalidate(),
  });
  const isVersion = pipeline.id !== pipeline.primaryGroupedPipelineId;
  const example =
    !stateFromFile && test && test !== "ui" && stateText
      ? parseState(stateText, structured)
      : undefined;
  const stateField = { state: example?.success ? example.state : "<state>" };
  const stateOptions = {
    stateFromFile,
    setStateFromFile,
    hasStatePlaceholder: !stateFromFile && !example?.success,
    notice:
      example?.success === false
        ? "The command uses a placeholder because the state in Test in UI is invalid."
        : undefined,
  };
  const routing = exact === true ? { [exactPipelineHeader]: "true" } : {};

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
        {pipeline.options && (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link
                to="/pipelines/$id/duplicate"
                params={{ id: pipeline.id }}
                search={{}}
              >
                Evolve (duplicate and edit)
              </Link>
            </Button>
            {isVersion ? (
              <Button
                type="button"
                disabled={promote.isPending}
                onClick={() => promote.mutate({ data: pipeline.id })}
              >
                {promote.isPending ? "Updating…" : "Make primary"}
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">
                Primary version
              </span>
            )}
          </div>
        )}
        {promote.error && (
          <p role="alert" className="text-sm text-destructive">
            {promote.error.message}
          </p>
        )}
      </header>
      <section
        className="space-y-3 rounded-lg border p-4"
        aria-labelledby="pipeline-test"
      >
        <h2 id="pipeline-test" className="font-medium">
          Test
        </h2>
        <Tabs.Root
          value={test ?? "ui"}
          activationMode="manual"
          onValueChange={(value) => {
            const next = testTab.parse(value);
            void navigate({
              search: (previous) => ({
                ...previous,
                test: next === "ui" ? undefined : next,
              }),
              replace: true,
            });
          }}
        >
          <Tabs.List
            aria-labelledby="pipeline-test"
            className="flex flex-wrap gap-1 border-b"
          >
            <Tabs.Trigger value="ui" className={tabClass}>
              Test in UI
            </Tabs.Trigger>
            <Tabs.Trigger value="typesafe-curl" className={tabClass}>
              Copy TypeSafe API-Compatible curl
            </Tabs.Trigger>
            <Tabs.Trigger value="pipeline-curl" className={tabClass}>
              Copy Pipeline Reference curl
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="ui" className="pt-4">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                run.reset();
                const parsed = parseState(stateText, structured);
                if (!parsed.success) {
                  setError(parsed.error);
                  return;
                }
                run.mutate({
                  data: {
                    pipelineId: pipeline.id,
                    state: parsed.state,
                    exact: exact === true,
                  },
                });
              }}
            >
              <label className="block space-y-2 text-sm font-medium">
                State
                <textarea
                  rows={8}
                  className="block w-full rounded-md border px-3 py-2 font-mono"
                  placeholder="Paste the state to evaluate"
                  value={stateText}
                  onChange={(event) => setStateText(event.currentTarget.value)}
                />
              </label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={structured}
                    aria-describedby="state-format-help"
                    onChange={(event) =>
                      setStructured(event.currentTarget.checked)
                    }
                  />
                  Send structured JSON
                </label>
                {isVersion && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exact === true}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        void navigate({
                          search: (previous) => ({
                            ...previous,
                            exact: checked || undefined,
                          }),
                          replace: true,
                        });
                      }}
                    />
                    Run this version directly
                  </label>
                )}
              </div>
              <p
                id="state-format-help"
                className="text-xs text-muted-foreground"
              >
                Use JSON to send an object or array as state. Leave unchecked to
                send your input as text.
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
          </Tabs.Content>
          <Tabs.Content value="typesafe-curl" className="space-y-3 pt-4">
            {pipeline.model ? (
              <CurlPreview
                {...stateOptions}
                useCurrentBaseUrl={useTypeSafeBaseUrl}
                setUseCurrentBaseUrl={setUseTypeSafeBaseUrl}
                label="Copy TypeSafe curl"
                command={buildCurl(
                  `${useTypeSafeBaseUrl ? baseUrl : "<base-url>"}${typeSafeDecisionPath}`,
                  {
                    Authorization: "Bearer <api-key>",
                    ...pipeline.options?.headers,
                    ...routing,
                  },
                  {
                    model: pipeline.model,
                    ...stateField,
                    questions: Object.fromEntries(
                      pipeline.questions.map(({ name, question }) => [
                        name,
                        question,
                      ]),
                    ),
                  },
                  stateFromFile,
                )}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Definition pending.
              </p>
            )}
          </Tabs.Content>
          <Tabs.Content value="pipeline-curl" className="space-y-3 pt-4">
            <CurlPreview
              {...stateOptions}
              useCurrentBaseUrl={usePipelineBaseUrl}
              setUseCurrentBaseUrl={setUsePipelineBaseUrl}
              label="Copy pipeline reference curl"
              command={buildCurl(
                `${usePipelineBaseUrl ? baseUrl : "<base-url>"}${systemOneRoutes.decideByPipeline.path}`,
                {
                  [apiKeyHeader]: "<api-key>",
                  ...routing,
                },
                { pipelineId: pipeline.id, ...stateField },
                stateFromFile,
              )}
            />
          </Tabs.Content>
        </Tabs.Root>
      </section>
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

const tabClass =
  "cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-foreground data-[state=active]:text-foreground";

function parseState(text: string, structured: boolean) {
  let value: unknown = text;
  if (structured) {
    try {
      value = JSON.parse(text);
    } catch {
      return { success: false, error: "Enter valid JSON." } as const;
    }
  }
  const result = systemOneRequest.shape.state.safeParse(value);
  return result.success
    ? ({ success: true, state: result.data } as const)
    : ({
        success: false,
        error: "State must be text, a JSON object, or a JSON array.",
      } as const);
}
