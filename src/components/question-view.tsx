import type { JsonValue } from "@typesafe-ai/sdk";
import type { z } from "zod";
import type { PipelineQuestion } from "@/lib/decisions/question-links";
import type { systemOneResponse } from "@/lib/system-one/typesafe-api-schemas";
import { Content, DataText } from "./data-value";

export type NamedQuestion = Pick<PipelineQuestion, "name" | "question">;
export type Answers = z.output<typeof systemOneResponse>["answers"];
type Answer = Answers[string];

const typeLabels = {
  noul: "Yes / no",
  choice: "Choice",
  score: "Score",
  box: "Bounding box",
};

const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 2,
});
const score = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });

function QuestionLabel({ name, question }: NamedQuestion) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-mono text-sm font-medium wrap-anywhere">
        {name}
      </span>
      <span className="text-xs text-muted-foreground">
        {typeLabels[question.type]}
      </span>
    </span>
  );
}

export function QuestionView({
  name,
  question,
  showJson,
  indentJson = false,
}: NamedQuestion & {
  showJson?: boolean;
  indentJson?: boolean;
}) {
  return (
    <>
      <QuestionLabel name={name} question={question} />
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
  showJson,
  indentJson = false,
}: {
  answer: Answer | undefined;
  showJson?: boolean;
  indentJson?: boolean;
}) {
  if (!answer)
    return <p className="text-sm text-muted-foreground">No answer returned.</p>;
  return showJson ? (
    <DataText value={answer} indent={indentJson} />
  ) : (
    <QuestionAnswer answer={answer} />
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
}: {
  values: Record<string, number>;
  label: string;
  descriptions?: Record<string, JsonValue> | undefined;
}) {
  return (
    <dl aria-label={label} className="divide-y text-sm">
      {Object.entries(values).map(([name, value]) => {
        const description =
          descriptions && Object.hasOwn(descriptions, name)
            ? descriptions[name]
            : undefined;
        return (
          <div key={name} className="flex justify-between gap-2 py-1.5">
            <dt className="wrap-anywhere">
              {name}
              {description != null && <Content value={description} />}
            </dt>
            <dd className="shrink-0 tabular-nums">{percent.format(value)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function AnswerConfidence({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {percent.format(value)} confidence
    </p>
  );
}

function QuestionAnswer({ answer }: { answer: Answer }) {
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
    case "score":
      return (
        <>
          <p className="text-sm font-semibold wrap-anywhere">
            {answer.type === "choice"
              ? answer.choice
              : `Expected score ${score.format(answer.score)}`}
          </p>
          <AnswerConfidence value={answer.confidence} />
          <ProbabilityList
            values={answer.probabilities}
            label={
              answer.type === "choice"
                ? "Choice probabilities"
                : "Rubric probabilities"
            }
            descriptions={answer.type === "score" ? answer.legend : undefined}
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
