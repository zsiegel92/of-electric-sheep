import { call } from "@orpc/server";
import { createServerFn } from "@tanstack/react-start";
import { apiKeyId, apiKeyName } from "@/lib/api-keys/schemas";
import { keyManagementRouter } from "./api/api-keys";

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
