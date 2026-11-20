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
  type DecisionOptions,
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

type ParsedDecisionRequest = Awaited<
  ReturnType<typeof parseSystemOneMultipartRequest>
>;
type DecisionQuestion = ParsedDecisionRequest["questions"][string];
export type SystemOneCoreIngredients = Omit<ParsedDecisionRequest, "assets"> & {
  assets: ParsedDecisionRequest["assets"] | undefined;
  options: DecisionOptions;
  questionParts: Record<
    string,
    {
      type: DecisionQuestion["type"];
      systemPrompt: DecisionQuestion["instructions"];
      choices: Exclude<DecisionQuestion, { type: "box" }>["criteria"];
    }
  >;
};

async function getSystemOneCoreIngredients(
  input: DecisionInputBody,
  {
    enableImages = false,
    enableLongContext = false,
  }: {
    enableImages?: boolean;
    enableLongContext?: boolean;
  } = {},
): Promise<SystemOneCoreIngredients> {
  const headers: DecisionOptions["headers"] = {};
  if (enableImages) headers[imagesHeader] = "true";
  if (enableLongContext) headers[longContextHeader] = "true";

  const { model, state, questions, assets, ...request } =
    "request" in input ? await parseSystemOneMultipartRequest(input) : input;
  const options: DecisionOptions = { headers };
  const questionParts = Object.fromEntries(
    Object.entries(questions).map(([name, question]) => {
      const { type, instructions: systemPrompt } = question;
      const choices = "criteria" in question ? question.criteria : undefined;
      return [name, { type, systemPrompt, choices }];
    }),
  );
  return {
    model,
    state,
    questions,
    questionParts,
    assets,
    options,
    ...request,
  };
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
  const {
    model,
    state,
    questions,
    questionParts,
    assets,
    options,
    ...request
  } = await getSystemOneCoreIngredients(input, {
    enableImages,
    enableLongContext,
  });
  // TODO:
  // - do a db search with some hashed representation of the core ingredients and some user-aware key for a "pipeline" for this request. If it exits, use the pipline to make the request with a pipeline-specific baseUrl and api key (defaults to the regular one); if not, do inngest.send with an event like decisions/new-pipeline.used, with these core ingredients and the user info in the payload
  // - create a new db entry for the pipeline so that future entries do find and use it
  // - LATER: even when pipline IS found and used, emit an inngest event with a handler with very high debounce (e.g. 30 mins) that queries against the observability backend. We may have to attach user metadata to the requests or otel events or something, not sure if that should happen here or elsewhere, explicitly or in some contextualized way via the otel hook.
  // - LATER LATER: if enough observations and annotated examples (tbd how to drive this and store it), start a fine-tune job via some dream cycle (tbd) and if improvement is attained, save baseurl (and maybe null api key?) for that fine-tuned model. Fine-tuned models should only be reachable from this typescript backend and the logic for using one should only let it be used if the user making the request is the user whose model it is (obviously). Maybe will have to store fine-tuned model assets on something like modal volume idk. Hopefully it's not too crazy to store a bunch of LORAs or something.
  return traceGeneration("system-one.decide", async (generation) => {
    const decision = await typesafeRequest(
      systemOneResponse,
      async (client) => {
        try {
          return await client.systemOne(
            {
              ...request,
              model,
              state,
              questions,
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
            options,
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
