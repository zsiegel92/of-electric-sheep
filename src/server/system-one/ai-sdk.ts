import "@tanstack/react-start/server-only";
import {
  type Experimental_DecisionAnswer,
  type Experimental_DecisionQuestion,
  type Experimental_DecisionResult,
  experimental_decide,
} from "ai";
import { z } from "zod";
import { type answer, scoreLegend, systemOneResponse } from "./schemas";

type DecisionOptions = Parameters<typeof experimental_decide>[0];
type DecisionResult = Experimental_DecisionResult<
  Record<string, Experimental_DecisionQuestion>
>;
type SystemOneAnswer = z.output<typeof answer>;
type SystemOneResponse = z.output<typeof systemOneResponse>;

const typesafeMetadata = z.object({
  confidence: z.record(z.string(), z.number()).optional(),
  legend: z.record(z.string(), scoreLegend).optional(),
});

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`Decision result is missing ${field}`);
  }
  return value;
}

function toSystemOneAnswer(
  input: Experimental_DecisionAnswer<Experimental_DecisionQuestion>,
  name: string,
  metadata: z.output<typeof typesafeMetadata>,
): SystemOneAnswer {
  const confidence = metadata.confidence?.[name];
  switch (input.type) {
    case "boolean":
      return { type: "noul", noul: input.probability };
    case "choice":
      return {
        type: "choice",
        choice: input.choice,
        confidence: required(confidence, `${name}.confidence`),
        probabilities: required(input.probabilities, `${name}.probabilities`),
      };
    case "score":
      return {
        type: "score",
        score: input.score,
        confidence: required(confidence, `${name}.confidence`),
        legend: required(metadata.legend?.[name], `${name}.legend`),
        probabilities: required(input.probabilities, `${name}.probabilities`),
      };
    case "box":
      return { type: "box", box: input.box, confidence: confidence ?? null };
  }
}

export function toSystemOneResponse(result: DecisionResult): SystemOneResponse {
  const { typesafe = {} } = result.providerMetadata ?? {};
  const metadata = typesafeMetadata.parse(typesafe);
  const response = {
    model: result.response.modelId,
    answers: Object.fromEntries(
      Object.entries(result.answers).map(([name, value]) => [
        name,
        toSystemOneAnswer(value, name, metadata),
      ]),
    ),
    usage: {
      input_tokens: required(result.usage.inputTokens, "usage.inputTokens"),
      output_tokens: required(result.usage.outputTokens, "usage.outputTokens"),
    },
  } satisfies SystemOneResponse;
  return systemOneResponse.parse(response);
}

export async function decideWithAiSdk(
  options: DecisionOptions,
): Promise<SystemOneResponse> {
  return toSystemOneResponse(await experimental_decide(options));
}
