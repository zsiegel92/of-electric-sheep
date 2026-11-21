import { systemOneRoutes } from "@/server/system-one/routes";

export const typeSafeApiBasePath = "/api";

export function typeSafeApiAlias(pathname: string) {
  switch (pathname) {
    case `${typeSafeApiBasePath}/v1/models`:
      return `/api${systemOneRoutes.models.path}`;
    case `${typeSafeApiBasePath}/v1/systemone`:
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
