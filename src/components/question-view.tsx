import type { JsonValue } from "@typesafe-ai/sdk";
import type { z } from "zod";
import type { PipelineQuestion } from "@/lib/decisions/question-links";
import type { systemOneResponse } from "@/lib/system-one/typesafe-api-schemas";
import { JsonText } from "./json-text";

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

export function QuestionLabel({ name, question }: NamedQuestion) {
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
  hideLabel,
}: NamedQuestion & { showJson?: boolean; hideLabel?: boolean }) {
  return (
    <>
      {!hideLabel && <QuestionLabel name={name} question={question} />}
      {showJson ? (
        <JsonValueView value={question} />
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

export function JsonValueView({
  value,
  compact,
}: {
  value: JsonValue;
  compact?: boolean | undefined;
}) {
  return (
    <pre
      className={`font-mono text-xs wrap-anywhere whitespace-pre-wrap ${compact ? "max-h-24 overflow-auto" : ""}`}
    >
      <JsonText text={JSON.stringify(value, null, compact ? undefined : 2)} />
    </pre>
  );
}

export function AnswerView({
  answer,
  showJson,
  compact,
}: {
  answer: Answer | undefined;
  showJson?: boolean;
  compact?: boolean;
}) {
  if (!answer)
    return <p className="text-sm text-muted-foreground">No answer returned.</p>;
  return showJson ? (
    <JsonValueView value={answer} compact={compact} />
  ) : (
    <QuestionAnswer answer={answer} compact={compact} />
  );
}

export function Content({ value }: { value: JsonValue }) {
  if (value === null || typeof value !== "object") {
    return (
      <p className="text-sm whitespace-pre-wrap wrap-anywhere">
        {String(value)}
      </p>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {Array.isArray(value) ? "Empty list" : "Empty object"}
      </p>
    );
  }
  return (
    <dl className="space-y-1 border-l pl-3">
      {entries.map(([key, entry]) => (
        <div key={key} className="text-sm">
          <dt className="font-medium wrap-anywhere">
            {Array.isArray(value) ? Number(key) + 1 : key}
          </dt>
          <dd>
            <Content value={entry} />
          </dd>
        </div>
      ))}
    </dl>
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

function QuestionAnswer({
  answer,
  compact,
}: {
  answer: Answer;
  compact: boolean | undefined;
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
    case "score":
      return (
        <>
          <p className="text-sm font-semibold wrap-anywhere">
            {answer.type === "choice"
              ? answer.choice
              : `Expected score ${score.format(answer.score)}`}
          </p>
          {!compact && (
            <>
              <p className="text-xs text-muted-foreground">
                {percent.format(answer.confidence)} confidence
              </p>
              <ProbabilityList
                values={answer.probabilities}
                label={
                  answer.type === "choice"
                    ? "Choice probabilities"
                    : "Rubric probabilities"
                }
                descriptions={
                  answer.type === "score" ? answer.legend : undefined
                }
              />
            </>
          )}
        </>
      );
    case "box":
      return (
        <>
          {answer.confidence !== null && (
            <p className="text-sm">
              {percent.format(answer.confidence)} confidence
            </p>
          )}
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
