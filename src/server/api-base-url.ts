import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { apiBasePath } from "@/lib/system-one/routes";

export const getTypeSafeApiBaseUrl = createServerFn().handler(
  () => new URL(apiBasePath, getRequestUrl({ xForwardedHost: true })).href,
);
