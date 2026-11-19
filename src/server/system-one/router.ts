import "@tanstack/react-start/server-only";
import { type AnyProcedure, os } from "@orpc/server";
import { findApiKeyUser } from "@/lib/api-keys/queries";
import type { User } from "@/lib/auth";
import {
  decisionInput,
  decisionRequestBody,
  imagesHeader,
  longContextHeader,
  modelList,
  systemOneResponse,
  typesafeErrors,
} from "@/lib/system-one/schemas";
import {
  listModels,
  runDecision,
} from "@/lib/system-one/system-one-api-client";
import { routeGroup } from "../route-group";
import { systemOneRoutes } from "./routes";

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
    .handler(({ input: { body, headers } }) =>
      runDecision(body, {
        enableImages: headers[imagesHeader] === "true",
        enableLongContext: headers[longContextHeader] === "true",
      }),
    ),
} satisfies Record<keyof typeof systemOneRoutes, AnyProcedure>);
