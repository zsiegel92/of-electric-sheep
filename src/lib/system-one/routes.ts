import type { Route } from "@orpc/server";

type HttpRoute = Required<Pick<Route, "method" | "path">>;

export const systemOneRoutes = {
  models: { method: "GET", path: "/v1/models" },
  decide: { method: "POST", path: "/v1/systemone" },
  decideByPipeline: { method: "POST", path: "/system-one/decide-by-pipeline" },
} as const satisfies Record<string, HttpRoute>;

export const apiBasePath = "/api";

export function isTypeSafeSdkPath(pathname: string) {
  return (
    pathname === `${apiBasePath}${systemOneRoutes.models.path}` ||
    pathname === `${apiBasePath}${systemOneRoutes.decide.path}`
  );
}

export function isRequestThatRequiresApiKey(pathname: string) {
  return Object.values(systemOneRoutes).some(
    ({ path }) => pathname === `${apiBasePath}${path}`,
  );
}
