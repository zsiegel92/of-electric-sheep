import { eventType } from "inngest";
import { z } from "zod";
import { userSchema } from "@/lib/auth";
import { systemOneRequest } from "@/lib/system-one/typesafe-api-schemas";
import { traceRecord } from "@/lib/traces/schemas";
import { pipelineDefinitionSchema } from "./pipeline-schemas";

const pipelineUsageSchema = z.object({
  pipelineId: z.uuid(),
  user: userSchema,
  definition: pipelineDefinitionSchema,
  state: systemOneRequest.shape.state,
});

export type PipelineUsage = z.output<typeof pipelineUsageSchema>;

export const newPipelineUsed = eventType("decisions/new-pipeline.used", {
  schema: pipelineUsageSchema,
});

export const pipelineUsed = eventType("decisions/pipeline.used", {
  schema: pipelineUsageSchema,
});

export const decisionTraceCompleted = eventType("decisions/trace.completed", {
  schema: traceRecord,
});
