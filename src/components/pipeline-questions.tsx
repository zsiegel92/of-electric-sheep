import type { JsonValue } from "@typesafe-ai/sdk";
import { useState } from "react";
import type { z } from "zod";
import type { PipelineQuestion } from "@/lib/decisions/question-links";
import type { systemOneResponse } from "@/lib/system-one/typesafe-api-schemas";
import { AlignedJsonColumns, jsonProperty } from "./aligned-json-columns";
import { ViewModeSwitch } from "./view-mode-switch";

type Answers = z.output<typeof systemOneResponse>["answers"];
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

export function PipelineQuestions({
  questions,
  answers,
}: {
  questions: PipelineQuestion[];
  answers?: Answers | undefined;
}) {
  const [showJson, setShowJson] = useState(false);
  return (
    <div className="space-y-3">
      <ViewModeSwitch showJson={showJson} onChange={setShowJson} />
      {showJson ? (
        <QuestionJsonColumns questions={questions} answers={answers} />
      ) : (
        <QuestionCards questions={questions} answers={answers} />
      )}
    </div>
  );
}

function QuestionJsonColumns({
  questions,
  answers,
}: {
  questions: PipelineQuestion[];
  answers: Answers | undefined;
}) {
  const definitions = Object.fromEntries(
    questions.map(({ name, question }) => [name, question]),
  );
  const names = [
    ...questions.map(({ name }) => name),
    ...Object.keys(answers ?? {}).filter(
      (name) => !Object.hasOwn(definitions, name),
    ),
  ];
  const columns = [{ label: "Questions", rows: jsonRows(definitions, names) }];
  if (answers)
    columns.push({ label: "Answers", rows: jsonRows(answers, names) });

  return <AlignedJsonColumns columns={columns} />;
}

function jsonRows(values: Record<string, unknown>, names: string[]) {
  const last = names.findLast((name) => Object.hasOwn(values, name));
  return [
    { key: "open", text: "{" },
    ...names.map((name) => ({
      key: `entry:${name}`,
      text: Object.hasOwn(values, name)
        ? `${jsonProperty(name, values[name], 1)}${name === last ? "" : ","}`
        : "",
    })),
    { key: "close", text: "}" },
  ];
}

function QuestionCards({
  questions,
  answers,
}: {
  questions: PipelineQuestion[];
  answers: Answers | undefined;
}) {
  return (
    <ul className="space-y-3">
      {questions.map(({ name, question }) => {
        const answer =
          answers && Object.hasOwn(answers, name) ? answers[name] : undefined;
        return (
          <li
            key={name}
            className={`grid overflow-hidden rounded-lg border bg-background ${answers ? "md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}
          >
            <div className="min-w-0 space-y-3 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="font-mono text-sm font-medium wrap-anywhere">
                  {name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {typeLabels[question.type]}
                </p>
              </div>
              {question.instructions != null && (
                <Content value={question.instructions} />
              )}
              <QuestionCriteria question={question} />
            </div>
            {answers && (
              <div className="min-w-0 space-y-2 border-t bg-muted/50 p-4 md:border-t-0 md:border-l">
                <p className="text-xs font-medium text-muted-foreground">
                  Answer
                </p>
                {answer ? (
                  <QuestionAnswer answer={answer} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No answer returned.
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Content({ value }: { value: JsonValue }) {
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
            descriptions={answer.type === "score" ? answer.legend : undefined}
          />
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
