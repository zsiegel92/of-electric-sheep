import "@tanstack/react-start/server-only";
import { ORPCError } from "@orpc/server";
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  Image,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import { z } from "zod";
import { traceGeneration } from "@/lib/langfuse";
import {
  badRequest,
  type DecisionInputBody,
  imagesHeader,
  longContextHeader,
  modelList,
  parseSystemOneMultipartRequest,
  systemOneResponse,
  typesafeErrors,
  validationError,
} from "./schemas";

const typesafeEnv = z.object({
  TYPESAFE_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .default("https://api.typesafe.ai"),
  TYPESAFE_API_KEY: z.string().trim().min(1),
});

function getTypeSafeBaseUrlAndApiKey() {
  const env = typesafeEnv.safeParse({
    TYPESAFE_BASE_URL: process.env["TYPESAFE_BASE_URL"],
    TYPESAFE_API_KEY: process.env["TYPESAFE_API_KEY"],
  });
  if (!env.success)
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: typesafeErrors.SERVICE_UNAVAILABLE.message,
    });

  return {
    baseUrl: env.data.TYPESAFE_BASE_URL,
    apiKey: env.data.TYPESAFE_API_KEY,
  };
}

async function typesafeRequest<T extends z.ZodType>(
  schema: T,
  run: (client: TypeSafeClient) => Promise<unknown>,
): Promise<z.output<T>> {
  const { baseUrl, apiKey } = getTypeSafeBaseUrlAndApiKey();
  const client = new TypeSafeClient({
    baseURL: baseUrl,
    apiKey,
    timeout: 55_000,
    retry: { maxRetries: 0 },
    logLevel: "off",
    compression: false,
    fetch: (url, options) => fetch(url, { ...options, redirect: "error" }),
  });

  try {
    const result = schema.safeParse(await run(client));
    if (result.success) return result.data;
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    if (error instanceof APIError) {
      if (error.status === 429) {
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: typesafeErrors.TOO_MANY_REQUESTS.message,
        });
      }
      if (error.status === 400) {
        const result = badRequest.safeParse(error.body);
        if (result.success)
          throw new ORPCError("BAD_REQUEST", { data: result.data });
      }
      if (error.status === 422) {
        const result = validationError.safeParse(error.body);
        if (result.success)
          throw new ORPCError("UNPROCESSABLE_CONTENT", { data: result.data });
      }
    }
  }
  throw new ORPCError("BAD_GATEWAY", {
    message: typesafeErrors.BAD_GATEWAY.message,
  });
}

export function listModels() {
  return typesafeRequest(modelList, async (client) => ({
    models: await client.models.list(),
  }));
}

export async function runDecision(
  input: DecisionInputBody,
  {
    enableImages = false,
    enableLongContext = false,
  }: {
    enableImages?: boolean;
    enableLongContext?: boolean;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (enableImages) headers[imagesHeader] = "true";
  if (enableLongContext) headers[longContextHeader] = "true";

  const { assets, ...request } =
    "request" in input ? await parseSystemOneMultipartRequest(input) : input;
  return traceGeneration("system-one.decide", async (generation) => {
    const decision = await typesafeRequest(
      systemOneResponse,
      async (client) => {
        try {
          return await client.systemOne(
            {
              ...request,
              ...(assets && {
                assets: Object.fromEntries(
                  Object.entries(assets).map(([name, asset]) => [
                    name,
                    asset instanceof File
                      ? new Image(asset)
                      : Image.fromBase64(asset.data_base64),
                  ]),
                ),
              }),
            },
            { headers },
          );
        } catch (error) {
          if (
            error instanceof TypeSafeError &&
            !(
              error instanceof APIError ||
              error instanceof APIConnectionError ||
              error instanceof APIUserAbortError
            )
          ) {
            throw new ORPCError("BAD_REQUEST", {
              data: { detail: error.message },
            });
          }
          throw error;
        }
      },
    );
    generation?.update({
      model: decision.model,
      usageDetails: {
        input: decision.usage.input_tokens,
        output: decision.usage.output_tokens,
      },
    });
    return decision;
  });
}
