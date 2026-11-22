import { Link } from "@tanstack/react-router";
import { ChevronsLeftRight, ChevronsRightLeft } from "lucide-react";
import {
  type Answers,
  AnswerView,
  type NamedQuestion,
  QuestionLabel,
  QuestionView,
} from "@/components/question-view";

export function TraceTable({
  traces,
  questions,
  expanded,
  showJson,
  onToggle,
}: {
  traces: {
    traceId: string;
    startTime: string;
    model: string | null | undefined;
    failed: boolean;
    answers: Answers | undefined;
  }[];
  questions: NamedQuestion[];
  expanded: string[];
  showJson: boolean;
  onToggle: (name: string) => void;
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
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 bg-muted p-3 align-top border-b"
            >
              Trace
            </th>
            {questions.map((question) => (
              <QuestionColumn
                key={question.name}
                question={question}
                open={expanded.includes(question.name)}
                showJson={showJson}
                onToggle={onToggle}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {traces.map(({ traceId, startTime, model, failed, answers }) => (
            <tr key={traceId}>
              <th
                scope="row"
                className="sticky left-0 z-10 min-w-36 bg-background border-b p-3 align-top text-sm font-normal"
              >
                <Link
                  to="/traces/$id"
                  params={{ id: traceId }}
                  search={{ json: showJson || undefined }}
                  className="font-mono underline"
                  title={traceId}
                >
                  {traceId.slice(0, 12)}
                </Link>
                <div className="mt-1 text-xs text-muted-foreground">
                  <TraceTime value={startTime} />
                  {model && <p className="wrap-anywhere">{model}</p>}
                  {failed && <p className="text-destructive">Failed</p>}
                </div>
              </th>
              {questions.map(({ name }) => (
                <td
                  key={name}
                  className="border-b border-l p-3 align-top space-y-1"
                >
                  <AnswerView
                    answer={
                      answers && Object.hasOwn(answers, name)
                        ? answers[name]
                        : undefined
                    }
                    showJson={showJson}
                    compact={!expanded.includes(name)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function QuestionColumn({
  question,
  open,
  showJson,
  onToggle,
}: {
  question: NamedQuestion;
  open: boolean;
  showJson: boolean;
  onToggle: (name: string) => void;
}) {
  const Icon = open ? ChevronsRightLeft : ChevronsLeftRight;
  return (
    <th
      scope="col"
      className="border-b border-l bg-muted p-3 align-top font-normal"
    >
      <div className={open ? "w-80 sm:w-[28rem]" : "w-36"}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${question.name}`}
          onClick={() => onToggle(question.name)}
          className="flex w-full cursor-pointer items-start justify-between gap-2 rounded text-left hover:text-primary focus-visible:outline-2"
        >
          <QuestionLabel {...question} />
          <Icon aria-hidden="true" className="size-4 shrink-0" />
        </button>
        {open && (
          <section
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll long questions.
            tabIndex={0}
            aria-label={question.name}
            className="mt-2 max-h-48 space-y-2 overflow-auto border-t pt-2"
          >
            <QuestionView {...question} hideLabel showJson={showJson} />
          </section>
        )}
      </div>
    </th>
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
