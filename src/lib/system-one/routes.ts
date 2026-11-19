import type { os } from "@orpc/server";

type HttpRoute = Required<
  Pick<Parameters<typeof os.route>[0], "method" | "path">
>;

export const systemOneRoutes = {
  models: { method: "GET", path: "/system-one/models" },
  decide: { method: "POST", path: "/system-one" },
} as const satisfies Record<string, HttpRoute>;

type SystemOneRoutes = typeof systemOneRoutes;
type SystemOnePath = SystemOneRoutes[keyof SystemOneRoutes]["path"];
type ApiKeyRequestPath = `/api${SystemOnePath}`;

export function isRequestThatRequiresApiKey(
  pathname: string,
): pathname is ApiKeyRequestPath {
  return Object.values(systemOneRoutes).some(
    ({ path }) => pathname === `/api${path}`,
  );
}
