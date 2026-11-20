import "@tanstack/react-start/server-only";
import { runDecision } from "@/lib/system-one/system-one-api-client";
import type {
  DecisionCapabilities,
  DecisionInputBody,
} from "@/lib/system-one/type-helpers";

export function processDecision(
  input: DecisionInputBody,
  capabilities: DecisionCapabilities = {},
): ReturnType<typeof runDecision> {
  // TODO:
  // - do a db search with some hashed representation of the core ingredients and some user-aware key for a "pipeline" for this request. If it exits, use the pipline to make the request with a pipeline-specific baseUrl and api key (defaults to the regular one); if not, do inngest.send with an event like decisions/new-pipeline.used, with these core ingredients and the user info in the payload
  // - create a new db entry for the pipeline so that future entries do find and use it
  // - LATER: even when pipline IS found and used, emit an inngest event with a handler with very high debounce (e.g. 30 mins) that queries against the observability backend. We may have to attach user metadata to the requests or otel events or something, not sure if that should happen here or elsewhere, explicitly or in some contextualized way via the otel hook.
  // - LATER LATER: if enough observations and annotated examples (tbd how to drive this and store it), start a fine-tune job via some dream cycle (tbd) and if improvement is attained, save baseurl (and maybe null api key?) for that fine-tuned model. Fine-tuned models should only be reachable from this typescript backend and the logic for using one should only let it be used if the user making the request is the user whose model it is (obviously). Maybe will have to store fine-tuned model assets on something like modal volume idk. Hopefully it's not too crazy to store a bunch of LORAs or something.
  return runDecision(input, capabilities);
}
