import "@tanstack/react-start/server-only";
import type { User } from "@/lib/auth";
import { inngest } from "@/lib/inngest/inngest";
import { runDecision } from "@/lib/system-one/system-one-api-client";
import {
  type DecisionCapabilities,
  type DecisionInputBody,
  getSystemOneCoreIngredients,
} from "@/lib/system-one/type-helpers";
import { newPipelineUsed, pipelineUsed } from "./events";
import { hashPipelineDefinition } from "./pipeline-key";
import { pipelineDefinitionSchema } from "./pipeline-schemas";
import { findDecisionPipeline } from "./queries";

export async function processDecision(
  input: DecisionInputBody,
  user: User,
  capabilities: DecisionCapabilities = {},
): ReturnType<typeof runDecision> {
  const ingredients = await getSystemOneCoreIngredients(input, capabilities);
  const definition = pipelineDefinitionSchema.parse(ingredients);
  const definitionHash = hashPipelineDefinition(definition);
  const pipeline = await findDecisionPipeline(user, definitionHash);
  if (pipeline) {
    await inngest.send(
      pipelineUsed.create({
        pipelineId: pipeline.id,
        user,
        definition,
        state: ingredients.state,
      }),
    );
  } else {
    await inngest.send(
      newPipelineUsed.create({ user, definition, state: ingredients.state }),
    );
  }

  // TODO:
  // 2
  // - LATER: even when pipline IS found and used, emit an inngest event with a handler with very high debounce (e.g. 30 mins) that queries against the observability backend. We may have to attach user metadata to the requests or otel events or something, not sure if that should happen here or elsewhere, explicitly or in some contextualized way via the otel hook.
  // 3
  // - LATER LATER: if enough observations and annotated examples (tbd how to drive this and store it), start a fine-tune job via some dream cycle (tbd) and if improvement is attained, save baseurl (and maybe null api key?) for that fine-tuned model. Fine-tuned models should only be reachable from this typescript backend and the logic for using one should only let it be used if the user making the request is the user whose model it is (obviously). Maybe will have to store fine-tuned model assets on something like modal volume idk. Hopefully it's not too crazy to store a bunch of LORAs or something.
  return runDecision(ingredients, { baseUrl: pipeline?.baseUrl ?? null });
}
