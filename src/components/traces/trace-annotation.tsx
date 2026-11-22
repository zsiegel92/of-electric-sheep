import { Check } from "lucide-react";
import { Tooltip } from "radix-ui";
import { createContext, type ReactNode, useContext, useState } from "react";
import {
  type Answers,
  AnswerView,
  type NamedQuestion,
  ScoreAnswerSummary,
} from "@/components/question-view";
import { Button } from "@/components/ui/button";
import {
  annotationChoices,
  type TraceAnnotation,
} from "@/lib/traces/annotations";
import { cn } from "@/lib/utils";
import { saveTraceAnnotation } from "@/server/traces";

type QuestionSave = {
  choiceKey?: string | null;
  pending?: boolean;
  error?: "save" | "remove";
};
type AnnotationEditor = {
  saved: Map<string, string>;
  changes: Map<string, QuestionSave>;
  done: boolean;
  setDone: (done: boolean) => void;
  finish?: (() => void) | undefined;
  save: (questionName: string, choiceKey: string | null) => Promise<void>;
};

const AnnotationContext = createContext<AnnotationEditor | null>(null);

export function TraceAnnotationEditor({
  pipelineId,
  traceId,
  annotations,
  finish,
  children,
}: {
  pipelineId: string;
  traceId: string;
  annotations: TraceAnnotation[];
  finish?: (() => void) | undefined;
  children: ReactNode;
}) {
  const [changes, setChanges] = useState(new Map<string, QuestionSave>());
  const [done, setDone] = useState(false);
  const saved = new Map(
    annotations.map(({ questionName, choiceKey }) => [questionName, choiceKey]),
  );
  for (const [name, { choiceKey }] of changes) {
    if (choiceKey === null) saved.delete(name);
    else if (choiceKey !== undefined) saved.set(name, choiceKey);
  }

  async function save(questionName: string, choiceKey: string | null) {
    if (
      (done && choiceKey !== null) ||
      changes.get(questionName)?.pending ||
      (saved.get(questionName) ?? null) === choiceKey
    )
      return;
    const previous = changes.get(questionName)?.choiceKey;
    const update = (change: QuestionSave) =>
      setChanges((current) => new Map(current).set(questionName, change));
    const current = previous === undefined ? {} : { choiceKey: previous };
    update({ ...current, pending: true });
    try {
      await saveTraceAnnotation({
        data: { pipelineId, traceId, questionName, choiceKey },
      });
      update({ choiceKey });
      if (choiceKey === null) setDone(false);
    } catch {
      update({ ...current, error: choiceKey === null ? "remove" : "save" });
    }
  }

  return (
    <AnnotationContext value={{ saved, changes, done, setDone, finish, save }}>
      {children}
    </AnnotationContext>
  );
}

export function FinishTraceAnnotation() {
  const editor = useContext(AnnotationContext);
  if (!editor?.saved.size) return null;
  const pending = [...editor.changes.values()].some(({ pending }) => pending);
  if (editor.done) {
    return (
      <Button variant="outline" size="xs" onClick={() => editor.setDone(false)}>
        Edit annotations
      </Button>
    );
  }
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            onClick={editor.finish ?? (() => editor.setDone(true))}
          >
            <Check aria-hidden="true" /> Done editing
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={6}
            className="z-50 max-w-60 rounded-md bg-popover border px-3 py-2 text-xs text-popover-foreground shadow-md"
          >
            Each choice saves immediately. This trace appears under Annotated
            the next time you load the queue.
            {editor.finish && " Done editing removes it from this queue now."}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 2,
});

export function TraceAnswer({
  name,
  question,
  answer,
  showJson,
  indentJson,
  choices = annotationChoices(question),
  controlsOnly = false,
}: Pick<NamedQuestion, "name" | "question"> & {
  answer: Answers[string] | undefined;
  showJson?: boolean | undefined;
  indentJson?: boolean | undefined;
  choices?: ReturnType<typeof annotationChoices>;
  controlsOnly?: boolean;
}) {
  const editor = useContext(AnnotationContext);
  const matchingAnswer = answer?.type === question.type ? answer : undefined;
  const keys = new Set(choices.map(({ key }) => key));
  const coversAnswer =
    matchingAnswer?.type === "noul" ||
    ((matchingAnswer?.type === "choice" || matchingAnswer?.type === "score") &&
      Object.keys(matchingAnswer.probabilities).every((key) => keys.has(key)) &&
      (matchingAnswer.type === "score" || keys.has(matchingAnswer.choice)));
  const annotation = editor && choices.length > 0 && (
    <CorrectChoice
      name={name}
      choices={choices}
      editor={editor}
      answer={matchingAnswer}
    />
  );
  const answerView = !controlsOnly &&
    (showJson || !annotation || !coversAnswer) && (
      <AnswerView
        question={question}
        answer={answer}
        showJson={showJson ?? false}
        indentJson={indentJson ?? false}
      />
    );
  if (showJson)
    return (
      <>
        {annotation}
        {answerView}
      </>
    );
  return (
    <>
      {answerView}
      {annotation}
      {!controlsOnly &&
        annotation &&
        coversAnswer &&
        matchingAnswer?.type === "score" && (
          <ScoreAnswerSummary answer={matchingAnswer} />
        )}
    </>
  );
}

function CorrectChoice({
  name,
  choices,
  editor,
  answer,
}: {
  name: string;
  choices: ReturnType<typeof annotationChoices>;
  editor: AnnotationEditor;
  answer: Answers[string] | undefined;
}) {
  const change = editor.changes.get(name);
  const selected = editor.saved.get(name);
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="sr-only">Correct choice for {name}</legend>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Correct choice
        </span>
        {selected !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-5"
            aria-label={`Remove label for ${name}`}
            disabled={change?.pending}
            onClick={() => void editor.save(name, null)}
          >
            Remove label
          </Button>
        )}
      </div>
      <div className="grid gap-1">
        {choices.map(({ key, label }) => {
          const chosen = selected === key;
          const modelChoice =
            (answer?.type === "choice" && answer.choice === key) ||
            (answer?.type === "noul" &&
              (key === "true" ? answer.noul > 0.5 : answer.noul < 0.5));
          const probability =
            answer?.type === "noul"
              ? key === "true"
                ? answer.noul
                : 1 - answer.noul
              : (answer?.type === "choice" || answer?.type === "score") &&
                  Object.hasOwn(answer.probabilities, key)
                ? answer.probabilities[key]
                : undefined;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={chosen}
              disabled={change?.pending || editor.done}
              className={cn(
                "flex min-w-0 items-baseline justify-between gap-2 rounded-md border px-1.5 py-0.5 text-left text-sm enabled:hover:bg-yellow-50 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default",
                modelChoice && "bg-neutral-200 font-semibold",
                chosen
                  ? "border-amber-600"
                  : "border-transparent enabled:hover:border-amber-300",
              )}
              onClick={() => void editor.save(name, key)}
            >
              <span className="min-w-0 grow wrap-anywhere">
                {modelChoice && <span className="sr-only">Model choice: </span>}
                {label}
              </span>
              {probability !== undefined && (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {percent.format(probability)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {change?.pending && (
        <p role="status" className="text-xs text-muted-foreground">
          Saving…
        </p>
      )}
      {change?.error && (
        <p role="alert" className="text-xs text-destructive">
          {change.error === "remove"
            ? "Couldn’t remove the label. Try again."
            : "Couldn’t save. Click the choice to retry."}
        </p>
      )}
    </fieldset>
  );
}
