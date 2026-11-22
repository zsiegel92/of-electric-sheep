import { decisionTraceCompleted } from "@/lib/decisions/events";
import { inngest } from "@/lib/inngest/inngest";
import { storeTrace } from "@/lib/traces/queries";

export const storeDecisionTrace = inngest.createFunction(
  { id: "store-decision-trace", triggers: [decisionTraceCompleted] },
  ({ event, step }) => step.run("store-trace", () => storeTrace(event.data)),
);
