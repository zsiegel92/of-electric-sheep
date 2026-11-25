import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "@/lib/auth";

export const getCurrentUser = createServerFn().handler(({ context }) =>
  requireUser(context.user),
);
