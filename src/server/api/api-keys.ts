import "@tanstack/react-start/server-only";
import { os } from "@orpc/server";
import { z } from "zod";
import {
  createApiKey,
  getApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/lib/api-keys/queries";
import {
  apiKey,
  apiKeyId,
  apiKeyName,
  createdApiKey,
  deletedApiKey,
} from "@/lib/api-keys/schemas";
import type { User } from "@/lib/auth";

const api = os.$context<{ user: User | null }>();

const sessionProcedure = api
  .errors({ UNAUTHORIZED: { message: "Sign in required" } })
  .use(({ context, errors, next }) => {
    if (!context.user) throw errors.UNAUTHORIZED();
    return next({ context: { user: context.user } });
  });

export const apiKeysTag = "API keys";

export const keyManagementRouter = api.tag(apiKeysTag).router({
  list: sessionProcedure
    .route({
      method: "GET",
      path: "/api-keys",
      summary: "List your API keys",
    })
    .output(z.array(apiKey))
    .handler(({ context: { user } }) => listApiKeys(user)),

  create: sessionProcedure
    .route({
      method: "POST",
      path: "/api-keys",
      summary: "Create an API key",
      successStatus: 201,
    })
    .input(apiKeyName)
    .output(createdApiKey)
    .handler(({ input, context: { user } }) => createApiKey(user, input.name)),

  get: sessionProcedure
    .route({
      method: "GET",
      path: "/api-keys/{id}",
      summary: "Get an API key’s metadata",
    })
    .errors({ NOT_FOUND: {} })
    .input(apiKeyId)
    .output(apiKey)
    .handler(async ({ input, context: { user }, errors }) => {
      const key = await getApiKey(user, input.id);
      if (!key) throw errors.NOT_FOUND();
      return key;
    }),

  delete: sessionProcedure
    .route({
      method: "DELETE",
      path: "/api-keys/{id}",
      summary: "Revoke an API key",
    })
    .errors({ NOT_FOUND: {} })
    .input(apiKeyId)
    .output(deletedApiKey)
    .handler(async ({ input, context: { user }, errors }) => {
      if (!(await revokeApiKey(user, input.id))) throw errors.NOT_FOUND();
      return { deleted: true };
    }),
});
