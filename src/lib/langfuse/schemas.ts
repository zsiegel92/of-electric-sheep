import { z } from "zod";

export const langfuseConfig = z.object({
  baseUrl: z.url({ protocol: /^https?$/ }),
  publicKey: z.string().trim().min(1),
  secretKey: z.string().trim().min(1),
});

const observationContent = z
  .string()
  .nullable()
  .transform((value): unknown => {
    if (value === null) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  });

export const decisionObservationName = "decisions.process";
export const traceId = z.string().regex(/^[a-f0-9]{32}$/);

export const observation = z.looseObject({
  id: z.string(),
  traceId: z.string(),
  type: z.string(),
  name: z.string().nullable(),
  startTime: z.iso.datetime({ offset: true }),
  projectId: z.string().optional(),
  level: z.string().nullish(),
  model: z.string().nullish(),
  input: observationContent.optional(),
  output: observationContent.optional(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const observationPage = z.object({
  data: z.array(observation),
  meta: z.object({ cursor: z.string().nullish() }),
});
