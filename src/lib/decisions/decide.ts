import "@tanstack/react-start/server-only";
import type { User } from "@/lib/auth";
import { inngest } from "@/lib/inngest/inngest";
import { traceGeneration } from "@/lib/langfuse/tracing";
import { runDecision } from "@/lib/system-one/system-one-api-client";
import {
  type DecisionCapabilities,
  type DecisionInputBody,
  getSystemOneCoreIngredients,
  toSystemOneTraceInput,
} from "@/lib/system-one/type-helpers";
import { newPipelineUsed, pipelineUsed } from "./events";
import { pipelineDefinitionSchema } from "./pipeline-schemas";
import { ensureDecisionPipeline } from "./queries";

export async function processDecision(
  input: DecisionInputBody,
  user: User,
  capabilities: DecisionCapabilities = {},
): ReturnType<typeof runDecision> {
  const ingredients = await getSystemOneCoreIngredients(input, capabilities);
  const definition = pipelineDefinitionSchema.parse(ingredients);
  const { pipeline, wasCreated } = await ensureDecisionPipeline(
    user,
    definition,
  );

  // TODO:
  // 2
  // - LATER: even when pipline IS found and used, emit an inngest event with a handler with very high debounce (e.g. 30 mins) that queries against the observability backend. We may have to attach user metadata to the requests or otel events or something, not sure if that should happen here or elsewhere, explicitly or in some contextualized way via the otel hook.
  // 3
  // - LATER LATER: if enough observations and annotated examples (tbd how to drive this and store it), start a fine-tune job via some dream cycle (tbd) and if improvement is attained, save baseurl (and maybe null api key?) for that fine-tuned model. Fine-tuned models should only be reachable from this typescript backend and the logic for using one should only let it be used if the user making the request is the user whose model it is (obviously). Maybe will have to store fine-tuned model assets on something like modal volume idk. Hopefully it's not too crazy to store a bunch of LORAs or something.
  return traceGeneration(
    "decisions.process",
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
      await inngest.send([
        ...(wasCreated ? [newPipelineUsed.create(usage)] : []),
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
