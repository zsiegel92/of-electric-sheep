import { call } from "@orpc/server";
import { createServerFn } from "@tanstack/react-start";
import { api } from "./api";
import { requireUser } from "./auth";

export const getViewer = createServerFn().handler(({ context }) =>
  call(api.viewer, undefined, { context: { user: requireUser(context.user) } }),
);
