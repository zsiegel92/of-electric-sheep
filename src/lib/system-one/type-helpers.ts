import { z } from "zod";

export const imagesHeader = "typesafe-danger-zone-images";
export const longContextHeader = "typesafe-danger-zone-long-context";
export const exactPipelineHeader = "x-use-exact-pipeline";

export const decisionOptionsSchema = z.object({
  headers: z.object({
    [imagesHeader]: z.literal("true").exactOptional(),
    [longContextHeader]: z.literal("true").exactOptional(),
  }),
});
