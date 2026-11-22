import "@tanstack/react-start/server-only";
import { type AnyProcedure, os } from "@orpc/server";
import { z } from "zod";
import { findApiKeyUser } from "@/lib/api-keys/queries";
import type { User } from "@/lib/auth";
import { processDecision, processStoredDecision } from "@/lib/decisions/decide";
import { listModels } from "@/lib/system-one/system-one-api-client";
import {
  decisionInput,
  decisionRequestBody,
  exactPipelineHeader,
  imagesHeader,
  longContextHeader,
  pipelineRoutingHeaders,
  typesafeErrors,
} from "@/lib/system-one/type-helpers";
import {
  modelList,
  systemOneRequest,
  tracedSystemOneResponse,
} from "@/lib/system-one/typesafe-api-schemas";
import { routeGroup } from "../route-group";
import { systemOneRoutes } from "./routes";

export const systemOneTag = "System One · TypeSafe";

const apiKeyAuth = os
  .$context<{ headers: Headers }>()
  .errors({
    ...typesafeErrors,
    CONFLICT: { message: "Pipeline versions need compatible question links" },
    NOT_FOUND: { message: "Decision pipeline not found" },
    UNAUTHORIZED: { message: "An active API key is required" },
  })
  .use(async ({ context, errors, next }) => {
    const user = await findApiKeyUser(context.headers);
    if (!user) throw errors.UNAUTHORIZED();
    return next({ context: { user } });
  });

const route = routeGroup(os.$context<{ user: User }>(), {
  tag: systemOneTag,
  security: [{ ApiKey: [] }],
});

export const systemOneRouter = apiKeyAuth.router({
  models: route({
    ...systemOneRoutes.models,
    summary: "List models",
    description:
      "List Jev models and aliases available to the configured TypeSafe account.",
  })
    .output(modelList)
    .handler(listModels),

  decide: route({
    ...systemOneRoutes.decide,
    summary: "Evaluate content with System One",
    description:
      "Ask named yes/no, choice, score, or box questions about shared content. Mix question types in one request. Requires an API key created in OfElectricSheep.",
    inputStructure: "detailed",
    requestBody: decisionRequestBody,
  })
    .input(decisionInput)
    .output(tracedSystemOneResponse)
    .handler(({ input: { body, headers }, context: { user } }) =>
      processDecision(
        body,
        user,
        {
          enableImages: headers[imagesHeader] === "true",
          enableLongContext: headers[longContextHeader] === "true",
        },
        headers[exactPipelineHeader] === "true",
      ),
    ),

  decideByPipeline: route({
    ...systemOneRoutes.decideByPipeline,
    summary: "Evaluate content using a stored pipeline",
    inputStructure: "detailed",
    description:
      "Run the primary pipeline's stored questions against new state. Requires an API key that owns the pipeline. Replay accepts state without image attachments.",
  })
    .errors({ NOT_FOUND: { message: "Decision pipeline not found" } })
    .input(
      z.object({
        headers: pipelineRoutingHeaders,
        body: z.object({
          pipelineId: z.uuid(),
          state: systemOneRequest.shape.state,
        }),
      }),
    )
    .output(tracedSystemOneResponse)
    .handler(
      async ({
        input: {
          body: { pipelineId, state },
          headers,
        },
        context: { user },
        errors,
      }) => {
        const result = await processStoredDecision(
          pipelineId,
          state,
          user,
          headers[exactPipelineHeader] === "true",
        );
        if (!result) throw errors.NOT_FOUND();
        return result.decision;
      },
    ),
} satisfies Record<keyof typeof systemOneRoutes, AnyProcedure>);
