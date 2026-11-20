import { newPipelineUsed } from "@/lib/decisions/events";
import { ensureDecisionPipeline } from "@/lib/decisions/queries";
import { inngest } from "@/lib/inngest/inngest";

export const createDecisionPipeline = inngest.createFunction(
  { id: "create-decision-pipeline", triggers: [newPipelineUsed] },
  async ({ event, step }) =>
    step.run("ensure-decision-pipeline", () =>
      ensureDecisionPipeline(event.data.user, event.data.definition),
    ),
);
