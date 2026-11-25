import type { JsonValue } from "@typesafe-ai/sdk";
import type { z } from "zod";
import type { PipelineQuestion } from "@/lib/decisions/pipeline-schemas";
import type { systemOneResponse } from "@/lib/system-one/typesafe-api-schemas";
import { cn } from "@/lib/utils";
import { Content, DataText } from "./data-value";
import { QuestionName } from "./question-name";

export type NamedQuestion = Pick<
  PipelineQuestion,
  "name" | "alias" | "question"
>;
export type Answers = z.output<typeof systemOneResponse>["answers"];
type Answer = Answers[string];

const typeLabels = {
  noul: "Yes / no",
  choice: "Choice",
  score: "Score",
  box: "Bounding box",
} satisfies Record<NamedQuestion["question"]["type"], string>;

const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 2,
});
const score = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });

function QuestionLabel({
  name,
  alias,
  question,
  pipelineId,
}: NamedQuestion & { pipelineId?: string | undefined }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="min-w-0 text-sm">
        <QuestionName name={name} alias={alias} pipelineId={pipelineId} />
      </span>
      <span className="text-xs text-muted-foreground">
        {typeLabels[question.type]}
      </span>
    </span>
  );
}

export function QuestionView({
  name,
  alias,
  pipelineId,
  question,
  showJson,
  indentJson = false,
}: NamedQuestion & {
  pipelineId?: string | undefined;
  showJson?: boolean;
  indentJson?: boolean;
}) {
  return (
    <>
      <QuestionLabel
        name={name}
        alias={alias}
        question={question}
        pipelineId={pipelineId}
      />
      {showJson ? (
        <DataText value={question} indent={indentJson} />
      ) : (
        <>
          {question.instructions != null && (
            <Content value={question.instructions} />
          )}
          <QuestionCriteria question={question} />
        </>
      )}
    </>
  );
}

export function AnswerView({
  answer,
  question,
  showJson,
  indentJson = false,
}: {
  answer: Answer | undefined;
  question: NamedQuestion["question"];
  showJson?: boolean;
  indentJson?: boolean;
}) {
  if (!answer)
    return <p className="text-sm text-muted-foreground">No answer returned.</p>;
  return showJson ? (
    <DataText value={answer} indent={indentJson} />
  ) : (
    <QuestionAnswer answer={answer} question={question} />
  );
}

function QuestionCriteria({
  question,
}: {
  question: PipelineQuestion["question"];
}) {
  if (question.type === "box" || !question.criteria) return null;
  const entries: [string, JsonValue | undefined][] =
    question.type === "noul"
      ? [
          ["Yes", question.criteria.true],
          ["No", question.criteria.false],
        ]
      : Object.entries(question.criteria);
  const shown =
    question.type === "noul"
      ? entries.filter(([, value]) => value != null)
      : entries;
  if (question.type === "choice")
    shown.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (!shown.length) return null;

  const heading =
    question.type === "choice"
      ? "Choices"
      : question.type === "score"
        ? "Rubric"
        : "Criteria";
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{heading}</p>
      <dl className="space-y-1.5 border-l pl-3">
        {shown.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm font-medium wrap-anywhere">{label}</dt>
            {value != null && (
              <dd>
                <Content value={value} />
              </dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}

function ProbabilityList({
  values,
  label,
  descriptions,
  selected,
}: {
  values: Record<string, number>;
  label: string;
  descriptions?: Record<string, JsonValue> | undefined;
  selected?: { name: string; confidence: number; options: string[] };
}) {
  const names = Object.keys(values);
  const ordered = selected
    ? [...new Set([...selected.options, ...names, selected.name])].sort()
    : names;
  return (
    <dl aria-label={label} className={cn("text-sm", !selected && "divide-y")}>
      {ordered.map((name) => {
        const value = Object.hasOwn(values, name) ? values[name] : undefined;
        const winner = name === selected?.name;
        const description =
          descriptions && Object.hasOwn(descriptions, name)
            ? descriptions[name]
            : undefined;
        return (
          <div
            key={name}
            className={cn(
              "flex items-baseline justify-between gap-2",
              selected ? "rounded px-1.5 py-0.5" : "py-1.5",
              winner && "bg-muted font-semibold",
            )}
          >
            <dt
              className={cn(
                "min-w-0 wrap-anywhere",
                winner && "flex flex-wrap items-baseline gap-x-2",
              )}
            >
              {winner && <span className="sr-only">Selected </span>}
              {name}
              {winner && <AnswerConfidence value={selected.confidence} />}
              {description != null && <Content value={description} />}
            </dt>
            <dd className="shrink-0 tabular-nums">
              {value === undefined ? "—" : percent.format(value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function AnswerConfidence({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <p className="text-xs font-normal text-muted-foreground tabular-nums">
      {percent.format(value)} confidence
    </p>
  );
}

export function ScoreAnswerSummary({
  answer,
}: {
  answer: Extract<Answer, { type: "score" }>;
}) {
  return (
    <>
      <p className="text-sm font-semibold wrap-anywhere">
        Expected score {score.format(answer.score)}
      </p>
      <AnswerConfidence value={answer.confidence} />
    </>
  );
}

function QuestionAnswer({
  answer,
  question,
}: {
  answer: Answer;
  question: NamedQuestion["question"];
}) {
  switch (answer.type) {
    case "noul":
      return (
        <p className="text-sm">
          <span className="font-semibold tabular-nums">
            {percent.format(answer.noul)}
          </span>{" "}
          probability of yes
        </p>
      );
    case "choice":
      return (
        <ProbabilityList
          values={answer.probabilities}
          label="Choice probabilities"
          selected={{
            name: answer.choice,
            confidence: answer.confidence,
            options:
              question.type === "choice" ? Object.keys(question.criteria) : [],
          }}
        />
      );
    case "score":
      return (
        <>
          <ScoreAnswerSummary answer={answer} />
          <ProbabilityList
            values={answer.probabilities}
            label="Rubric probabilities"
            descriptions={answer.legend}
          />
        </>
      );
    case "box":
      return (
        <>
          <AnswerConfidence value={answer.confidence} />
          <ProbabilityList
            values={{
              Top: answer.box.top,
              Left: answer.box.left,
              Bottom: answer.box.bottom,
              Right: answer.box.right,
            }}
            label="Image edges"
          />
        </>
      );
  }
}
