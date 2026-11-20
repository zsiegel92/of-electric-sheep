import type { z } from "zod";
import { decisionOptionsSchema } from "@/lib/system-one/type-helpers";
import { systemOneRequest } from "@/lib/system-one/typesafe-api-schemas";

// State and image bytes are inputs to a pipeline, not part of its identity.
export const pipelineDefinitionSchema = systemOneRequest
  .pick({ model: true, questions: true })
  .extend({ options: decisionOptionsSchema });

export type PipelineDefinition = z.output<typeof pipelineDefinitionSchema>;
