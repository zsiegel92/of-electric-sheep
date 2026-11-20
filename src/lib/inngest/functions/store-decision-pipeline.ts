import { newPipelineUsed } from "@/lib/decisions/events";
import { saveDecisionPipelineDefinition } from "@/lib/decisions/queries";
import { inngest } from "@/lib/inngest/inngest";

export const storeDecisionPipeline = inngest.createFunction(
  { id: "store-decision-pipeline", triggers: [newPipelineUsed] },
  ({ event, step }) => {
    const { pipelineId, user, definition } = event.data;
    return step.run("store-definition", () =>
      saveDecisionPipelineDefinition(pipelineId, user.githubId, definition),
    );
  },
);
