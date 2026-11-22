import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { User } from "@/lib/auth";
import { inngest } from "@/lib/inngest/inngest";
import { getObservabilityUrl } from "@/lib/langfuse/links";
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
import {
  decisionObservationName,
  type TraceRecord,
} from "@/lib/traces/schemas";
import {
  decisionTraceCompleted,
  newPipelineUsed,
  type PipelineUsage,
  pipelineUsed,
} from "./events";
import {
  type PipelineDefinition,
  pipelineDefinitionSchema,
} from "./pipeline-schemas";
import { ensureDecisionPipeline, findPipelineVersions } from "./queries";
import { matchQuestions, type PipelineVersion } from "./question-links";

// Leave room for the event envelope on Inngest plans with a 256 KiB limit.
const TRACE_EVENT_BUDGET_BYTES = 255 * 1024;

function tracePayloadFitsInEventBudget(
  payload: ReturnType<typeof decisionTraceCompleted.create>,
) {
  return Buffer.byteLength(JSON.stringify(payload)) <= TRACE_EVENT_BUDGET_BYTES;
}

export async function processDecision(
  input: DecisionInputBody,
  user: User,
  capabilities: DecisionCapabilities = {},
  exact = false,
): ReturnType<typeof runPipeline> {
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
    const { decision } = await runStoredVersion(
      version,
      primary,
      ingredients,
      user,
    );
    return decision;
  }
  return runPipeline(ingredients, user, pipeline, definition);
}

async function runPipeline(
  ingredients: SystemOneCoreIngredients,
  user: User,
  pipeline: { id: string; baseUrl: string | null; hasDefinition: boolean },
  definition: PipelineDefinition,
): Promise<Awaited<ReturnType<typeof runDecision>> & { traceId: string }> {
  const traceId = randomBytes(16).toString("hex");
  const trace = {
    pipelineId: pipeline.id,
    traceId,
    startedAt: new Date().toISOString(),
    state: ingredients.state,
  } satisfies Pick<
    TraceRecord,
    "pipelineId" | "traceId" | "startedAt" | "state"
  >;
  let observabilityUrl: string | undefined;
  let decision: Awaited<ReturnType<typeof runDecision>>;
  try {
    decision = await traceGeneration(
      decisionObservationName,
      { pipelineId: pipeline.id, decisionTraceId: traceId },
      async (generation) => {
        if (generation) {
          observabilityUrl = getObservabilityUrl(generation.traceId);
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
        } satisfies PipelineUsage;
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
  } catch (error) {
    await publishTrace({
      ...trace,
      model: ingredients.model,
      failed: true,
      observabilityUrl,
    }).catch((publishError) => {
      console.error(
        "Could not publish failed decision trace",
        traceId,
        publishError,
      );
    });
    throw error;
  }
  await publishTrace({
    ...trace,
    ...decision,
    failed: false,
    observabilityUrl,
  });
  return { ...decision, traceId };
}

async function publishTrace(record: TraceRecord) {
  const event = (data: TraceRecord) =>
    decisionTraceCompleted.create(data, {
      id: `decision-trace-${record.traceId}`,
    });
  const data = {
    ...record,
    endedAt: new Date().toISOString(),
  } satisfies TraceRecord;
  const full = event(data);
  if (tracePayloadFitsInEventBudget(full)) {
    await inngest.send(full);
    return;
  }
  const summary = { ...data, payloadTruncated: true };
  const withoutState = event({ ...summary, state: undefined });
  const withoutAnswers = event({ ...summary, answers: undefined });
  await inngest.send(
    tracePayloadFitsInEventBudget(withoutState)
      ? withoutState
      : tracePayloadFitsInEventBudget(withoutAnswers)
        ? withoutAnswers
        : event({ ...summary, state: undefined, answers: undefined }),
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
  const decision = links
    ? {
        ...result,
        answers: Object.fromEntries(
          version.questions.map(({ name, question }) => {
            const primaryName = links.get(name);
            const answer =
              primaryName === undefined
                ? undefined
                : result.answers[primaryName];
            if (answer?.type !== question.type)
              throw new ORPCError("BAD_GATEWAY", {
                message: "TypeSafe returned an unexpected answer",
              });
            return [name, answer];
          }),
        ),
      }
    : result;
  return { decision, pipelineId: primary.id, links };
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
