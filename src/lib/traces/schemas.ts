import { z } from "zod";
import {
  systemOneRequest,
  systemOneResponse,
} from "@/lib/system-one/typesafe-api-schemas";

export const decisionObservationName = "decisions.process";

export const traceId = z.string().regex(/^[a-f0-9]{32}$/);

export const tracedSystemOneResponse = systemOneResponse.extend({
  traceId: traceId.optional().describe("ID of the decision trace."),
});

export const traceRecord = z.object({
  pipelineId: z.uuid(),
  traceId,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  model: z.string().nullable(),
  failed: z.boolean(),
  state: systemOneRequest.shape.state.optional(),
  answers: systemOneResponse.shape.answers.optional(),
  usage: systemOneResponse.shape.usage.optional(),
  observabilityUrl: z.url({ protocol: /^https?$/ }).optional(),
  payloadTruncated: z.boolean().optional(),
});

export type TraceRecord = z.output<typeof traceRecord>;
