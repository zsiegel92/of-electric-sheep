import { call } from "@orpc/server";
import { createServerFn } from "@tanstack/react-start";
import { api } from "./api";
import { requireUser } from "./auth";
import { displayName } from "./schemas";

export const getViewer = createServerFn().handler(({ context }) =>
  call(api.viewer, undefined, { context: { user: requireUser(context.user) } }),
);

export const updateProfile = createServerFn({ method: "POST" })
  .validator(displayName)
  .handler(({ data, context }) =>
    call(api.updateProfile, data, {
      context: { user: requireUser(context.user) },
    }),
  );
