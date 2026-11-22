import { type ReactNode, useState } from "react";
import {
  AlignedJsonColumns,
  type JsonRow,
  jsonProperty,
} from "./aligned-json-columns";
import { JsonText } from "./json-text";
import { QuestionName } from "./question-name";
import {
  type Answers,
  AnswerView,
  type NamedQuestion,
  QuestionView,
} from "./question-view";
import { ViewModeSwitch } from "./view-mode-switch";

type RenderAnswer = (
  question: NamedQuestion,
  answer: Answers[string] | undefined,
) => ReactNode;

export function PipelineQuestions({
  questions,
  pipelineId,
  answers,
  showJson,
  renderAnswer,
}: {
  questions: NamedQuestion[];
  pipelineId?: string | undefined;
  answers?: Answers | undefined;
  showJson?: boolean;
  renderAnswer?: RenderAnswer;
}) {
  const [localJson, setLocalJson] = useState(false);
  return (
    <div className="space-y-3">
      {showJson === undefined && (
        <ViewModeSwitch showJson={localJson} onChange={setLocalJson} />
      )}
      {(showJson ?? localJson) ? (
        <QuestionJsonColumns
          questions={questions}
          answers={answers}
          pipelineId={pipelineId}
        />
      ) : (
        <QuestionCards
          questions={questions}
          pipelineId={pipelineId}
          answers={answers}
          renderAnswer={renderAnswer}
        />
      )}
    </div>
  );
}

function QuestionJsonColumns({
  questions,
  pipelineId,
  answers,
}: {
  questions: NamedQuestion[];
  pipelineId?: string | undefined;
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
  const byKey = new Map(
    questions.map((question) => [`entry:${question.name}`, question]),
  );
  const rows = jsonRows(definitions, names).map((row): JsonRow => {
    const question = byKey.get(row.key);
    if (!question || (!pipelineId && !question.alias)) return row;
    return {
      ...row,
      content: (
        <>
          <span className="block select-none text-sm">
            <QuestionName
              name={question.name}
              alias={question.alias}
              pipelineId={pipelineId}
            />
          </span>
          <JsonText text={row.text} />
        </>
      ),
    };
  });
  const columns = [{ label: "Questions", rows }];
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
  pipelineId,
  answers,
  renderAnswer,
}: {
  questions: NamedQuestion[];
  pipelineId?: string | undefined;
  answers: Answers | undefined;
  renderAnswer: RenderAnswer | undefined;
}) {
  const showAnswers = answers || renderAnswer;
  return (
    <ul className="space-y-3">
      {questions.map((definition) => {
        const { name, question } = definition;
        const answer =
          answers && Object.hasOwn(answers, name) ? answers[name] : undefined;
        return (
          <li
            key={name}
            className={`grid overflow-hidden rounded-lg border bg-background ${showAnswers ? "md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}
          >
            <div className="min-w-0 space-y-3 p-4">
              <QuestionView {...definition} pipelineId={pipelineId} />
            </div>
            {showAnswers && (
              <div className="min-w-0 space-y-2 border-t bg-muted/50 p-4 md:border-t-0 md:border-l">
                <p className="text-xs font-medium text-muted-foreground">
                  Answer
                </p>
                {renderAnswer ? (
                  renderAnswer(definition, answer)
                ) : (
                  <AnswerView answer={answer} question={question} />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
