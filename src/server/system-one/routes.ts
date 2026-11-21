import type { os } from "@orpc/server";

type HttpRoute = Required<
  Pick<Parameters<typeof os.route>[0], "method" | "path">
>;

export const systemOneRoutes = {
  models: { method: "GET", path: "/system-one/models" },
  decide: { method: "POST", path: "/system-one" },
  decideByPipeline: { method: "POST", path: "/system-one/decide-by-pipeline" },
} as const satisfies Record<string, HttpRoute>;
