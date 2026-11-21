import { createFileRoute, Link } from "@tanstack/react-router";
import { listPipelines } from "@/server/pipelines";

export const Route = createFileRoute("/pipelines/")({
  loader: () => listPipelines(),
  component: Pipelines,
});

function Pipelines() {
  const pipelines = Route.useLoaderData();
  const primaries = pipelines.filter(
    (pipeline) => pipeline.id === pipeline.primaryGroupedPipelineId,
  );
  return (
    <main className="mx-auto max-w-5xl space-y-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Pipelines</h1>
        {pipelines.length > 1 && (
          <Link to="/pipelines-diff" search={{}} className="text-sm underline">
            Compare pipelines
          </Link>
        )}
      </div>
      {primaries.length === 0 && (
        <p className="rounded-md border p-5 text-sm text-muted-foreground">
          No pipelines yet. A pipeline is created the first time you send a
          System One decision.
        </p>
      )}
      {primaries.map((primary) => {
        const versions = [
          primary,
          ...pipelines.filter(
            (pipeline) =>
              pipeline.id !== primary.id &&
              pipeline.primaryGroupedPipelineId === primary.id,
          ),
        ];
        return (
          <ul
            className="overflow-hidden rounded-lg border"
            key={primary.id}
            aria-label={`Versions of ${primary.model ?? primary.id}`}
          >
            {versions.map((pipeline) => (
              <li
                key={pipeline.id}
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${pipeline.id === primary.id ? "bg-muted" : "border-t"}`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    {pipeline.model ?? "Definition pending"}{" "}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {pipeline.id === primary.id ? "Primary" : "Version"}
                    </span>
                  </p>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {pipeline.id}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {pipeline.questionCount} questions ·{" "}
                    {pipeline.createdAt.slice(0, 10)} ·{" "}
                    {pipeline.baseUrl ?? "Default upstream"}
                  </p>
                </div>
                <div className="flex gap-4 text-sm">
                  {pipeline.id !== primary.id && (
                    <Link
                      to="/pipelines-diff"
                      search={{ id1: primary.id, id2: pipeline.id }}
                      className="underline"
                    >
                      Compare
                    </Link>
                  )}
                  <Link
                    to="/pipelines/$id"
                    params={{ id: pipeline.id }}
                    search={{}}
                    className="underline"
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        );
      })}
    </main>
  );
}
