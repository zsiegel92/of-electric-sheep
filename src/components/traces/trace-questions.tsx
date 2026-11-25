import type { ComponentProps } from "react";
import { PipelineQuestions } from "@/components/pipeline-questions";
import { QuestionName } from "@/components/question-name";
import type { Answers, NamedQuestion } from "@/components/question-view";
import { annotationChoices } from "@/lib/traces/annotations";
import { TraceAnswer } from "./trace-annotation";

export function TraceQuestions(
  props: Pick<
    ComponentProps<typeof PipelineQuestions>,
    "questions" | "answers" | "pipelineId" | "showJson"
  >,
) {
  return (
    <PipelineQuestions
      {...props}
      renderAnswer={(question, answer) => (
        <TraceAnswer {...question} answer={answer} />
      )}
      jsonFooter={
        <TraceQuestionAnnotations
          questions={props.questions}
          answers={props.answers}
        />
      }
    />
  );
}

function TraceQuestionAnnotations({
  questions,
  answers,
}: {
  questions: NamedQuestion[];
  answers: Answers | undefined;
}) {
  const items = questions.flatMap((question) => {
    const choices = annotationChoices(question.question);
    return choices.length ? [{ question, choices }] : [];
  });
  if (!items.length) return null;
  return (
    <section
      aria-label="Trace annotations"
      className="grid gap-3 sm:grid-cols-2"
    >
      {items.map(({ question, choices }) => (
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
            choices={choices}
            answer={
              answers && Object.hasOwn(answers, question.name)
                ? answers[question.name]
                : undefined
            }
          />
        </div>
      ))}
    </section>
  );
}
