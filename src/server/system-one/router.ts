import "@tanstack/react-start/server-only";
import { type AnyProcedure, os } from "@orpc/server";
import { systemOneRoutes } from "@/lib/system-one/routes";
import {
  decisionInput,
  decisionRequestBody,
  modelList,
  systemOneResponse,
} from "@/lib/system-one/schemas";
import {
  listModels,
  runDecision,
  typesafeErrors,
} from "@/lib/system-one/system-one-api-client";
import { findApiKeyUser } from "../api-keys";
import type { User } from "../auth";
import { routeGroup } from "../route-group";

export const systemOneTag = "System One · TypeSafe";

const apiKeyAuth = os
  .$context<{ headers: Headers }>()
  .errors({
    ...typesafeErrors,
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
    .output(systemOneResponse)
    .handler(({ input }) => runDecision(input)),
} satisfies Record<keyof typeof systemOneRoutes, AnyProcedure>);
