import { z } from "zod";

const id = z.uuid();
const name = z.string().trim().min(1).max(80);

export const apiKeyId = z.object({ id });
export const apiKeyName = z.object({ name });

export const apiKey = z.object({
  id,
  name,
  prefix: z.string(),
  createdAt: z.iso.datetime(),
});

export const createdApiKey = apiKey.extend({
  secret: z
    .string()
    .describe("The full API key. It is returned only at creation."),
});

export const deletedApiKey = z.object({ deleted: z.literal(true) });
