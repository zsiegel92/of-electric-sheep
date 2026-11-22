import type { JsonValue } from "@typesafe-ai/sdk";
import { DataValue } from "@/components/data-value";
import { TraceDetailLink } from "@/components/pipeline-view-links";
import {
  type Answers,
  AnswerView,
  type NamedQuestion,
  QuestionView,
} from "@/components/question-view";
import { TraceTableCell, TraceTableRow } from "./trace-table-cell";

export function TraceTable({
  traces,
  questions,
  showJson,
}: {
  traces: {
    traceId: string;
    startTime: string;
    model: string | null | undefined;
    failed: boolean;
    state: JsonValue | undefined;
    answers: Answers | undefined;
  }[];
  questions: NamedQuestion[];
  showJson: boolean;
}) {
  return (
    <section
      aria-label="Decision traces"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the table.
      tabIndex={0}
      className="max-h-[70vh] overflow-auto rounded-lg border"
    >
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-20">
          <TraceTableRow header>
            <th
              scope="col"
              className="sticky left-0 z-10 w-px min-w-36 border-b bg-muted p-3 align-top"
            >
              Trace
            </th>
            <th
              scope="col"
              className="w-1/3 min-w-52 border-b border-l bg-muted p-3 align-top"
            >
              Input
            </th>
            {questions.map((question) => (
              <TraceTableCell
                key={question.name}
                label={question.name}
                scope="col"
                className="w-56 min-w-56"
              >
                <QuestionView {...question} showJson={showJson} indentJson />
              </TraceTableCell>
            ))}
          </TraceTableRow>
        </thead>
        <tbody>
          {traces.map(
            ({ traceId, startTime, model, failed, state, answers }) => (
              <TraceTableRow key={traceId}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-36 border-b bg-background p-3 align-top text-sm font-normal"
                >
                  <TraceDetailLink traceId={traceId} showJson={showJson} />
                  <div className="mt-1 text-xs text-muted-foreground">
                    <p className="font-mono" title={traceId}>
                      {traceId.slice(0, 12)}
                    </p>
                    <TraceTime value={startTime} />
                    {model && <p className="wrap-anywhere">{model}</p>}
                    {failed && <p className="text-destructive">Failed</p>}
                  </div>
                </th>
                <TraceTableCell label="input">
                  {state === undefined ? (
                    <p className="text-sm text-muted-foreground">
                      No input recorded.
                    </p>
                  ) : (
                    <DataValue value={state} showJson={showJson} indentJson />
                  )}
                </TraceTableCell>
                {questions.map(({ name, question }) => (
                  <TraceTableCell key={name} label={`${name} answer`}>
                    <AnswerView
                      answer={
                        answers && Object.hasOwn(answers, name)
                          ? answers[name]
                          : undefined
                      }
                      showJson={showJson}
                      question={question}
                      indentJson
                    />
                  </TraceTableCell>
                ))}
              </TraceTableRow>
            ),
          )}
        </tbody>
      </table>
    </section>
  );
}

export function TraceTime({ value }: { value: string }) {
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={value} className="whitespace-nowrap">
      {iso.slice(0, 10)} {iso.slice(11, 19)} UTC
    </time>
  );
}
