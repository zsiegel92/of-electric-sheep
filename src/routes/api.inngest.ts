import { createFileRoute } from "@tanstack/react-router";
import { serve } from "inngest/edge";
import { ackUserSignIn } from "@/lib/inngest/functions/ack-user-sign-in";
import { createDecisionPipeline } from "@/lib/inngest/functions/create-decision-pipeline";
import { inngest } from "@/lib/inngest/inngest";

const handler = serve({
  client: inngest,
  functions: [ackUserSignIn, createDecisionPipeline],
});

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      PUT: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
    },
  },
});
