import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { runStoredPipeline } from "@/server/pipelines";
import { getStoredTraceAnnotations } from "@/server/traces";
import { PipelineQuestions } from "./pipeline-questions";
import { TraceDetailLink } from "./pipeline-view-links";
import type { NamedQuestion } from "./question-view";
import {
  FinishTraceAnnotation,
  TraceAnnotationEditor,
} from "./traces/trace-annotation";
import { TraceQuestions } from "./traces/trace-questions";
import { Button } from "./ui/button";
import { ViewModeSwitch } from "./view-mode-switch";

export function PipelineTestQuestions({
  pipelineId,
  questions,
  result,
}: {
  pipelineId: string;
  questions: NamedQuestion[];
  result: Awaited<ReturnType<typeof runStoredPipeline>> | undefined;
}) {
  const [showJson, setShowJson] = useState(false);
  const viewMode = (
    <ViewModeSwitch showJson={showJson} onChange={setShowJson} />
  );
  const traceId = result?.traceId;
  const annotation = result?.traceAnnotation;
  const queryClient = useQueryClient();
  const queryKey = [
    "stored-trace-annotations",
    annotation?.pipelineId,
    traceId,
  ];
  const storedAnnotations = useQuery({
    queryKey,
    queryFn:
      traceId && annotation
        ? () =>
            getStoredTraceAnnotations({
              data: { pipelineId: annotation.pipelineId, traceId },
            })
        : skipToken,
    refetchInterval: ({ state }) =>
      state.data === null && state.dataUpdateCount < 15 ? 1000 : false,
    retry: false,
    staleTime: Infinity,
  });
  const annotations = storedAnnotations.data;
  const stillPending =
    storedAnnotations.isError ||
    (!storedAnnotations.isFetching &&
      (queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0) >= 15);
  if (!traceId || !annotation || !annotations) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {viewMode}
          {traceId && (
            <p role="status" className="text-xs text-muted-foreground">
              {stillPending ? "Trace is still pending." : "Saving trace…"}
            </p>
          )}
          {traceId && stillPending && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={storedAnnotations.isFetching}
              onClick={() => void storedAnnotations.refetch()}
            >
              Check again
            </Button>
          )}
        </div>
        <PipelineQuestions
          pipelineId={pipelineId}
          questions={questions}
          answers={result?.answers}
          showJson={showJson}
        />
      </div>
    );
  }
  return (
    <TraceAnnotationEditor
      key={traceId}
      traceId={traceId}
      pipelineId={annotation.pipelineId}
      annotations={annotations}
      questionLinks={new Map(annotation.questionLinks)}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {viewMode}
          <TraceDetailLink traceId={traceId} showJson={showJson} />
          <FinishTraceAnnotation />
        </div>
        <TraceQuestions
          pipelineId={pipelineId}
          questions={questions}
          answers={result.answers}
          showJson={showJson}
        />
      </div>
    </TraceAnnotationEditor>
  );
}
