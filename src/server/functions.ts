import { call } from "@orpc/server";
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { apiKeyId, apiKeyName } from "@/lib/api-keys/schemas";
import { typeSafeApiBasePath } from "@/lib/typesafe-api/paths";
import { requireUser } from "../lib/auth";
import { keyManagementRouter } from "./api-keys";

export const getTypeSafeApiBaseUrl = createServerFn().handler(
  () =>
    new URL(typeSafeApiBasePath, getRequestUrl({ xForwardedHost: true })).href,
);

export const getCurrentUser = createServerFn().handler(({ context }) =>
  requireUser(context.user),
);

export const listApiKeys = createServerFn().handler(({ context }) =>
  call(keyManagementRouter.list, undefined, {
    context: { user: context.user },
  }),
);

export const createApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyName)
  .handler(({ data, context }) =>
    call(keyManagementRouter.create, data, { context: { user: context.user } }),
  );

export const revokeApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyId)
  .handler(({ data, context }) =>
    call(keyManagementRouter.delete, data, { context: { user: context.user } }),
  );
