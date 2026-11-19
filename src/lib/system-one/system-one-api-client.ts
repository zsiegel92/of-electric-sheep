import "@tanstack/react-start/server-only";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { traceGeneration } from "@/lib/langfuse";
import type { SystemOneRouteBuilder } from "@/server/system-one/router";
import { systemOneRoutes } from "./routes";
import {
  badRequest,
  type DecisionInputBody,
  decisionInput,
  decisionRequestBody,
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
  const env = typesafeEnv.safeParse(process.env);
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
  path: "v1/models" | "v1/systemone",
  schema: T,
  options: RequestInit,
): Promise<z.output<T>> {
  const { baseUrl, apiKey } = getTypeSafeBaseUrlAndApiKey();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");

  let response: Response;
  let data: unknown;
  try {
    response = await fetch(
      new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`),
      {
        ...options,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(55_000),
      },
    );
    if (response.status === 429) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: typesafeErrors.TOO_MANY_REQUESTS.message,
      });
    }
    data = await response.json();
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    throw new ORPCError("BAD_GATEWAY", {
      message: typesafeErrors.BAD_GATEWAY.message,
    });
  }

  if (response.status === 400) {
    const result = badRequest.safeParse(data);
    if (result.success)
      throw new ORPCError("BAD_REQUEST", { data: result.data });
  }
  if (response.status === 422) {
    const result = validationError.safeParse(data);
    if (result.success)
      throw new ORPCError("UNPROCESSABLE_CONTENT", { data: result.data });
  }
  if (response.ok) {
    const result = schema.safeParse(data);
    if (result.success) return result.data;
  }
  throw new ORPCError("BAD_GATEWAY", {
    message: typesafeErrors.BAD_GATEWAY.message,
  });
}

export function listModels() {
  return typesafeRequest("v1/models", modelList, { method: "GET" });
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
  const headers = new Headers();
  if (enableImages) headers.set(imagesHeader, "true");
  if (enableLongContext) headers.set(longContextHeader, "true");

  const body =
    "request" in input
      ? await parseSystemOneMultipartRequest(input)
      : JSON.stringify(input);
  if (typeof body === "string") headers.set("Content-Type", "application/json");
  return traceGeneration("system-one.decide", async (generation) => {
    const decision = await typesafeRequest("v1/systemone", systemOneResponse, {
      method: "POST",
      headers,
      body,
    });
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

export function createDecisionRoute(route: SystemOneRouteBuilder) {
  return route({
    ...systemOneRoutes.decide,
    summary: "Evaluate content with System One",
    description:
      "Ask named yes/no, choice, score, or box questions about shared content. Mix question types in one request. Requires an API key created in OfElectricSheep.",
    inputStructure: "detailed",
    requestBody: decisionRequestBody,
  })
    .input(decisionInput)
    .output(systemOneResponse)
    .handler(({ input: { body, headers } }) =>
      runDecision(body, {
        enableImages: headers[imagesHeader] === "true",
        enableLongContext: headers[longContextHeader] === "true",
      }),
    );
}
