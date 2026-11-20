import { eventType } from "inngest";
import { z } from "zod";
import { userSchema } from "@/lib/auth";
import { systemOneRequest } from "@/lib/system-one/typesafe-api-schemas";
import { pipelineDefinitionSchema } from "./pipeline-schemas";

const pipelineUsageSchema = z.object({
  pipelineId: z.uuid(),
  user: userSchema,
  definition: pipelineDefinitionSchema,
  state: systemOneRequest.shape.state,
});

export const newPipelineUsed = eventType("decisions/new-pipeline.used", {
  schema: pipelineUsageSchema,
});

export const pipelineUsed = eventType("decisions/pipeline.used", {
  schema: pipelineUsageSchema,
});
