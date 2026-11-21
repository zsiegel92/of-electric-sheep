import { z } from "zod";
import { pipelineDefinitionSchema } from "./pipeline-schemas";

export const pipelineDraftSchema = pipelineDefinitionSchema
  .extend({
    displayName: z.string().trim().max(100).nullable(),
    baseUrl: z.url({ protocol: /^https?$/ }).nullable(),
    uiIgnored: z.boolean(),
  })
  .strict();

export type PipelineDraft = z.output<typeof pipelineDraftSchema>;
