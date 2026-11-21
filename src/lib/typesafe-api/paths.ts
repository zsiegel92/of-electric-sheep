import { systemOneRoutes } from "@/server/system-one/routes";

export const typeSafeApiBasePath = "/api";
export const typeSafeDecisionPath = "/v1/systemone";

export function typeSafeApiAlias(pathname: string) {
  switch (pathname) {
    case `${typeSafeApiBasePath}/v1/models`:
      return `/api${systemOneRoutes.models.path}`;
    case `${typeSafeApiBasePath}${typeSafeDecisionPath}`:
      return `/api${systemOneRoutes.decide.path}`;
  }
  return undefined;
}

export function isRequestThatRequiresApiKey(pathname: string) {
  return (
    typeSafeApiAlias(pathname) !== undefined ||
    Object.values(systemOneRoutes).some(
      ({ path }) => pathname === `/api${path}`,
    )
  );
}
