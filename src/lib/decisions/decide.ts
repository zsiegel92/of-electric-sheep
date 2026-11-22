import "@tanstack/react-start/server-only";
import { ORPCError } from "@orpc/server";
import type { User } from "@/lib/auth";
import { inngest } from "@/lib/inngest/inngest";
import { decisionObservationName } from "@/lib/langfuse/schemas";
import { traceGeneration } from "@/lib/langfuse/tracing";
import { runDecision } from "@/lib/system-one/system-one-api-client";
import {
  type DecisionCapabilities,
  type DecisionInputBody,
  getSystemOneCoreIngredients,
  imagesHeader,
  longContextHeader,
  type SystemOneCoreIngredients,
  toSystemOneTraceInput,
} from "@/lib/system-one/type-helpers";
import { newPipelineUsed, pipelineUsed } from "./events";
import {
  type PipelineDefinition,
  pipelineDefinitionSchema,
} from "./pipeline-schemas";
import { ensureDecisionPipeline, findPipelineVersions } from "./queries";
import { matchQuestions, type PipelineVersion } from "./question-links";

export async function processDecision(
  input: DecisionInputBody,
  user: User,
  capabilities: DecisionCapabilities = {},
  exact = false,
): ReturnType<typeof runDecision> {
  const ingredients = await getSystemOneCoreIngredients(input, capabilities);
  const definition = pipelineDefinitionSchema.parse(ingredients);
  const { pipeline } = await ensureDecisionPipeline(user, definition);
  if (!exact && pipeline.primaryGroupedPipelineId !== pipeline.id) {
    const { version, primary } = await findPipelineVersions(
      user.githubId,
      pipeline.id,
    );
    if (!version || !primary?.options || !version.options) {
      throw new ORPCError("NOT_FOUND", {
        message: "Pipeline definition is not ready",
      });
    }
    return runStoredVersion(version, primary, ingredients, user);
  }
  return runPipeline(ingredients, user, pipeline, definition);
}

function runPipeline(
  ingredients: SystemOneCoreIngredients,
  user: User,
  pipeline: { id: string; baseUrl: string | null; hasDefinition: boolean },
  definition: PipelineDefinition,
) {
  return traceGeneration(
    decisionObservationName,
    { pipelineId: pipeline.id },
    async (generation) => {
      if (generation) {
        generation.update({
          model: ingredients.model,
          input: await toSystemOneTraceInput(ingredients),
        });
      }
      const usage = {
        pipelineId: pipeline.id,
        user,
        definition,
        state: ingredients.state,
      };
      // Republish pending definitions with a stable ID so a failed send can be retried.
      await inngest.send([
        ...(!pipeline.hasDefinition
          ? [
              newPipelineUsed.create(usage, {
                id: `new-pipeline-${pipeline.id}`,
              }),
            ]
          : []),
        pipelineUsed.create(usage),
      ]);
      const decision = await runDecision(ingredients, {
        baseUrl: pipeline.baseUrl,
      });
      generation?.update({
        model: decision.model,
        usageDetails: {
          input: decision.usage.input_tokens,
          output: decision.usage.output_tokens,
        },
      });
      return decision;
    },
  );
}

async function runStoredVersion(
  version: PipelineVersion,
  primary: PipelineVersion,
  { state, assets }: Pick<SystemOneCoreIngredients, "state" | "assets">,
  user: User,
) {
  const sameVersion = version.id === primary.id;
  const links = sameVersion ? undefined : matchQuestions(version, primary);
  if (
    links &&
    (links.size !== version.questions.length ||
      links.size !== primary.questions.length)
  ) {
    throw new ORPCError("CONFLICT", {
      message: "Pipeline versions need compatible question links",
    });
  }
  const definition = pipelineDefinitionSchema.parse({
    model: primary.model,
    questions: Object.fromEntries(
      primary.questions.map(({ name, question }) => [name, question]),
    ),
    options: primary.options,
  });
  const { model, questions, options } = definition;
  const ingredients = await getSystemOneCoreIngredients(
    { model, questions, state },
    {
      enableImages: options.headers[imagesHeader] === "true",
      enableLongContext: options.headers[longContextHeader] === "true",
    },
  );
  const result = await runPipeline(
    { ...ingredients, assets },
    user,
    { id: primary.id, baseUrl: primary.baseUrl, hasDefinition: true },
    definition,
  );
  if (!links) return result;

  return {
    ...result,
    answers: Object.fromEntries(
      version.questions.map(({ name, question }) => {
        const primaryName = links.get(name);
        const answer =
          primaryName === undefined ? undefined : result.answers[primaryName];
        if (answer?.type !== question.type)
          throw new ORPCError("BAD_GATEWAY", {
            message: "TypeSafe returned an unexpected answer",
          });
        return [name, answer];
      }),
    ),
  };
}

export async function processStoredDecision(
  pipelineId: string,
  state: SystemOneCoreIngredients["state"],
  user: User,
  exact = false,
) {
  const { version, primary } = await findPipelineVersions(
    user.githubId,
    pipelineId,
    exact,
  );
  if (!version?.options || !primary?.options) return;
  return runStoredVersion(version, primary, { state, assets: undefined }, user);
}
