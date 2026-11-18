import { z } from "zod";

export const maxDisplayNameLength = 80;

export const displayName = z.object({
  displayName: z.string().trim().min(1).max(maxDisplayNameLength),
});
