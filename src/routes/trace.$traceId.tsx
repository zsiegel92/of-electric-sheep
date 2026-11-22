import { createFileRoute, notFound } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { z } from "zod";
import { ExpandableDataValue } from "@/components/expandable-data-value";
import { PageHeader } from "@/components/page-header";
import { PipelineQuestions } from "@/components/pipeline-questions";
import { PipelineViewLinks } from "@/components/pipeline-view-links";
import { QuestionName } from "@/components/question-name";
import {
  FinishTraceAnnotation,
  TraceAnnotationEditor,
  TraceAnswer,
} from "@/components/traces/trace-annotation";
import { TraceTime } from "@/components/traces/trace-table";
import { Button } from "@/components/ui/button";
import { ViewModeSwitch } from "@/components/view-mode-switch";
import { traceId } from "@/lib/langfuse/schemas";
import { getDecisionTrace } from "@/server/traces";

export const Route = createFileRoute("/trace/$traceId")({
  validateSearch: z.object({
    json: z.boolean().optional().catch(undefined),
  }),
  loader: ({ params }) => {
    const id = traceId.safeParse(params.traceId.toLowerCase());
    if (!id.success) throw notFound();
    return getDecisionTrace({ data: id.data });
  },
  component: TraceDetail,
});

function TraceDetail() {
  const { json = false } = Route.useSearch();
  const {
    pipeline,
    trace,
    questions,
    langfuseUrl,
    annotations,
    annotationQuestions,
  } = Route.useLoaderData();
  const choicesByQuestion = new Map(
    annotationQuestions.map(({ name, choices }) => [name, choices]),
  );
  return (
    <TraceAnnotationEditor
      key={trace.traceId}
      pipelineId={pipeline.id}
      traceId={trace.traceId}
      annotations={annotations}
    >
      <div className="space-y-6">
        <div className="space-y-1">
          <PageHeader
            title="Decision trace"
            pipelineName={pipeline.name}
            actions={
              <PipelineViewLinks pipelineId={pipeline.id} showJson={json} />
            }
            controls={
              <div className="flex flex-wrap items-center gap-2">
                <TraceViewMode />
                <LangfuseLink href={langfuseUrl} />
                <FinishTraceAnnotation />
              </div>
            }
          />
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
        {trace.state !== undefined && (
          <ExpandableDataValue
            key={trace.traceId}
            label="Input state"
            value={trace.state}
            showJson={json}
          />
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
          renderAnswer={(question, answer) => (
            <TraceAnswer
              {...question}
              answer={answer}
              choices={choicesByQuestion.get(question.name) ?? []}
            />
          )}
        />
        {json && annotationQuestions.length > 0 && (
          <section
            aria-label="Trace annotations"
            className="grid gap-3 sm:grid-cols-2"
          >
            {questions
              .filter(({ name }) => choicesByQuestion.has(name))
              .map((question) => (
                <div
                  key={question.name}
                  className="min-w-0 space-y-2 rounded-lg border p-3"
                >
                  <p className="text-sm">
                    <QuestionName name={question.name} alias={question.alias} />
                  </p>
                  <TraceAnswer
                    {...question}
                    controlsOnly
                    choices={choicesByQuestion.get(question.name) ?? []}
                    answer={
                      trace.answers &&
                      Object.hasOwn(trace.answers, question.name)
                        ? trace.answers[question.name]
                        : undefined
                    }
                  />
                </div>
              ))}
          </section>
        )}
      </div>
    </TraceAnnotationEditor>
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
