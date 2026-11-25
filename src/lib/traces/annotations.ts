import type { PipelineQuestion } from "@/lib/decisions/pipeline-schemas";

export type TraceAnnotation = { questionName: string; choiceKey: string };

export function annotationChoices(question: PipelineQuestion["question"]) {
  switch (question.type) {
    case "noul":
      return [
        { key: "true", label: "Yes" },
        { key: "false", label: "No" },
      ];
    case "choice":
      return Object.keys(question.criteria)
        .sort()
        .map((key) => ({ key, label: key }));
    case "score":
      return question.criteria.map((_, level) => ({
        key: String(level),
        label: `Score ${level}`,
      }));
    case "box":
      return [];
  }
}
