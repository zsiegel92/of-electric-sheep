import { call } from "@orpc/server";
import { createServerFn } from "@tanstack/react-start";
import { apiKeyId, apiKeyName } from "./api-key-schemas";
import { keyManagement } from "./api-keys";
import { requireUser } from "./auth";

export const getCurrentUser = createServerFn().handler(({ context }) =>
  requireUser(context.user),
);

export const listApiKeys = createServerFn().handler(({ context }) =>
  call(keyManagement.list, undefined, { context: { user: context.user } }),
);

export const createApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyName)
  .handler(({ data, context }) =>
    call(keyManagement.create, data, { context: { user: context.user } }),
  );

export const revokeApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyId)
  .handler(({ data, context }) =>
    call(keyManagement.delete, data, { context: { user: context.user } }),
  );
