import { useState } from "react";
import { AlignedJsonColumns, jsonProperty } from "./aligned-json-columns";
import {
  type Answers,
  AnswerView,
  type NamedQuestion,
  QuestionView,
} from "./question-view";
import { ViewModeSwitch } from "./view-mode-switch";

export function PipelineQuestions({
  questions,
  answers,
  showJson,
}: {
  questions: NamedQuestion[];
  answers?: Answers | undefined;
  showJson?: boolean;
}) {
  const [localJson, setLocalJson] = useState(false);
  return (
    <div className="space-y-3">
      {showJson === undefined && (
        <ViewModeSwitch showJson={localJson} onChange={setLocalJson} />
      )}
      {(showJson ?? localJson) ? (
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
  questions: NamedQuestion[];
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
  questions: NamedQuestion[];
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
              <QuestionView name={name} question={question} />
            </div>
            {answers && (
              <div className="min-w-0 space-y-2 border-t bg-muted/50 p-4 md:border-t-0 md:border-l">
                <p className="text-xs font-medium text-muted-foreground">
                  Answer
                </p>
                <AnswerView answer={answer} question={question} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
