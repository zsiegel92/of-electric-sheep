import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PipelineQuestion } from "@/lib/decisions/question-links";
import { getPipelineQuestions, updateQuestionAlias } from "@/server/pipelines";
import { EditableName } from "./editable-name";

const questionQueryKey = (pipelineId: string) => [
  "pipeline-questions",
  pipelineId,
];

export function usePipelineQuestions(
  pipelineId: string,
  initialData?: PipelineQuestion[],
  enabled = true,
) {
  return useQuery({
    queryKey: questionQueryKey(pipelineId),
    queryFn: () => getPipelineQuestions({ data: pipelineId }),
    initialData,
    enabled,
    retry: false,
  });
}

export function QuestionName({
  name,
  alias,
  pipelineId,
}: {
  name: string;
  alias: string | null;
  pipelineId?: string | undefined;
}) {
  const queryClient = useQueryClient();
  const label = (
    <span className="min-w-0 wrap-anywhere">
      <span className={alias ? "font-medium" : "font-mono font-medium"}>
        {alias ?? name}
      </span>
      {alias && alias !== name && (
        <span className="ml-1.5 font-mono text-xs text-muted-foreground">
          {name}
        </span>
      )}
    </span>
  );
  if (!pipelineId) return label;

  const update = async (alias: string | null) => {
    const saved = await updateQuestionAlias({
      data: { pipelineId, questionName: name, alias },
    });
    const key = questionQueryKey(pipelineId);
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<PipelineQuestion[]>(key, (questions) =>
      questions?.map((question) =>
        question.name === name ? { ...question, alias: saved } : question,
      ),
    );
  };
  return (
    <EditableName
      value={alias}
      label={`Alias for ${name}`}
      editLabel={`Edit alias for ${name}`}
      placeholder={name}
      onSave={update}
      onRemove={() => update(null)}
    >
      {label}
    </EditableName>
  );
}
