import type { z } from "zod";
import { decisionOptionsSchema } from "@/lib/system-one/type-helpers";
import { systemOneRequest } from "@/lib/system-one/typesafe-api-schemas";

// State and image bytes are inputs to a pipeline, not part of its identity.
export const pipelineDefinitionSchema = systemOneRequest
  .pick({ model: true, questions: true })
  .extend({ options: decisionOptionsSchema });

export type PipelineDefinition = z.output<typeof pipelineDefinitionSchema>;

export type PipelineQuestion = {
  name: string;
  alias: string | null;
  answerShape: string;
  primaryName: string | null;
  question: PipelineDefinition["questions"][string];
};

export type PipelineVersion = {
  id: string;
  primaryGroupedPipelineId: string;
  displayName: string | null;
  uiIgnored: boolean;
  baseUrl: string | null;
  createdAt: string;
  model: string | null;
  options: PipelineDefinition["options"] | null;
  questions: PipelineQuestion[];
};

export function pipelineQuestionRecord(
  questions: readonly Pick<PipelineQuestion, "name" | "question">[],
): PipelineDefinition["questions"] {
  return Object.fromEntries(
    questions.map(({ name, question }) => [name, question]),
  );
}
