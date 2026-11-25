import { z } from "zod";
import {
  type PipelineVersion,
  pipelineDefinitionSchema,
  pipelineQuestionRecord,
} from "./pipeline-schemas";

export const pipelineDraftSchema = pipelineDefinitionSchema
  .extend({
    displayName: z.string().trim().max(100).nullable(),
    baseUrl: z.url({ protocol: /^https?$/ }).nullable(),
    uiIgnored: z.boolean(),
  })
  .strict();

export type PipelineDraft = z.output<typeof pipelineDraftSchema>;

export type PipelineSnapshot = Omit<PipelineDraft, "model" | "options"> &
  Pick<PipelineVersion, "model" | "options">;

export function pipelineSnapshot(version: PipelineVersion): PipelineSnapshot {
  return {
    displayName: version.displayName,
    model: version.model,
    baseUrl: version.baseUrl,
    options: version.options,
    uiIgnored: version.uiIgnored,
    questions: pipelineQuestionRecord(version.questions),
  };
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function pipelineExecutionKey({
  baseUrl,
  model,
  options,
  questions,
}: {
  baseUrl: PipelineDraft["baseUrl"];
  model: PipelineDraft["model"] | null;
  options: PipelineDraft["options"];
  questions: PipelineDraft["questions"];
}) {
  return JSON.stringify(canonicalize({ baseUrl, model, options, questions }));
}
